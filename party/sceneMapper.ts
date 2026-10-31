// Speech -> scene ops for the game: Qwen (fine-tuned, Modal) -> Gemini (prompted, REST) -> keyword parser.
// A mapper is skipped on timeout, error, an output-guard rejection, or ops the scene engine refuses. A valid [] is an answer
// (the model refusing, e.g. chatter), not a failure. After a refusal, an optional "best guess" (Gemini, game prompt) may
// still draw new objects from a loose description; it can only add, never edit or remove.
// Only the utterance and the scene graph are sent, never the secret scene.
import { TYPES, type Op } from "../src/scene/engine.ts";
import { GEMINI_MODEL, RESPONSE_SCHEMA, SYSTEM_PROMPT } from "../eval/mappers/geminiPrompt.ts";
import { keywordOps } from "../eval/mappers/keyword.ts";
import { QwenMapper, guardOps } from "../eval/mappers/qwen.ts";
import type { MapperInput, MapperResult } from "../eval/types.ts";

export const QWEN_TIMEOUT_MS = 3000;
/** Gemini's API latency varies (1.4–4.5 s measured); 8 s matches the original game planner's budget. */
export const GEMINI_TIMEOUT_MS = 8000;
const WARMUP_TIMEOUT_MS = 120_000;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type MapperName = "qwen" | "gemini" | "keyword" | "best_guess";
export type AttemptOutcome = "ok" | "timeout" | "error" | "guard_rejected" | "engine_rejected" | "not_configured";

export interface Attempt {
  mapper: MapperName;
  outcome: AttemptOutcome;
  ms: number;
  raw: string;
}

export interface MapOutcome {
  /** The mapper whose ops were applied, or null if every mapper failed (the scene is unchanged). */
  mapper: MapperName | null;
  ops: Op[];
  attempts: Attempt[];
  ms: number;
}

export interface MapperEnv {
  QWEN_ENDPOINT_URL?: string;
  MODAL_KEY?: string;
  MODAL_SECRET?: string;
  GEMINI_API_KEY?: string;
  GEMINI_SCENE_MODEL?: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
export function readMapperEnv(env: Record<string, unknown>): MapperEnv {
  return {
    QWEN_ENDPOINT_URL: str(env.QWEN_ENDPOINT_URL),
    MODAL_KEY: str(env.MODAL_KEY),
    MODAL_SECRET: str(env.MODAL_SECRET),
    GEMINI_API_KEY: str(env.GEMINI_API_KEY),
    GEMINI_SCENE_MODEL: str(env.GEMINI_SCENE_MODEL),
  };
}

const qwen = (env: MapperEnv, timeoutMs: number) =>
  new QwenMapper({ url: env.QWEN_ENDPOINT_URL!, key: env.MODAL_KEY, secret: env.MODAL_SECRET, guard: true, timeoutMs });

/** Gemini with the eval's scene-mapper prompt and schema, over REST (the SDK is Node-only), guarded like Qwen. */
export function geminiScene(input: MapperInput, env: MapperEnv, timeoutMs = GEMINI_TIMEOUT_MS): Promise<MapperResult> {
  return geminiCall(input, env, SYSTEM_PROMPT, RESPONSE_SCHEMA, timeoutMs);
}

async function geminiCall(input: MapperInput, env: MapperEnv, systemPrompt: string, schema: object, timeoutMs: number): Promise<MapperResult> {
  try {
    const res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(env.GEMINI_SCENE_MODEL ?? GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: "MINIMAL" } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { raw: `error: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, ops: null };
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { raw, ops: null }; }
    if (!Array.isArray(parsed)) return { raw, ops: null };
    const ops = guardOps(parsed as Op[], input);
    return { raw, ops, ...(parsed.length > 0 && ops.length === 0 && { guardRejected: true }) };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { raw: `error: ${timedOut ? `timeout after ${timeoutMs} ms` : e instanceof Error ? e.message : String(e)}`, ops: null };
  }
}

const ADD_ONLY_SCHEMA = { type: "array", items: RESPONSE_SCHEMA.items.anyOf[0] };

/** Game prompt for the best guess: players describe things loosely (shape, color, parts), so pick the closest type. */
export const BEST_GUESS_PROMPT = `You draw for a party guessing game. The player describes things on purpose without naming them, often by shape, color, parts or what they do.
The only things you can draw: ${TYPES.join(', ')}.
For each thing the utterance describes, add the single closest of those, even if the description is loose. Examples:
- "an orange round thing in the daytime" -> sun, color orange
- "something blue made of three circles on a line" -> cloud, color blue
- "a green blob on a stick" -> tree
- "a box with a triangle on top" -> house
- "a little animal with pointy ears that purrs" -> cat
- "a pet that barks and wags its tail" -> dog
- "a tall rocky peak" -> mountain
- "a flowing stream of water" -> river
- "the pale round light in the night sky" -> moon
- "someone with a face, arms and legs" -> person
- "an animal with a beak and wings" -> bird
- "an animal with fins that swims" -> fish
- "a vessel that floats and carries people" -> boat
- "a machine with four wheels" -> car
- "a tall tower with blades that spin in the wind" -> windmill
- "a big furry animal that likes honey" -> bear
Output a JSON array of add ops only: {"op":"add","type",["color"],["at"],["scale"]}.
Use color only if one is stated, from: red, orange, yellow, green, blue, purple, pink, brown, black, white, gray.
Use "at" only if a position is stated: a spot (left, right, center, top, bottom, top-left, top-right, bottom-left, bottom-right; "in the sky" or "up high" is top) or {"relation": on|near|above|below|left_of|right_of, "ref": <id of an object in the scene, or {"added_in_op": N} for an earlier add in this array>}.
Use scale 1.5 for big and 0.6 for small, only if stated.
If the utterance is chatter, a question, an edit of something already drawn, or describes nothing drawable, return [].`;

/** Best guess after a refusal: add-only, guarded, and any non-add op discards the whole answer. */
export async function geminiBestGuess(input: MapperInput, env: MapperEnv, timeoutMs = GEMINI_TIMEOUT_MS): Promise<MapperResult> {
  const r = await geminiCall(input, env, BEST_GUESS_PROMPT, ADD_ONLY_SCHEMA, timeoutMs);
  if (r.ops && r.ops.some((op) => op.op !== "add")) return { raw: r.raw, ops: [], guardRejected: true };
  return r;
}

type Predictor = { name: MapperName; configured: boolean; predict: (input: MapperInput) => Promise<MapperResult> };

/** The best-guess step, or undefined when Gemini isn't configured. */
export function bestGuessStep(env: MapperEnv): Predictor | undefined {
  return env.GEMINI_API_KEY ? { name: "best_guess", configured: true, predict: (i) => geminiBestGuess(i, env) } : undefined;
}

export function defaultChain(env: MapperEnv): Predictor[] {
  return [
    { name: "qwen", configured: !!env.QWEN_ENDPOINT_URL, predict: (i) => qwen(env, QWEN_TIMEOUT_MS).predict(i) },
    { name: "gemini", configured: !!env.GEMINI_API_KEY, predict: (i) => geminiScene(i, env) },
    { name: "keyword", configured: true, predict: async (i) => {
      const ops = keywordOps(i);
      return { raw: JSON.stringify(ops), ops: guardOps(ops, i) };
    } },
  ];
}

/**
 * Tries each mapper in order. `apply` runs the ops on the scene engine and returns false if the engine refuses them;
 * it is called at most once with ops it accepts, so one utterance is one undoable action.
 */
export async function mapUtterance(input: MapperInput, apply: (ops: Op[]) => boolean, chain: Predictor[], bestGuess?: Predictor): Promise<MapOutcome> {
  const start = Date.now();
  const attempts: Attempt[] = [];
  for (const m of chain) {
    if (!m.configured) { attempts.push({ mapper: m.name, outcome: "not_configured", ms: 0, raw: "" }); continue; }
    const t = Date.now();
    const r = await m.predict(input);
    const ms = Date.now() - t;
    if (r.ops === null) {
      attempts.push({ mapper: m.name, outcome: r.raw.startsWith("error: timeout") ? "timeout" : "error", ms, raw: r.raw });
      continue;
    }
    if (r.guardRejected) { attempts.push({ mapper: m.name, outcome: "guard_rejected", ms, raw: r.raw }); continue; }
    if (!apply(r.ops)) { attempts.push({ mapper: m.name, outcome: "engine_rejected", ms, raw: r.raw }); continue; }
    attempts.push({ mapper: m.name, outcome: "ok", ms, raw: r.raw });
    if (r.ops.length === 0 && bestGuess) {
      // The mapper refused. A loose description may still name something drawable: let the best guess add it.
      const g0 = Date.now();
      const g = await bestGuess.predict(input);
      const gms = Date.now() - g0;
      const outcome: AttemptOutcome = g.ops === null ? (g.raw.startsWith("error: timeout") ? "timeout" : "error")
        : g.guardRejected ? "guard_rejected" : g.ops.length === 0 ? "ok" : apply(g.ops) ? "ok" : "engine_rejected";
      attempts.push({ mapper: "best_guess", outcome, ms: gms, raw: g.raw });
      if (outcome === "ok" && g.ops && g.ops.length > 0) return { mapper: "best_guess", ops: g.ops, attempts, ms: Date.now() - start };
    }
    return { mapper: m.name, ops: r.ops, attempts, ms: Date.now() - start };
  }
  return { mapper: null, ops: [], attempts, ms: Date.now() - start };
}

/** Wakes the Qwen container so the first real utterance doesn't wait for a cold start. Resolves to ms, or null on failure. */
export async function warmUpQwen(env: MapperEnv): Promise<number | null> {
  if (!env.QWEN_ENDPOINT_URL) return null;
  const t = Date.now();
  const r = await qwen(env, WARMUP_TIMEOUT_MS).predict({ utterance: "hello", scene: { objects: [] }, focus_id: null, history_len: 0 });
  return r.ops === null ? null : Date.now() - t;
}
