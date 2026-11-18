// Renders the Dive iNat icons and promo tiles from the SVG sources.
// Usage (from scripts/): node render-graphics.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const mark = read("frontend/public/favicon.svg");
const markSmall = read("frontend/public/favicon-small.svg");
const iconTpl = read("scripts/graphics/icon.html");
const promoTpl = read("scripts/graphics/promo.html");

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k]));

// size: output px; art: artwork px inside it; bg: page background (transparent unless opaque needed)
const icons = [
  { out: "frontend/public/favicon-32.png", size: 32, art: 32, svg: mark },
  { out: "frontend/public/apple-touch-icon.png", size: 180, art: 180, svg: mark, bg: "#0b5f86", flat: true },
  { out: "extension/icons/icon16.png", size: 16, art: 16, svg: markSmall },
  { out: "extension/icons/icon32.png", size: 32, art: 32, svg: mark },
  { out: "extension/icons/icon48.png", size: 48, art: 48, svg: mark },
  // Chrome Web Store: 96x96 artwork centred in a transparent 128x128 canvas
  { out: "extension/icons/icon128.png", size: 128, art: 96, svg: mark },
];

const promos = [
  { out: "store/promo-small-440x280.png", w: 440, h: 280, title: 0.2, tag: 0.085 },
  { out: "store/promo-marquee-1400x560.png", w: 1400, h: 560, title: 0.22, tag: 0.085 },
  { out: "frontend/public/og-image.png", w: 1200, h: 630, title: 0.17, tag: 0.072 },
];

const browser = await chromium.launch();
try {
  for (const i of icons) {
    // iOS applies its own rounded mask, so the apple icon uses a square, full-bleed tile
    const svg = i.flat ? i.svg.replace(/ rx="7"/, "") : i.svg;
    const page = await browser.newPage({ viewport: { width: i.size, height: i.size }, deviceScaleFactor: 1 });
    await page.setContent(fill(iconTpl, { SIZE: i.size, ART: i.art, BG: i.bg ?? "transparent", MARK: svg }));
    mkdirSync(dirname(join(root, i.out)), { recursive: true });
    await page.screenshot({ path: join(root, i.out), omitBackground: !i.bg });
    await page.close();
    console.log("wrote", i.out);
  }
  for (const p of promos) {
    const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
    await page.setContent(fill(promoTpl, { W: p.w, H: p.h, TITLE: p.title, TAG: p.tag, MARK: mark }));
    mkdirSync(dirname(join(root, p.out)), { recursive: true });
    await page.screenshot({ path: join(root, p.out) });
    await page.close();
    console.log("wrote", p.out);
  }
} finally {
  await browser.close();
}
