// UI smoke test: loads the app, the sample video and dive log, sets sync
// points, drags the profile, and takes screenshots. Needs both servers running
// (backend on :8000, frontend on :5173). Doesn't need the extension.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "output");
fs.mkdirSync(out, { recursive: true });
const ssrf = path.resolve(here, "..", "backend", "tests", "fixtures", "gordons_dive.ssrf");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:5173/");
await page.getByPlaceholder("YouTube link or video ID").fill("https://www.youtube.com/watch?v=MRja6VhCmMs");
await page.getByRole("button", { name: "Load", exact: true }).click();
await page.waitForTimeout(2000);
await page.locator('input[type="file"]').setInputFiles(ssrf);
await page.waitForSelector("text=Gordon's bay");
await page.getByRole("checkbox", { name: /explicit permission/ }).check();
await page.screenshot({ path: path.join(out, "ui-setup.png"), fullPage: true });

// Close the drawer, then exercise the timeline: click to seek, D key, drag.
await page.getByRole("button", { name: "Setup" }).click();
const svg = page.locator(".timeline svg");
const box = await svg.boundingBox();
await page.mouse.click(box.x + box.width * 0.002, box.y + 70);
await page.keyboard.press("d");
await page.mouse.move(box.x + box.width * 0.5, box.y + 80);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.5 + 60, box.y + 80, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, "ui-main.png"), fullPage: true });

const state = await page.evaluate(() => JSON.parse(localStorage.getItem("dive-inat:video:MRja6VhCmMs")));
console.log(JSON.stringify({
  dive: state?.dive?.number, sync: state?.sync, permission: state?.permission,
  chips: await page.locator(".chip").allInnerTexts(),
  playerError: await page.locator(".error-box").allInnerTexts(),
  errors,
}, null, 2));
await browser.close();
