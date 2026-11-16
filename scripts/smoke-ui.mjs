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
const img = await page.locator(".imgbox img").boundingBox();
await page.mouse.click(img.x + img.width * 0.4, img.y + img.height * 0.5);
// Add a crop box and enlarge it from its corner.
await page.keyboard.press("r");
const handle = await page.locator(".crop .handle").boundingBox();
await page.mouse.move(handle.x + 8, handle.y + 8);
await page.mouse.down();
await page.mouse.move(handle.x + 120, handle.y + 60, { steps: 5 });
await page.mouse.up();
const cropLabel = await page.locator(".crop-label").innerText();
// Select a second frame with the + on a thumbnail.
await page.locator(".thumb:not(.selected) .sel").first().click();
await page.screenshot({ path: path.join(out, "ui-picker.png") });
const selected = await page.locator(".thumb.selected").count();

// Make a GIF of the crop area around the current frame (synthetic frames in dev).
await page.locator(".thumb.current .pick").click();
await page.keyboard.press("g");
const t0 = Date.now();
await page.getByRole("button", { name: "Make GIF", exact: true }).click();
await page.getByRole("button", { name: "Use this GIF" }).waitFor({ timeout: 60000 });
const gifMs = Date.now() - t0;
const gifInfo = await page.locator(".gif .info p").innerText();
await page.screenshot({ path: path.join(out, "ui-gif.png") });
await page.getByRole("button", { name: "Use this GIF" }).click();

// Complete, then upload (dry run) and read back what would be sent.
await page.keyboard.press("c");
await page.keyboard.press("Enter");
await page.waitForSelector(".row.dry-run", { timeout: 20000 });
await page.locator(".row.dry-run summary").first().click();
await page.screenshot({ path: path.join(out, "ui-after-upload.png"), fullPage: true });
const preview = await page.locator(".row.dry-run pre").first().innerText();

console.log(JSON.stringify({ drawerOpen, sync, cropLabel, selected, gifMs, gifInfo, errors }, null, 2));
console.log(preview);
await browser.close();
