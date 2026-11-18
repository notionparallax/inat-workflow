// Main-view screenshot for the Chrome Web Store (1280×800), from the dev
// server's sample video and dive. iNaturalist is mocked, as in smoke-ui.mjs.
// The frame picker with real frames needs the extension, so take that one by
// hand in Chrome (see README).
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "store");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
const token = `x.${Buffer.from(JSON.stringify({ user_id: 1, exp: Math.floor(Date.now() / 1000) + 86400 })).toString("base64url")}.y`;
await page.addInitScript((t) => {
  localStorage.setItem("dive-inat:token", t);
  localStorage.setItem("dive-inat:intro-seen", "1");
}, token);
await page.route("https://api.inaturalist.org/**", (route) => {
  const me = route.request().url().includes("/users/me");
  route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(me ? { results: [{ id: 1, login: "diver", preferred_observation_license: "cc-by-nc", preferred_photo_license: "cc-by-nc" }] } : { results: [] }) });
});
await page.goto("http://localhost:5173/");
await page.waitForSelector(".timeline svg path.profile", { timeout: 20000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(out, "screenshot-main-1280x800.png") });
await browser.close();
console.log("store/screenshot-main-1280x800.png");
