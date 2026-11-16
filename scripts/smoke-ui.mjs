// UI smoke test: starts from the hard-coded development defaults (video, dive,
// permission), checks setup collapses, exercises sync scaling, and opens the
// frame picker with synthetic frames. Needs both servers running (backend on
// :8000, frontend dev server on :5173). Doesn't need the extension.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "output");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("youtube")) errors.push(m.text()); });

await page.goto("http://localhost:5173/");
await page.waitForSelector(".timeline svg path.profile", { timeout: 20000 });
const drawerOpen = await page.locator(".drawer").count();
await page.screenshot({ path: path.join(out, "ui-main.png") });

// Set the descent at the start, then drag: should stretch, not shift.
await page.keyboard.press("d");
const box = await page.locator(".timeline svg").boundingBox();
await page.mouse.move(box.x + box.width * 0.6, box.y + 90);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6 + 40, box.y + 90, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(1000);
const sync = await page.evaluate(() => JSON.parse(localStorage.getItem("dive-inat:video:MRja6VhCmMs")).sync);

// Frame picker with synthetic frames.
await page.evaluate(() => window.__diveInat.fakeBurst(24));
await page.waitForSelector("[role=dialog]");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("2");
const img = await page.locator(".imgbtn img").boundingBox();
await page.mouse.click(img.x + img.width * 0.4, img.y + img.height * 0.5);
await page.screenshot({ path: path.join(out, "ui-picker.png") });
const selected = await page.locator(".thumb.selected").count();
await page.keyboard.press("Escape");
await page.screenshot({ path: path.join(out, "ui-after-picker.png") });

console.log(JSON.stringify({ drawerOpen, sync, selected, errors }, null, 2));
await browser.close();
