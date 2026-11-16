import test from "node:test";
import assert from "node:assert/strict";
import { addRange, clock, cropRect, dragSync, interpolate, region, solveSync, syncFrom, videoIdFrom } from "./dive.js";

test("solveSync", () => {
  assert.deepEqual(solveSync([[5, 14]]), { a: 1, b: 9 });
  const { a, b } = solveSync([[5, 14], [6005, 6020]]);
  assert.ok(Math.abs(a - 1.001) < 1e-9);
  assert.ok(Math.abs(a * 5 + b - 14) < 1e-9);
});

const DIVE = { descent_s: 14, ascent_s: 6753 };

test("syncFrom: offset with no anchors, pinned scale with one", () => {
  assert.deepEqual(syncFrom({ dragOffset: 3 }, DIVE), { a: 1, b: 3 });
  assert.deepEqual(syncFrom({ descentVid: 20, dragOffset: 3 }, DIVE), { a: 1, b: -6 });
  const s = syncFrom({ descentVid: 20, scale: 1.01 }, DIVE);
  assert.ok(Math.abs(s.a * 20 + s.b - 14) < 1e-9); // descent stays pinned
});

test("dragSync offsets with no anchors", () => {
  assert.deepEqual(dragSync({ dragOffset: 0 }, DIVE, 100, 110), { dragOffset: -10 });
});

test("dragSync scales around the descent", () => {
  const sync = { descentVid: 20 };
  // Log time under the pointer at video 1020 is 1014; drag it to 1010.
  const { scale } = dragSync(sync, DIVE, 1020, 1010);
  const s = syncFrom({ ...sync, scale }, DIVE);
  assert.ok(Math.abs(s.a * 1010 + s.b - 1014) < 1e-9);
  assert.ok(Math.abs(s.a * 20 + s.b - 14) < 1e-9);
});

test("dragSync does nothing with both anchors", () => {
  assert.equal(dragSync({ descentVid: 20, ascentVid: 6700 }, DIVE, 100, 110), null);
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
