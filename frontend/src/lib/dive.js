// Sync and interpolation in the browser, for live display (SPEC §8).
// Also builds the values sent to iNaturalist on upload.

/** (a, b) for t_log = a * t_vid + b from anchor pairs [[t_vid, t_log], ...]. */
export function solveSync(points) {
  if (!points.length) return { a: 1, b: 0 };
  if (points.length === 1) return { a: 1, b: points[0][1] - points[0][0] };
  const [[v0, l0], [v1, l1]] = points;
  if (v1 === v0) return { a: 1, b: l0 - v0 };
  const a = (l1 - l0) / (v1 - v0);
  return { a, b: l0 - a * v0 };
}

export const videoToLog = (tVid, { a, b }) => a * tVid + b;
export const logToVideo = (tLog, { a, b }) => (tLog - b) / a;

function anchorPoints(sync, dive) {
  const points = [];
  if (sync?.descentVid != null && dive?.descent_s != null) points.push([sync.descentVid, dive.descent_s]);
  if (sync?.ascentVid != null && dive?.ascent_s != null) points.push([sync.ascentVid, dive.ascent_s]);
  return points;
}

/** Sync from the stored state (SPEC §8.2):
 *  - no anchors: a = 1, offset set by dragging;
 *  - one anchor: pinned there, scale set by dragging;
 *  - two anchors: fully determined. */
export function syncFrom(sync, dive) {
  const points = anchorPoints(sync, dive);
  if (points.length === 2) return solveSync(points);
  if (points.length === 1) {
    const [[v, l]] = points;
    const a = sync?.scale || 1;
    return { a, b: l - a * v };
  }
  return { a: 1, b: sync?.dragOffset || 0 };
}

/** New sync fields after dragging the profile from video time `fromT` to
 *  `toT`, or null if dragging can't change it (both anchors set). */
export function dragSync(sync, dive, fromT, toT) {
  const points = anchorPoints(sync, dive);
  if (points.length === 2) return null;
  const current = syncFrom(sync, dive);
  if (points.length === 0) return { dragOffset: (sync?.dragOffset || 0) - current.a * (toT - fromT) };
  // Stretch around the anchor so the log time under the pointer follows it.
  const [[v, l]] = points;
  if (Math.abs(toT - v) < 1 || Math.abs(fromT - v) < 1 || Math.sign(toT - v) !== Math.sign(fromT - v)) return null;
  const logUnderPointer = current.a * fromT + current.b;
  const scale = (logUnderPointer - l) / (toT - v);
  return { scale: Math.min(1.5, Math.max(0.67, scale)) };
}

export function interpolate(samples, t, key) {
  if (!samples?.length || t < samples[0].t || t > samples[samples.length - 1].t) return null;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const A = samples[lo], B = samples[hi];
  if (A[key] == null || B[key] == null) return A[key] ?? B[key];
  if (B.t === A.t) return A[key];
  return A[key] + ((B[key] - A[key]) * (t - A.t)) / (B.t - A.t);
}

export function clock(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "–";
  const sign = seconds < 0 ? "−" : "";
  const s = Math.round(Math.abs(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${sign}${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(r).padStart(2, "0")}`;
}

/** Merge a [start, end] range into a sorted list of non-overlapping ranges. */
export function addRange(ranges, start, end, gap = 1) {
  if (end <= start) return ranges;
  const out = [];
  let [s, e] = [start, end];
  for (const [rs, re] of ranges) {
    if (re + gap < s || rs - gap > e) out.push([rs, re]);
    else { s = Math.min(s, rs); e = Math.max(e, re); }
  }
  out.push([s, e]);
  return out.sort((x, y) => x[0] - y[0]);
}

/** Parse a YouTube URL or bare ID into an 11-character video ID. */
export function videoIdFrom(input) {
  const text = (input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.slice(1, 12) || null;
    if (url.searchParams.get("v")) return url.searchParams.get("v").slice(0, 11);
    const m = url.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
  } catch { /* not a URL */ }
  return null;
}

/** 3 × 3 region name for a point in percent. */
export function region(x, y) {
  const cols = ["left", "centre", "right"], rows = ["upper", "middle", "lower"];
  const col = cols[Math.min(2, Math.floor(x / (100 / 3)))];
  const row = rows[Math.min(2, Math.floor(y / (100 / 3)))];
  if (row === "middle") return col === "centre" ? "centre" : `middle ${col}`;
  return `${row} ${col}`;
}

/** Crop rectangle of size w × h centred on (px, py), kept inside the frame. */
export function cropRect(frameW, frameH, px, py, w, h) {
  const cw = Math.min(w, frameW), ch = Math.min(h, frameH);
  const x = Math.round(Math.min(Math.max(px - cw / 2, 0), frameW - cw));
  const y = Math.round(Math.min(Math.max(py - ch / 2, 0), frameH - ch));
  return { x, y, w: cw, h: ch };
}

/** "01:52:20" from seconds. */
export function formatClock(seconds) {
  const s = Math.round(seconds);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Time, depth and temperature for an observation at log time `tLog` (SPEC §8). */
export function observationValues(dive, tLog, utcOffset = null) {
  const offset = utcOffset || dive.utc_offset;
  let observed = null;
  if (dive.start_local) {
    const ms = Date.parse(dive.start_local + "Z") + Math.round(tLog) * 1000;
    observed = new Date(ms).toISOString().slice(0, 19) + (offset || "");
  }
  const depth = interpolate(dive.samples || [], tLog, "depth");
  const temp = interpolate(dive.samples || [], tLog, "temp");
  return {
    observed_on: observed,
    depth_m: depth != null ? Math.round(depth * 10) / 10 : null,
    temp_c: temp != null ? Math.round(temp) : null,
    dive_time: tLog >= 0 ? formatClock(tLog) : null,
    in_log: depth != null,
  };
}
