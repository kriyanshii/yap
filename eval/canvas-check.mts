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

type Rel = "on" | "under" | "above" | "next_to" | "left_of" | "right_of";
type Spot = "left" | "right" | "top";
interface Expect {
  objects: { type: string; color?: string; count?: number; size?: "big" | "small" }[];
  relations?: ([string, Rel, string] | [string, Rel, string, "all" | "some"])[];
  spots?: [string, Spot][];
}
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
  { id: "purple-sun-tree", expect: { objects: [{ type: "tree" }, { type: "sun", color: "purple" }], relations: [["sun", "above", "tree"]] } },
  { id: "white-house-orange-cat", expect: { objects: [{ type: "house", color: "white" }, { type: "cat", color: "orange" }] } },
  { id: "tree-right-house-left", expect: { objects: [{ type: "tree" }, { type: "house" }], spots: [["tree", "right"], ["house", "left"]] } },
  { id: "small-house-big-cloud", expect: { objects: [{ type: "house", size: "small" }, { type: "cloud", size: "big" }], relations: [["house", "under", "cloud"]] } },
];

function holds(rel: Rel, a: SceneObject, b: SceneObject): boolean {
  switch (rel) {
    case "on": return a.y < b.y && Math.abs(a.x - b.x) <= 0.15;
    case "above": return a.y < b.y - 0.05;
    case "under": return a.y > b.y + 0.05;
    case "next_to": return Math.abs(a.x - b.x) <= 0.3 && Math.abs(a.y - b.y) <= 0.25;
    case "left_of": return a.x < b.x - 0.05;
    case "right_of": return a.x > b.x + 0.05;
  }
}

/** Problems with the final canvas, or [] if it shows the scene. */
function check(objects: SceneObject[], e: Expect): string[] {
  const problems: string[] = [];
  const of = (t: string) => objects.filter((o) => o.type === t);
  for (const want of e.objects) {
    const got = of(want.type);
    const n = want.count ?? 1;
    if (got.length !== n) problems.push(`${n} ${want.type}${n > 1 ? "s" : ""} expected, canvas has ${got.length}`);
    if (want.color && got.length && !got.some((o) => o.color === want.color)) problems.push(`no ${want.color} ${want.type} (got ${[...new Set(got.map((o) => o.color))].join(", ")})`);
    if (want.size === "big" && got.length && !got.some((o) => o.scale >= 1.3)) problems.push(`${want.type} isn't big`);
    if (want.size === "small" && got.length && !got.some((o) => o.scale <= 0.75)) problems.push(`${want.type} isn't small`);
  }
  const wanted = new Set(e.objects.map((o) => o.type));
  for (const o of objects) if (!wanted.has(o.type)) problems.push(`extra ${o.color} ${o.type}`);
  for (const [ta, rel, tb, mode = "all"] of (e.relations ?? []) as [string, Rel, string, ("all" | "some")?][]) {
    const as = of(ta), bs = of(tb);
    if (!as.length || !bs.length) continue;
    const ok = (a: SceneObject) => bs.some((b) => b !== a && holds(rel, a, b));
    if (mode === "all" ? !as.every(ok) : !as.some(ok)) problems.push(`${ta} isn't ${rel.replace("_", " ")} the ${tb}`);
  }
  for (const [t, spot] of e.spots ?? []) {
    const ok = of(t).some((o) => (spot === "left" ? o.x < 0.4 : spot === "right" ? o.x > 0.6 : o.y < 0.35));
    if (of(t).length && !ok) problems.push(`${t} isn't at the ${spot}`);
  }
  return problems;
}

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
const results: { id: string; scene: string; banned: string[]; lines: LineResult[]; objects: SceneObject[]; problems: string[]; bannedSaid: string[] }[] = [];
for (const c of CASES) {
  const scene = DEMO_SCENES.find((s) => s.id === c.id)!;
  const engine = new SceneEngine();
  const lines: LineResult[] = [];
  for (const text of scene.hint!.phrases) {
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
  const problems = check(objects, c.expect);
  const bannedSaid = scene.hint!.phrases.filter((l) => hitsBanned(l, scene.banned));
  results.push({ id: c.id, scene: scene.text, banned: scene.banned, lines, objects, problems, bannedSaid });
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
