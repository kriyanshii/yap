import { describe, expect, it } from "vitest";
import type { MapperResult } from "../eval/types";
import { createStrokePlan } from "../src/paint/strokes";
import { SceneEngine, TYPES, type SceneObject } from "../src/scene/engine";
import { DEMO_SCENES } from "./demoScenes";
import { hitsBanned, sceneGuessMatches } from "./match";
import { mapUtterance, type MapperName } from "./sceneMapper";
import { sceneToDrawingOps } from "./sceneOps";
import { DRAWING_STAMPS } from "./types";

type Step = MapperResult | "throw-timeout";
function chain(steps: Partial<Record<MapperName, Step>>, seen: unknown[] = []) {
  return (["qwen", "gemini", "keyword"] as const).map((name) => ({
    name,
    configured: name in steps,
    predict: async (input: unknown) => {
      seen.push({ name, input });
      const step = steps[name]!;
      return step === "throw-timeout" ? { raw: "error: timeout after 3000 ms", ops: null } : step;
    },
  }));
}
const input = (engine: SceneEngine, utterance = "draw a cat") => ({
  utterance, scene: { objects: engine.state.objects }, focus_id: engine.state.focus_id, history_len: engine.state.history.length,
});
const cat = [{ op: "add" as const, type: "cat" as const }];

describe("mapUtterance fallback chain", () => {
  it("uses Qwen when it answers", async () => {
    const engine = new SceneEngine();
    const r = await mapUtterance(input(engine), (ops) => engine.execute(ops), chain({ qwen: { raw: "[]", ops: cat }, gemini: { raw: "", ops: [] } }));
    expect(r.mapper).toBe("qwen");
    expect(engine.state.objects.map((o) => o.type)).toEqual(["cat"]);
    expect(engine.state.history).toHaveLength(1);
  });

  it("falls back to Gemini on a Qwen timeout, error or guard rejection", async () => {
    for (const qwen of ["throw-timeout", { raw: "error: HTTP 500", ops: null }, { raw: '[{"op":"add","type":"dog"}]', ops: [], guardRejected: true }] as Step[]) {
      const engine = new SceneEngine();
      const r = await mapUtterance(input(engine), (ops) => engine.execute(ops), chain({ qwen, gemini: { raw: "", ops: cat }, keyword: { raw: "", ops: [] } }));
      expect(r.mapper).toBe("gemini");
      expect(r.attempts.map((a) => a.outcome)).toEqual([expect.stringMatching(/timeout|error|guard_rejected/), "ok"]);
      expect(engine.state.objects).toHaveLength(1);
    }
  });

  it("falls back when the engine refuses the ops, and only applies one batch", async () => {
    const engine = new SceneEngine();
    const bad = [{ op: "delete" as const, target: "tree_9" }];
    const r = await mapUtterance(input(engine), (ops) => engine.execute(ops), chain({ qwen: { raw: "", ops: bad }, gemini: "throw-timeout", keyword: { raw: "", ops: cat } }));
    expect(r.mapper).toBe("keyword");
    expect(r.attempts.map((a) => a.outcome)).toEqual(["engine_rejected", "timeout", "ok"]);
    expect(engine.state.history).toHaveLength(1);
  });

  it("treats a valid [] as an answer (the model refusing), not a failure", async () => {
    const engine = new SceneEngine();
    const r = await mapUtterance(input(engine, "this game is fun"), (ops) => engine.execute(ops), chain({ qwen: { raw: "[]", ops: [] }, gemini: { raw: "", ops: cat } }));
    expect(r.mapper).toBe("qwen");
    expect(r.ops).toEqual([]);
    expect(engine.state.objects).toHaveLength(0);
  });

  it("never clears the canvas when every mapper fails", async () => {
    const engine = new SceneEngine();
    engine.execute([{ op: "add", type: "tree" }]);
    const before = engine.snapshot();
    const r = await mapUtterance(input(engine), (ops) => engine.execute(ops), chain({ qwen: "throw-timeout", gemini: { raw: "error: HTTP 429", ops: null }, keyword: { raw: "", ops: [{ op: "delete", target: "cat_1" }] } }));
    expect(r.mapper).toBeNull();
    expect(engine.snapshot()).toEqual(before);
  });

  it("skips unconfigured mappers and sends only the mapper input (never the secret scene)", async () => {
    const engine = new SceneEngine();
    const seen: { name: string; input: object }[] = [];
    const r = await mapUtterance(input(engine), (ops) => engine.execute(ops), chain({ keyword: { raw: "", ops: cat } }, seen));
    expect(r.attempts.map((a) => `${a.mapper}:${a.outcome}`)).toEqual(["qwen:not_configured", "gemini:not_configured", "keyword:ok"]);
    for (const s of seen) expect(Object.keys(s.input).sort()).toEqual(["focus_id", "history_len", "scene", "utterance"]);
  });
});

describe("best guess after a refusal", () => {
  const guess = (r: Step, calls: string[] = []) => ({
    name: "best_guess" as const, configured: true,
    predict: async () => { calls.push("guess"); return r === "throw-timeout" ? { raw: "error: timeout after 8000 ms", ops: null } : r; },
  });
  const orangeSun = [{ op: "add" as const, type: "sun" as const, color: "orange" as const }];

  it("draws the guess when the model refused a loose description", async () => {
    const engine = new SceneEngine();
    const r = await mapUtterance(input(engine, "an orange round thing"), (ops) => engine.execute(ops),
      chain({ qwen: { raw: "[]", ops: [] } }), guess({ raw: "", ops: orangeSun }));
    expect(r.mapper).toBe("best_guess");
    expect(r.attempts.map((a) => `${a.mapper}:${a.outcome}`)).toEqual(["qwen:ok", "best_guess:ok"]);
    expect(engine.state.objects.map((o) => `${o.type}:${o.color}`)).toEqual(["sun:orange"]);
    expect(engine.state.history).toHaveLength(1);
  });

  it("is never called when the model already drew something", async () => {
    const engine = new SceneEngine();
    const calls: string[] = [];
    const r = await mapUtterance(input(engine), (ops) => engine.execute(ops), chain({ qwen: { raw: "", ops: cat } }), guess({ raw: "", ops: orangeSun }, calls));
    expect(r.mapper).toBe("qwen");
    expect(calls).toEqual([]);
  });

  it("keeps the refusal when the guess is [] (chatter), times out, or suggests anything but adds", async () => {
    for (const g of [{ raw: "[]", ops: [] }, "throw-timeout", { raw: '[{"op":"clear"}]', ops: [], guardRejected: true }] as Step[]) {
      const engine = new SceneEngine();
      engine.execute([{ op: "add", type: "tree" }]);
      const before = engine.snapshot();
      const r = await mapUtterance(input(engine, "this game is hard lol"), (ops) => engine.execute(ops), chain({ qwen: { raw: "[]", ops: [] } }), guess(g));
      expect(r.mapper).toBe("qwen");
      expect(r.ops).toEqual([]);
      expect(engine.snapshot()).toEqual(before);
    }
  });
});

describe("demo scenes", () => {
  const otherStamps = DRAWING_STAMPS.filter((s) => !(TYPES as readonly string[]).includes(s));

  it("has 15-30 scenes with unique ids", () => {
    expect(DEMO_SCENES.length).toBeGreaterThanOrEqual(15);
    expect(DEMO_SCENES.length).toBeLessThanOrEqual(30);
    expect(new Set(DEMO_SCENES.map((s) => s.id)).size).toBe(DEMO_SCENES.length);
  });

  it("uses only cat, tree, house, sun and cloud, and bans exactly the object nouns from its own text", () => {
    for (const s of DEMO_SCENES) {
      const words = s.text.split(/\s+/);
      for (const stamp of otherStamps) expect(words, s.id).not.toContain(stamp);
      expect(s.banned.length, s.id).toBeGreaterThan(0);
      for (const b of s.banned) {
        expect(TYPES as readonly string[], s.id).toContain(b);
        expect(hitsBanned(s.text, [b]), `${s.id}: "${b}" is in the text`).toBe(true);
      }
      const named = TYPES.filter((t) => hitsBanned(s.text, [t]));
      expect([...s.banned].sort(), `${s.id}: every object noun in the text is banned`).toEqual([...named].sort());
    }
  });

  it("accepts a guess that names every object and color, in any order", () => {
    const blueCat = DEMO_SCENES.find((s) => s.id === "blue-cat-tree")!;
    expect(sceneGuessMatches("tree and a blue cat", blueCat.required!)).toBe(true);
    expect(sceneGuessMatches("blue cats under trees", blueCat.required!)).toBe(true);
    expect(sceneGuessMatches("a cat under a tree", blueCat.required!)).toBe(false);
    expect(sceneGuessMatches("a blue cat", blueCat.required!)).toBe(false);
  });
});

describe("demo scene hints", () => {
  it("every scene has a hint: a one-line meaning and 2-4 phrases, none with a banned word", () => {
    for (const s of DEMO_SCENES) {
      expect(s.hint, s.id).toBeDefined();
      expect(s.hint!.phrases.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.hint!.phrases.length, s.id).toBeLessThanOrEqual(4);
      for (const text of [s.hint!.meaning, ...s.hint!.phrases]) {
        expect(hitsBanned(text, s.banned), `${s.id}: "${text}" uses a banned word`).toBe(false);
      }
    }
  });
});

describe("scene layout", () => {
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.12 && Math.abs(a.y - b.y) < 0.12;
  it("never stacks objects on the same spot across utterances", () => {
    const engine = new SceneEngine();
    engine.execute([{ op: "add", type: "house" }]);
    engine.execute([{ op: "add", type: "sun" }]);                                   // no position: must not hide behind the house
    engine.execute([{ op: "add", type: "cat", at: { relation: "on", ref: "house_1" } }, { op: "add", type: "cat", at: { relation: "on", ref: "house_1" } }]);
    const objs = engine.state.objects;
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
      const [a, b] = [objs[i], objs[j]];
      const onPair = (a.type === "cat" && b.type === "house") || (a.type === "house" && b.type === "cat");
      if (!onPair) expect(near(a, b), `${a.id} and ${b.id} overlap`).toBe(false);
    }
    const [cat1, cat2] = objs.filter((o) => o.type === "cat");
    expect(cat1.y).toBe(cat2.y);                                                      // both still on the roof, side by side
  });

  it("spreads repeats until their boxes clear and leaves a free spot put", () => {
    const engine = new SceneEngine();
    engine.execute([{ op: "add", type: "tree" }, { op: "add", type: "tree" }, { op: "add", type: "tree" }]);
    expect(engine.state.objects.map((o) => o.x)).toEqual([0.5, 0.26, 0.74]);
    engine.execute([{ op: "move", target: "tree_1", to: "center" }]);              // moving onto its own spot stays put
    expect(engine.state.objects[0].x).toBe(0.5);
  });

  it("adding 3 trees with no position produces non-overlapping bounding boxes", () => {
    const engine = new SceneEngine();
    engine.execute([{ op: "add", type: "tree" }, { op: "add", type: "tree" }, { op: "add", type: "tree" }]);
    const boxes = engine.state.objects.map(stampBox);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
      expect(overlap, `${a.id} and ${b.id} overlap`).toBe(false);
    }
  });
});

function stampBox(object: SceneObject) {
  const plan = createStrokePlan("scene", 1, 1, sceneToDrawingOps([object]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of plan.strokes) for (const point of stroke.points) {
    const pad = stroke.width / 2;
    minX = Math.min(minX, point.x - pad);
    minY = Math.min(minY, point.y - pad);
    maxX = Math.max(maxX, point.x + pad);
    maxY = Math.max(maxY, point.y + pad);
  }
  return { id: object.id, minX, minY, maxX, maxY };
}
