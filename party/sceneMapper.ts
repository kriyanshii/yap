// Speech -> scene ops for the game: Qwen (fine-tuned, Modal) -> Gemini (prompted, REST) -> keyword parser.
// A mapper is skipped on timeout, error, an output-guard rejection, or ops the scene engine refuses. A valid [] is an answer
// (the model refusing, e.g. chatter), not a failure. Only the utterance and the scene graph are sent, never the secret scene.
import type { Op } from "../src/scene/engine.ts";
import { GEMINI_MODEL, RESPONSE_SCHEMA, SYSTEM_PROMPT } from "../eval/mappers/geminiPrompt.ts";
import { keywordOps } from "../eval/mappers/keyword.ts";
import { QwenMapper, guardOps } from "../eval/mappers/qwen.ts";
import type { MapperInput, MapperResult } from "../eval/types.ts";

export const QWEN_TIMEOUT_MS = 3000;
/** Gemini's API latency varies (1.4–4.5 s measured); 8 s matches the original game planner's budget. */
export const GEMINI_TIMEOUT_MS = 8000;
const WARMUP_TIMEOUT_MS = 120_000;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type MapperName = "qwen" | "gemini" | "keyword";
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
export async function geminiScene(input: MapperInput, env: MapperEnv, timeoutMs = GEMINI_TIMEOUT_MS): Promise<MapperResult> {
  try {
    const res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(env.GEMINI_SCENE_MODEL ?? GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: "MINIMAL" } },
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

type Predictor = { name: MapperName; configured: boolean; predict: (input: MapperInput) => Promise<MapperResult> };

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
export async function mapUtterance(input: MapperInput, apply: (ops: Op[]) => boolean, chain: Predictor[]): Promise<MapOutcome> {
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
