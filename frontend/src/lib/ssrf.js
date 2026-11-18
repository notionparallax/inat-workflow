// Parser for Subsurface `.ssrf` dive logs (SPEC §6.2), run in the browser.
//
// Only the fields the tool needs are read: start time, duration, depth and
// temperature samples, GPS positions and the dive site name.

import tzlookup from "@photostructure/tz-lookup";

const NUMBER = /-?\d+(?:\.\d+)?/g;

// A dive is considered "underwater" deeper than this (metres). Used for the
// descent and surface anchors that sync matches against the video (§8.2).
export const DEFAULT_THRESHOLD_M = 1.0;

/** '112:20 min' → 6740 seconds. Also accepts 'h:mm:ss min'. */
export function parseDuration(text) {
  if (!text) return null;
  const parts = text.replace("min", "").trim().split(":");
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || parts.some((p) => p.trim() === ""))) return null;
  let seconds = nums.reduce((acc, n) => acc * 60 + n, 0);
  if (nums.length === 1) seconds *= 60; // plain minutes
  return seconds;
}

/** '2.5 m' → 2.5, '20.0 C' → 20. */
export function parseNumber(text) {
  if (!text) return null;
  const m = text.match(NUMBER);
  return m ? Number(m[0]) : null;
}

/** '-33.915741 151.264138' or '-33.915750, 151.264600' → [lat, lon]. */
export function parseLatLon(text) {
  if (!text) return null;
  const nums = text.match(NUMBER);
  if (!nums || nums.length < 2) return null;
  const lat = Number(nums[0]), lon = Number(nums[1]);
  if (lat === 0 && lon === 0) return null;
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return [lat, lon];
}

export function timezoneFor(lat, lon) {
  try {
    return tzlookup(lat, lon);
  } catch {
    return null;
  }
}

/** Offset of `timeZone` from UTC, in minutes, at the UTC instant `ms`. */
function offsetMinutes(timeZone, ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** '+11:00' for a wall-clock time like '2026-11-15T08:31:19' in `timeZone`. */
export function utcOffsetFor(localIso, timeZone) {
  const wall = Date.parse(localIso + "Z");
  if (Number.isNaN(wall)) return null;
  // The offset at the wall-clock time read as UTC, then refined once (DST edges).
  let off = offsetMinutes(timeZone, wall);
  off = offsetMinutes(timeZone, wall - off * 60000);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function crossing(t0, d0, t1, d1, threshold) {
  if (d1 === d0) return t0;
  return t0 + ((threshold - d0) * (t1 - t0)) / (d1 - d0);
}

const round2 = (x) => Math.round(x * 100) / 100;

/** Descent and surface anchor times: when depth first goes deeper than and
 *  last comes shallower than `threshold`, interpolated between samples. */
export function anchors(samples, threshold = DEFAULT_THRESHOLD_M) {
  let first = -1, last = -1;
  samples.forEach((s, i) => {
    if (s.depth >= threshold) {
      if (first < 0) first = i;
      last = i;
    }
  });
  if (first < 0) return [null, null];
  const descent = first === 0 ? samples[0].t
    : crossing(samples[first - 1].t, samples[first - 1].depth, samples[first].t, samples[first].depth, threshold);
  const ascent = last === samples.length - 1 ? samples[last].t
    : crossing(samples[last].t, samples[last].depth, samples[last + 1].t, samples[last + 1].depth, threshold);
  return [round2(descent), round2(ascent)];
}

// --- DOM helpers (work with the browser's DOMParser and with xmldom in tests) --
const attr = (el, name) => (el.hasAttribute(name) ? el.getAttribute(name) : null);
const children = (el, tag) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.nodeName === tag);
const child = (el, tag) => children(el, tag)[0] || null;

function sampleInterval(samples) {
  if (samples.length < 2) return null;
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function parseDive(dive, sites, threshold) {
  const computers = children(dive, "divecomputer");
  const dc = computers[0] || dive;
  const extra = {};
  if (computers.length) for (const e of children(dc, "extradata")) extra[attr(e, "key") || ""] = attr(e, "value") || "";

  const samples = [];
  let temp = null;
  for (const s of children(dc, "sample")) {
    const t = parseDuration(attr(s, "time"));
    const depth = parseNumber(attr(s, "depth"));
    if (t == null || depth == null) continue;
    if (attr(s, "temp") != null) temp = parseNumber(attr(s, "temp"));
    samples.push({ t, depth, temp });
  }

  // Subsurface only writes temperature when it changes: carry the first
  // known value backwards too, and fall back to the dive summary.
  const tempEl = child(dc, "temperature");
  const summaryTemp = tempEl ? parseNumber(attr(tempEl, "water")) : null;
  const firstTemp = samples.find((s) => s.temp != null)?.temp ?? summaryTemp;
  for (const s of samples) {
    if (s.temp != null) break;
    s.temp = firstTemp;
  }

  const depthEl = child(dc, "depth");
  const site = sites[attr(dive, "divesiteid") || ""] || null;

  const startLoc = parseLatLon(extra["Start location"]);
  const endLoc = parseLatLon(extra["End location"]);
  let location = null;
  if (startLoc) location = { lat: startLoc[0], lon: startLoc[1], source: "dive computer" };
  else if (site && site.lat != null) location = { lat: site.lat, lon: site.lon, source: "dive site" };

  const date = attr(dive, "date"), time = attr(dive, "time") || "00:00:00";
  const startLocal = date ? `${date}T${time}` : null;
  const tzName = location ? timezoneFor(location.lat, location.lon) : null;
  const utcOffset = tzName && startLocal ? utcOffsetFor(startLocal, tzName) : null;
  const [descent, ascent] = anchors(samples, threshold);
  const number = attr(dive, "number");

  return {
    number: /^\d+$/.test(number || "") ? Number(number) : null,
    start_local: startLocal,
    timezone: tzName,
    utc_offset: utcOffset,
    duration_s: parseDuration(attr(dive, "duration")),
    computer: computers.length ? attr(dc, "model") : null,
    computer_count: computers.length,
    max_depth: depthEl ? parseNumber(attr(depthEl, "max")) : null,
    mean_depth: depthEl ? parseNumber(attr(depthEl, "mean")) : null,
    water_temp: summaryTemp ?? firstTemp,
    site,
    location,
    start_location: startLoc ? { lat: startLoc[0], lon: startLoc[1] } : null,
    end_location: endLoc ? { lat: endLoc[0], lon: endLoc[1] } : null,
    threshold_m: threshold,
    descent_s: descent,
    ascent_s: ascent,
    sample_interval_s: sampleInterval(samples),
    samples,
  };
}

/** Parse a Subsurface log and return its dives (usually one). Throws on
 *  text that isn't XML. Pass `DOMParser` outside the browser. */
export function parseSsrf(text, { threshold = DEFAULT_THRESHOLD_M, DOMParser: Parser = globalThis.DOMParser } = {}) {
  let doc;
  try {
    doc = new Parser().parseFromString(text, "application/xml");
  } catch (e) {
    throw new Error(`Couldn't read that file as a Subsurface log: ${e.message}`);
  }
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length) {
    throw new Error("Couldn't read that file as a Subsurface log: it isn't valid XML.");
  }
  const sites = {};
  for (const s of Array.from(doc.getElementsByTagName("site"))) {
    const pos = parseLatLon(attr(s, "gps"));
    sites[attr(s, "uuid") || ""] = { name: attr(s, "name"), lat: pos ? pos[0] : null, lon: pos ? pos[1] : null };
  }
  return Array.from(doc.getElementsByTagName("dive")).map((d) => parseDive(d, sites, threshold));
}
