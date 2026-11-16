// End-to-end check of the frame grabber extension (SPEC §18 item 1).
// Serves scripts/grabber-test.html on localhost, opens it in Chromium with the
// extension loaded, and grabs frames from the real YouTube video.
//
//   cd scripts && npm install && npx playwright install chromium
//   node test-grabber.mjs [videoId] [seconds]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(here, "..", "extension");
const out = path.join(here, "output");
fs.mkdirSync(out, { recursive: true });
const videoId = process.argv[2] || "MRja6VhCmMs";
const at = Number(process.argv[3] || 600);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(path.join(here, "grabber-test.html")));
}).listen(5199);

// Set CHROME_PATH to use an installed Chrome (e.g. Canary). Branded Chrome
// needs a feature switch to allow --load-extension.
const chromePath = process.env.CHROME_PATH;
const context = await chromium.launchPersistentContext(path.join(out, chromePath ? "profile-chrome" : "profile"), {
  headless: false,
  ...(chromePath ? { executablePath: chromePath } : {}),
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--autoplay-policy=no-user-gesture-required",
    ...(chromePath ? ["--disable-features=DisableLoadExtensionCommandLineSwitch"] : [])],
});
const report = {};
try {
  const page = context.pages()[0] || (await context.newPage());
  page.on("console", (m) => console.log("[page]", m.text()));
  await page.goto(`http://localhost:5199/?v=${videoId}`);
  await page.waitForFunction(() => window.playerReady || window.playerError !== undefined, null, { timeout: 60000 });
  if (await page.evaluate(() => window.playerError)) throw new Error("Player error " + (await page.evaluate(() => window.playerError)));
  await page.waitForFunction(() => window.isGrabberReady(), null, { timeout: 30000 });
  report.ping = await page.evaluate(() => grab("ping"));

  // Let it play so the frame-rate estimate settles, then ask for 2160p.
  await page.waitForTimeout(8000);
  report.quality = await page.evaluate(() => grab("quality", { level: "hd2160" }));
  await page.waitForTimeout(10000);
  report.statusPlaying = await page.evaluate(() => grab("status"));

  // Seek exactly, then grab one frame and a burst.
  report.seek = await page.evaluate((t) => grab("seek", { time: t }), at);
  await page.waitForTimeout(3000);
  const single = await page.evaluate(async () => {
    const f = await grab("grab");
    const buf = new Uint8Array(await f.blob.arrayBuffer());
    return { ...f, blob: undefined, bytes: buf.length, data: Array.from(buf) };
  });
  fs.writeFileSync(path.join(out, "single.jpg"), Buffer.from(single.data));
  report.single = { width: single.width, height: single.height, time: single.time, sharpness: single.sharpness, bytes: single.bytes };

  const t0 = Date.now();
  const burst = await page.evaluate(async (t) => {
    const r = await grab("burst", { center: t, before: 0.5, after: 0.5 });
    const frames = [];
    for (const f of r.frames) {
      const buf = new Uint8Array(await f.blob.arrayBuffer());
      frames.push({ time: f.time, sharpness: f.sharpness, width: f.width, height: f.height, data: Array.from(buf) });
    }
    return { fps: r.fps, frames };
  }, at);
  report.burst = {
    ms: Date.now() - t0, fps: burst.fps, count: burst.frames.length,
    frames: burst.frames.map((f, i) => {
      fs.writeFileSync(path.join(out, `burst-${String(i).padStart(2, "0")}.jpg`), Buffer.from(f.data));
      return { time: Number(f.time.toFixed(4)), sharpness: f.sharpness, size: `${f.width}x${f.height}` };
    }),
  };
  report.stepForward = await page.evaluate(() => grab("step", { frames: 1 }));
  report.stepBack = await page.evaluate(() => grab("step", { frames: -1 }));
} catch (err) {
  report.error = String(err);
} finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  server.close();
}
