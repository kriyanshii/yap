/// <reference lib="dom.iterable" />
/// <reference lib="dom" />
// Screenshots every game screen in real Chrome: entry, lobby, yapper and guesser views, reveal. Two players, one round.
// Usage: npx tsx eval/ui-shots.mts [baseUrl] [outDir]   (default http://localhost:5173, .shots/)
// Locally, run `npm run dev` first. Uses the installed Google Chrome via puppeteer-core (no browser download).
import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

const base = process.argv[2] ?? "http://localhost:5173";
const out = process.argv[3] ?? ".shots";
mkdirSync(out, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORTS = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clickText(page: Page, text: RegExp) {
  const ok = await page.evaluate((src: string) => {
    const re = new RegExp(src, "i");
    const el = [...document.querySelectorAll<HTMLElement>("button, a, [role=button]")].find((b) => re.test(b.innerText) && !(b as HTMLButtonElement).disabled);
    el?.click();
    return Boolean(el);
  }, text.source);
  if (!ok) throw new Error(`no enabled button matching ${text}`);
}
async function waitText(page: Page, text: RegExp, ms = 20000) {
  await page.waitForFunction((src: string) => new RegExp(src, "i").test(document.body.innerText), { timeout: ms }, text.source);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-ui-for-media-stream"] });
try {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    await host.setViewport(viewport);
    await guest.setViewport(viewport);

    await host.goto(base, { waitUntil: "networkidle0" });
    await shot(host, `${vpName}-01-entry`);
    await clickText(host, /how to play/);
    await sleep(300);
    await host.screenshot({ path: `${out}/${vpName}-01b-how-to-play.png` });
    await clickText(host, /got it/);
    await clickText(host, /create/);
    await host.waitForFunction(() => /[?&]room=[A-Z0-9]{4}/.test(location.search), { timeout: 10000 });
    const room = new URL(host.url()).searchParams.get("room")!;
    await sleep(800);
    await shot(host, `${vpName}-02-lobby-alone`);

    await guest.goto(`${base}/?room=${room}`, { waitUntil: "networkidle0" });
    await sleep(1500);
    await shot(guest, `${vpName}-03-lobby-guest`);
    await shot(host, `${vpName}-04-lobby-host-ready`);

    await clickText(host, /start/);
    await sleep(1200);
    await shot(host, `${vpName}-05-countdown`);
    await sleep(3500);
    const hostIsYapper = await host.evaluate(() => Boolean(document.querySelector("textarea")));
    const [yapper, guesser] = hostIsYapper ? [host, guest] : [guest, host];
    await shot(yapper, `${vpName}-06-play-yapper`);
    await shot(guesser, `${vpName}-07-play-guesser`);

    await clickText(yapper, /hint/);
    await sleep(800);
    await shot(yapper, `${vpName}-06b-yapper-hint`);
    await yapper.type("textarea", "the bright light that makes it daytime");
    await yapper.evaluate(() => (document.querySelector("form.type-row, form[data-role=yap]") as HTMLFormElement | null)?.requestSubmit());
    await sleep(5000);
    await shot(yapper, `${vpName}-08-yapper-after-paint`);
    await shot(guesser, `${vpName}-09-guesser-after-paint`);

    const secret = await yapper.evaluate(() => (document.querySelector("[data-secret], .clue-banner strong") as HTMLElement | null)?.innerText ?? "");
    await guesser.type("input[type=text], .guess-row input, form[data-role=guess] input", "a cat");
    await guesser.evaluate(() => (document.querySelector("form.guess-row, form[data-role=guess]") as HTMLFormElement | null)?.requestSubmit());
    await sleep(800);
    await shot(guesser, `${vpName}-10-guesser-wrong-guess`);
    await guesser.type("input[type=text], .guess-row input, form[data-role=guess] input", secret);
    await guesser.evaluate(() => (document.querySelector("form.guess-row, form[data-role=guess]") as HTMLFormElement | null)?.requestSubmit());
    await waitText(guesser, /next round|game over/, 15000);
    await sleep(1500);
    await shot(guesser, `${vpName}-11-reveal`);
    await host.close();
    await guest.close();
    console.log(`${vpName}: room ${room}, secret "${secret}", host ${hostIsYapper ? "yapped" : "guessed"}`);
  }
} finally {
  await browser.close();
}
console.log(`screenshots in ${out}/`);
