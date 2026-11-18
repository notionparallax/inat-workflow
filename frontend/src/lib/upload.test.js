// Tests for the logic that used to live in the Python back end.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { parseDuration, parseLatLon, parseSsrf, utcOffsetFor } from "./ssrf.js";
import { interpolate, observationValues } from "./dive.js";
import { buildDescription } from "./notes.js";
import { buildObservationPayload, Client, INatError, tokenExpiry } from "./inat.js";
import { buildChapters, videoTimeFromDescription } from "./chapters.js";

const FIXTURE = readFileSync(new URL("../../test/fixtures/gordons_dive.ssrf", import.meta.url), "utf8");
const dives = parseSsrf(FIXTURE, { DOMParser });
const dive = dives[0];
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

// --- ssrf ------------------------------------------------------------------
test("parse helpers", () => {
  assert.equal(parseDuration("112:20 min"), 6740);
  assert.equal(parseDuration("0:10 min"), 10);
  assert.equal(parseDuration(""), null);
  assert.deepEqual(parseLatLon("-33.915741 151.264138"), [-33.915741, 151.264138]);
  assert.deepEqual(parseLatLon("-33.915750, 151.264600"), [-33.91575, 151.2646]);
  assert.equal(parseLatLon("0 0"), null);
});

test("dive summary", () => {
  assert.equal(dives.length, 1);
  assert.equal(dive.number, 235);
  assert.equal(dive.start_local, "2026-11-15T08:31:19");
  assert.equal(dive.duration_s, 6740);
  assert.equal(dive.computer, "Shearwater Perdix 2");
  assert.equal(dive.max_depth, 13.7);
  assert.equal(dive.site.name, "Gordon's bay");
  assert.equal(dive.sample_interval_s, 10);
  assert.equal(dive.samples.length, 684);
});

test("location prefers dive computer", () => {
  assert.deepEqual(dive.location, { lat: -33.91575, lon: 151.2646, source: "dive computer" });
  assert.equal(dive.site.lat, -33.915741);
});

test("time zone from GPS", () => {
  assert.equal(dive.timezone, "Australia/Sydney");
  assert.equal(dive.utc_offset, "+11:00"); // daylight saving in November
  assert.equal(utcOffsetFor("2026-07-01T12:00:00", "Australia/Sydney"), "+10:00");
  assert.equal(utcOffsetFor("2026-07-01T12:00:00", "America/New_York"), "-04:00");
  assert.equal(utcOffsetFor("2026-01-01T12:00:00", "Asia/Kolkata"), "+05:30");
});

test("temperature carried forward", () => {
  assert.ok(dive.samples.every((s) => s.temp === 20));
});

test("anchors", () => {
  assert.equal(dive.descent_s, 14); // 0:10 is 0.0 m, 0:20 is 2.5 m → 1 m at 14 s
  near(dive.ascent_s, 6753.33, 0.01); // 112:30 is 1.5 m, 112:40 is 0.0 m
});

test("rejects non-XML", () => {
  assert.throws(() => parseSsrf("not xml at all <", { DOMParser }));
});

// --- derive ----------------------------------------------------------------
test("interpolate and observation values", () => {
  near(interpolate(dive.samples, 15, "depth"), 1.25);
  assert.equal(interpolate(dive.samples, 1, "depth"), null);
  const v = observationValues(dive, 15);
  assert.equal(v.observed_on, "2026-11-15T08:31:34+11:00");
  assert.equal(v.depth_m, 1.3);
  assert.equal(v.temp_c, 20);
  assert.equal(v.dive_time, "00:00:15");
  assert.equal(observationValues(dive, 600).observed_on, "2026-11-15T08:41:19+11:00");
});

// --- notes -----------------------------------------------------------------
test("description", () => {
  const text = buildDescription({
    video_id: "MRja6VhCmMs", t_vid: 754.6, values: { depth_m: 12.4, temp_c: 20, dive_time: "00:23:41" },
    site_name: "Gordon's bay", location_source: "dive computer", positions: [{ x: 80, y: 20 }, null], crop_of: [0],
    observer: "Diver", capturer: "Capturer", free_text: "Project note",
  });
  assert.match(text, /Video: https:\/\/youtu\.be\/MRja6VhCmMs\?t=754/);
  assert.match(text, /Depth: 12\.4 m \(interpolated from dive computer log\)/);
  assert.match(text, /Water temperature: 20 °C/);
  assert.match(text, /photo 1 – 80% across, 20% down \(upper right\)/);
  assert.match(text, /Photo 3 is a full-resolution crop of photo 1\./);
  assert.match(text, /Observed by: Diver\. Frames captured by: Capturer/);
  assert.match(text.split("\n").at(-1), /^Created with dive-inat v/);
});

// --- iNat payload and client -------------------------------------------------
test("payload", () => {
  const p = buildObservationPayload({
    observed_on: "2026-11-15T08:31:34+11:00", location: { lat: -33.9, lon: 151.2 }, accuracy_m: 150,
    description: "d", licence: "CC0", field_values: { 558: 12.4, 14913: null },
  }).observation;
  assert.ok(!("taxon_id" in p));
  assert.equal(p.positional_accuracy, 150);
  assert.deepEqual(p.observation_field_values_attributes, [{ observation_field_id: 558, value: 12.4 }]);
  const q = buildObservationPayload({ location: null, accuracy_m: 150, description: "d" }).observation;
  assert.ok(!("latitude" in q) && !("positional_accuracy" in q));
});

const response = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status });

test("client retries then fails", async () => {
  const calls = [];
  const c = new Client({ token: "t", sleep: async () => {}, fetch: async (url, init) => { calls.push(init); return response(503, { error: "down" }); } });
  await assert.rejects(c.createObservation({ observation: {} }), (e) => e instanceof INatError && e.status === 503);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].headers.Authorization, "t");
});

test("client recovers after retry", async () => {
  const replies = [response(429), response(200, [{ id: 1, uuid: "u" }])];
  const c = new Client({ token: "t", sleep: async () => {}, fetch: async () => replies.shift() });
  assert.deepEqual(await c.createObservation({ observation: {} }), { id: 1, uuid: "u" });
});

test("token expiry", () => {
  assert.equal(tokenExpiry("x.eyJ1c2VyX2lkIjoxLCJleHAiOjE3OTQ4ODIzNTZ9.y"), 1794882356);
  assert.equal(tokenExpiry("not-a-jwt"), null);
});

// --- chapters --------------------------------------------------------------
const obs = (taxon = null, grade = "needs_id") => ({ taxon, quality_grade: grade });
const SEA = { name: "Phyllopteryx taeniolatus", preferred_common_name: "weedy seadragon" };

test("chapters", () => {
  const red = { name: "Rhodophyta", preferred_common_name: "red algae" };
  const out = buildChapters([
    { video_time: 467, observation: obs(SEA, "research") },
    { video_time: 194, observation: obs(red) },
    { video_time: 200, observation: obs(null) },
  ]);
  assert.deepEqual(out.text.split("\n"), [
    "00:00 Descent",
    "03:12 Red algae (Rhodophyta) / Unidentified – see iNaturalist",
    "07:45 Weedy seadragon (Phyllopteryx taeniolatus)",
  ]);
  assert.deepEqual(out.warnings, []);
  const hours = buildChapters([
    { video_time: 4000, observation: obs(SEA, "research") },
    { video_time: 300, observation: obs(null) },
  ], { research_only: true });
  assert.deepEqual(hours.text.split("\n"), ["0:00:00 Descent", "1:06:38 Weedy seadragon (Phyllopteryx taeniolatus)"]);
  assert.ok(hours.warnings.length);
});

test("video time from description", () => {
  const d = "Video: https://youtu.be/MRja6VhCmMs?t=754\nDepth: 3 m";
  assert.equal(videoTimeFromDescription(d, "MRja6VhCmMs"), 754);
  assert.equal(videoTimeFromDescription(d, "otherVideo1"), null);
});

test("client doesn't repeat a write that may have happened", async () => {
  let calls = 0;
  const c502 = new Client({ token: "t", sleep: async () => {}, fetch: async () => { calls++; return response(502); } });
  await assert.rejects(c502.createObservation({ observation: {} }), (e) => e.status === 502);
  assert.equal(calls, 1);
  calls = 0;
  const lost = new Client({ token: "t", sleep: async () => {}, fetch: async () => { calls++; throw new TypeError("Failed to fetch"); } });
  await assert.rejects(lost.createObservation({ observation: {} }), /Network error/);
  assert.equal(calls, 1);
});

test("client retries reads on server errors", async () => {
  const replies = [response(500), response(200, { results: [{ id: 7 }] })];
  const c = new Client({ token: "t", sleep: async () => {}, fetch: async () => replies.shift() });
  assert.deepEqual(await c.me(), { id: 7 });
});

test("chapters with iNaturalist links", () => {
  const out = buildChapters([
    { video_time: 467, observation: { id: 11, ...obs(SEA, "research") } },
    { video_time: 470, observation: { id: 12, ...obs(SEA) } },
    { video_time: 100, observation: { id: 13, ...obs(null) } },
  ], { links: true });
  assert.deepEqual(out.text.split("\n"), [
    "00:00 Descent",
    "01:38 Unidentified – see iNaturalist https://inaturalist.org/observations/13",
    "07:45 Weedy seadragon (Phyllopteryx taeniolatus) https://inaturalist.org/observations/11 https://inaturalist.org/observations/12",
  ]);
});
