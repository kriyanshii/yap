// Renders the launch-video cards (media/cards.html) to PNG in real Chrome.
// Usage: npx tsx media/render.mts   -> media/out/{chart,end}-{16x9,1x1}.png
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const html = new URL("./cards.html", import.meta.url).href;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
for (const [size, viewport] of [["16x9", { width: 1920, height: 1080 }], ["1x1", { width: 1080, height: 1080 }]] as const) {
  await page.setViewport(viewport);
  for (const card of ["chart", "end"]) {
    await page.goto(`${html}?card=${card}`, { waitUntil: "load" });
    await page.screenshot({ path: `${out}${card}-${size}.png` });
    console.log(`media/out/${card}-${size}.png`);
  }
}
await browser.close();
