/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Canvas check: for every demo scene, say its hint phrases (no banned words) through the real mapper chain and scene
// engine, then put the descriptions next to the canvas they produced and check the canvas against the scene.
// Usage: npx tsx eval/canvas-check.mts        (reads .env; calls the live Qwen endpoint and Gemini)
// Writes results/canvas-check-<stamp>.html (open it in a browser) and .shots/canvas-check.png.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { SceneEngine, type SceneObject } from "../src/scene/engine.ts";
import { createStrokePlan } from "../src/paint/strokes.ts";
import { DEMO_SCENES } from "../party/demoScenes.ts";
import { describeOps } from "../party/describe.ts";
import { sceneToDrawingOps } from "../party/sceneOps.ts";
import { bestGuessStep, defaultChain, mapUtterance, readMapperEnv, warmUpQwen } from "../party/sceneMapper.ts";
import { hitsBanned } from "../party/match.ts";
import { check, type Expect } from "./pictureCheck.ts";
import { SCENIC_CANVAS } from "./scenicCanvas.ts";

interface Case { id: string; expect: Expect }

// What each demo scene's canvas must show. The Yapper script is the scene's hint phrases (party/demoScenes.ts), so this
// checks the hints themselves draw the scene.
const CASES: Case[] = [
  { id: "cat-house-sun", expect: { objects: [{ type: "cat" }, { type: "house" }, { type: "sun" }], relations: [["cat", "on", "house"], ["sun", "above", "house"]] } },
  { id: "tree-red-house", expect: { objects: [{ type: "house", color: "red" }, { type: "tree" }], relations: [["tree", "next_to", "house"]] } },
  { id: "clouds-tree", expect: { objects: [{ type: "tree" }, { type: "cloud", count: 2 }], relations: [["cloud", "above", "tree"]] } },
  { id: "blue-cat-tree", expect: { objects: [{ type: "tree" }, { type: "cat", color: "blue" }], relations: [["cat", "under", "tree"]] } },
  { id: "sun-cloud-top", expect: { objects: [{ type: "sun" }, { type: "cloud" }], spots: [["sun", "top"], ["cloud", "top"]] } },
  { id: "yellow-house-sun", expect: { objects: [{ type: "house", color: "yellow" }, { type: "sun" }], relations: [["sun", "above", "house"]] } },
  { id: "three-trees", expect: { objects: [{ type: "tree", count: 3 }, { type: "cat" }] } },
  { id: "cat-tree-left", expect: { objects: [{ type: "tree" }, { type: "cat" }], relations: [["cat", "next_to", "tree"]], spots: [["tree", "left"]] } },
  { id: "gray-cloud-house", expect: { objects: [{ type: "house" }, { type: "cloud", color: "gray" }], relations: [["cloud", "above", "house"]] } },
  { id: "big-sun-small-cloud", expect: { objects: [{ type: "sun", size: "big" }, { type: "cloud", size: "small" }] } },
  { id: "pink-tree-green-cat", expect: { objects: [{ type: "tree", color: "pink" }, { type: "cat", color: "green" }] } },
  { id: "two-cats-house", expect: { objects: [{ type: "house" }, { type: "cat", count: 2 }], relations: [["cat", "on", "house"]] } },
  { id: "house-trees-sides", expect: { objects: [{ type: "house" }, { type: "tree", count: 2 }], relations: [["tree", "left_of", "house", "some"], ["tree", "right_of", "house", "some"]] } },
  { id: "black-cat-cloud", expect: { objects: [{ type: "cloud" }, { type: "cat", color: "black" }], relations: [["cat", "under", "cloud"]] } },
  { id: "white-house-orange-cat", expect: { objects: [{ type: "house", color: "white" }, { type: "cat", color: "orange" }] } },
  { id: "small-house-big-cloud", expect: { objects: [{ type: "house", size: "small" }, { type: "cloud", size: "big" }], relations: [["house", "under", "cloud"]] } },
  { id: "red-sun-blue-cloud", expect: { objects: [{ type: "sun", color: "red" }, { type: "cloud", color: "blue" }] } },
  { id: "house-left-sun-right", expect: { objects: [{ type: "house" }, { type: "sun" }], spots: [["house", "left"], ["sun", "right"]] } },
  { id: "moon-mountain", expect: { objects: [{ type: "mountain" }, { type: "moon" }], relations: [["moon", "above", "mountain"]] } },
  { id: "river-mountain", expect: { objects: [{ type: "mountain" }, { type: "river" }], relations: [["river", "under", "mountain"]], spots: [["mountain", "top"], ["river", "bottom"]] } },
  { id: "dog-house", expect: { objects: [{ type: "house" }, { type: "dog" }], relations: [["dog", "next_to", "house"]] } },
  { id: "person-house", expect: { objects: [{ type: "house" }, { type: "person" }], relations: [["person", "next_to", "house"]] } },
  { id: "birds-tree", expect: { objects: [{ type: "tree" }, { type: "bird", count: 2 }], relations: [["bird", "above", "tree"]] } },
  { id: "fish-boat", expect: { objects: [{ type: "boat" }, { type: "fish", size: "small" }], relations: [["fish", "next_to", "boat"]] } },
  { id: "red-car-house", expect: { objects: [{ type: "house" }, { type: "car", color: "red", size: "big" }], relations: [["car", "next_to", "house"]] } },
  { id: "windmill-person", expect: { objects: [{ type: "person" }, { type: "windmill" }], relations: [["windmill", "left_of", "person"]] } },
  { id: "bear-tree", expect: { objects: [{ type: "tree" }, { type: "bear", color: "brown" }], relations: [["bear", "next_to", "tree"]] } },
  { id: "dog-person", expect: { objects: [{ type: "person" }, { type: "dog" }], relations: [["dog", "next_to", "person"]] } },
  { id: "person-tree", expect: { objects: [{ type: "tree" }, { type: "person" }], relations: [["person", "under", "tree"]] } },
];
const caseIds = new Set(CASES.map((c) => c.id));
const sceneIds = new Set(DEMO_SCENES.map((s) => s.id));
for (const id of sceneIds) if (!caseIds.has(id)) throw new Error(`no canvas case for ${id}`);
for (const id of caseIds) if (!sceneIds.has(id)) throw new Error(`canvas case ${id} is not a demo scene`);

function svg(objects: SceneObject[]): string {
  const plan = createStrokePlan("scene", 4242, 1, sceneToDrawingOps(objects));
  const paths = plan.strokes.map((s) =>
    `<path d="M${s.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}${s.closed ? " Z" : ""}" fill="${s.closed && s.fill ? s.fill : "none"}" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="260" height="260"><rect width="320" height="320" fill="#f8f8f8"/>${objects.length ? paths : ""}</svg>`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

process.loadEnvFile(new URL("../.env", import.meta.url));
const env = readMapperEnv(process.env as Record<string, unknown>);
console.log(`warm-up: ${await warmUpQwen(env)} ms`);

type LineResult = { text: string; mapper: string; ms: number; did: string; chain: string; ops: string };
type Script = { id: string; text: string; banned: string[]; phrases: string[]; expect: Expect };
const scripts: Script[] = [
  ...CASES.map((c) => {
    const scene = DEMO_SCENES.find((s) => s.id === c.id)!;
    return { id: c.id, text: scene.text, banned: scene.banned, phrases: scene.hint!.phrases, expect: c.expect };
  }),
  // Descriptions that never say the stamp. Not in the live clue pack.
  ...SCENIC_CANVAS.map((s) => ({ id: s.id, text: s.text, banned: s.banned, phrases: s.phrases, expect: s.expect })),
];
const results: { id: string; scene: string; banned: string[]; lines: LineResult[]; objects: SceneObject[]; problems: string[]; bannedSaid: string[] }[] = [];
for (const scene of scripts) {
  const engine = new SceneEngine();
  const lines: LineResult[] = [];
  for (const text of scene.phrases) {
    const before = engine.snapshot().objects;
    const r = await mapUtterance(
      { utterance: text, scene: { objects: before }, focus_id: engine.state.focus_id, history_len: engine.state.history.length },
      (ops) => engine.execute(ops), defaultChain(env), bestGuessStep(env));
    lines.push({
      text, mapper: r.mapper ?? "none", ms: r.ms,
      did: !r.mapper ? "all mappers failed" : r.ops.length ? describeOps(r.ops, before) : "nothing drawn",
      chain: r.attempts.map((a) => `${a.mapper}:${a.outcome}`).join(" > "),
      ops: JSON.stringify(r.ops),
    });
  }
  const objects = engine.state.objects;
  const problems = check(objects, scene.expect);
  const bannedSaid = scene.phrases.filter((l) => hitsBanned(l, scene.banned));
  results.push({ id: scene.id, scene: scene.text, banned: scene.banned, lines, objects, problems, bannedSaid });
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${scene.text}${problems.length ? `  (${problems.join("; ")})` : ""}`);
  for (const l of lines) console.log(`        "${l.text}" -> [${l.mapper} ${l.ms}ms] ${l.did}  ${l.ops}`);
}

const all = results.flatMap((r) => r.lines);
const count = (m: string) => all.filter((l) => l.mapper === m).length;
const passed = results.filter((r) => !r.problems.length).length;
const ms = all.map((l) => l.ms).sort((a, b) => a - b);
const summary = `${passed}/${results.length} scenes drawn correctly · ${all.length} lines: Qwen ${count("qwen")}, best guess ${count("best_guess")}, Gemini ${count("gemini")}, keyword ${count("keyword")}, none ${count("none")} · median ${ms[ms.length >> 1]} ms`;
console.log(`\n${summary}`);

const MAPPER_COLOR: Record<string, string> = { qwen: "#0a7d32", best_guess: "#7a3fb0", gemini: "#1d4fbf", keyword: "#8a5a00", none: "#b00020" };
const html = `<!doctype html><meta charset="utf-8"><title>Yap canvas check</title>
<style>
body{font:14px Tahoma,Segoe UI,sans-serif;background:#c0c0c0;margin:16px}h1{margin:0 0 4px}.sum{margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{background:#fff;border:2px solid #000;padding:10px;display:grid;grid-template-columns:260px 1fr;gap:10px}
.card.fail{border-color:#b00020}.card.pass{border-color:#2f8a38}
.head{grid-column:1/-1;display:flex;justify-content:space-between;align-items:baseline}
.badge{font-weight:700;padding:1px 6px;color:#fff}.pass .badge{background:#2f8a38}.fail .badge{background:#b00020}
ol{margin:0;padding-left:18px}li{margin:0 0 6px}q{font-style:italic}.m{font-size:11px;font-weight:700}.did{color:#333;font-size:12px}
.prob{color:#b00020;font-size:12px;margin-top:6px}.banned{font-size:11px;color:#666}svg{border:1px solid #000}.ops{font-size:10px;color:#555;word-break:break-all}
</style>
<h1>Yap canvas check</h1><p class="sum">${esc(summary)}</p><div class="grid">
${results.map((r) => `<div class="card ${r.problems.length ? "fail" : "pass"}">
<div class="head"><b>${esc(r.scene)}</b><span class="badge">${r.problems.length ? "FAIL" : "PASS"}</span></div>
<div>${svg(r.objects)}<div class="banned">Banned: ${r.banned.join(", ")}${r.bannedSaid.length ? ` · SAID: ${esc(r.bannedSaid.join(" | "))}` : ""}</div></div>
<div><ol>${r.lines.map((l) => `<li><q>${esc(l.text)}</q><br><span class="m" style="color:${MAPPER_COLOR[l.mapper] ?? "#000"}">${l.mapper} · ${l.ms} ms</span> <span class="did">${esc(l.did)}</span><br><code class="ops">${esc(l.ops)}</code></li>`).join("")}</ol>
${r.problems.length ? `<div class="prob">✗ ${esc(r.problems.join("; "))}</div>` : ""}</div></div>`).join("\n")}
</div>`;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
const htmlPath = new URL(`../results/canvas-check-${stamp}.html`, import.meta.url).pathname;
writeFileSync(htmlPath, html);
mkdirSync(new URL("../.shots/", import.meta.url), { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1800, height: 1000 });
await page.goto(`file://${htmlPath}`);
await page.screenshot({ path: new URL("../.shots/canvas-check.png", import.meta.url).pathname, fullPage: true });
await browser.close();
console.log(`report: ${htmlPath}\nimage: .shots/canvas-check.png`);
