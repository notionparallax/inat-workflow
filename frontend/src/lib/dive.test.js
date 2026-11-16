import test from "node:test";
import assert from "node:assert/strict";
import { addRange, clock, cropRect, interpolate, region, solveSync, syncFrom, videoIdFrom } from "./dive.js";

test("solveSync", () => {
  assert.deepEqual(solveSync([[5, 14]]), { a: 1, b: 9 });
  const { a, b } = solveSync([[5, 14], [6005, 6020]]);
  assert.ok(Math.abs(a - 1.001) < 1e-9);
  assert.ok(Math.abs(a * 5 + b - 14) < 1e-9);
});

test("syncFrom adds drag offset", () => {
  const s = syncFrom({ descentVid: 20, dragOffset: 3 }, { descent_s: 14, ascent_s: 6753 });
  assert.deepEqual(s, { a: 1, b: -3 });
});

test("interpolate", () => {
  const samples = [{ t: 10, depth: 0 }, { t: 20, depth: 2.5 }];
  assert.equal(interpolate(samples, 15, "depth"), 1.25);
  assert.equal(interpolate(samples, 5, "depth"), null);
});

test("clock", () => {
  assert.equal(clock(65), "1:05");
  assert.equal(clock(6740), "1:52:20");
  assert.equal(clock(-5), "−0:05");
});

test("addRange merges", () => {
  let r = addRange([], 0, 10);
  r = addRange(r, 10.5, 20);
  r = addRange(r, 50, 60);
  assert.deepEqual(r, [[0, 20], [50, 60]]);
});

test("videoIdFrom", () => {
  assert.equal(videoIdFrom("https://www.youtube.com/watch?v=MRja6VhCmMs"), "MRja6VhCmMs");
  assert.equal(videoIdFrom("https://youtu.be/MRja6VhCmMs?t=5"), "MRja6VhCmMs");
  assert.equal(videoIdFrom("MRja6VhCmMs"), "MRja6VhCmMs");
  assert.equal(videoIdFrom("nonsense"), null);
});

test("region matches back end", () => {
  assert.equal(region(80, 20), "upper right");
  assert.equal(region(62, 35), "centre");
});

test("cropRect stays inside frame", () => {
  assert.deepEqual(cropRect(3840, 2160, 100, 100, 1600, 1200), { x: 0, y: 0, w: 1600, h: 1200 });
  assert.deepEqual(cropRect(3840, 2160, 1920, 1080, 1600, 1200), { x: 1120, y: 480, w: 1600, h: 1200 });
  assert.deepEqual(cropRect(1280, 720, 640, 360, 1600, 1200), { x: 0, y: 0, w: 1280, h: 720 });
});
