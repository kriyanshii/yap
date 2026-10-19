// Pipeline: intent (ops chosen in code) -> template text -> paraphrase -> noise -> validation -> leakage filter -> dedupe.
import type { Op } from '../../src/scene/engine.ts';
import { caseErrors } from '../../eval/schema.ts';
import { canonical, execute } from '../../eval/scorer.ts';
import type { MapperInput } from '../../eval/types.ts';
import { CATEGORY_WEIGHTS, ENGINE_CHECKED, UNSUPPORTED_COLORS, UNSUPPORTED_NOUNS, sampleIntent, type Category, type EmptyReason, type Intent } from './intents.ts';
import { loadBenchmarkUtterances, nearestLeak, normalize, type BenchUtterance } from './leakage.ts';
import { applyNoise, speechCase } from './noise.ts';
import { ruleParaphraser, slotsPreserved, type Paraphraser } from './paraphrase.ts';
import { SFT_SYSTEM_PROMPT, userContent } from './prompt.ts';
import { Rng } from './rng.ts';

export const P_PARAPHRASE = 0.35;
/** Noise on non-messy categories; messy (15%) is always noisy, so the overall rate is about 0.15 + 0.85 * 0.18 = 30%. */
export const P_NOISE = 0.18;
export const P_MISHEAR = { messy: 0.4, other: 0.25 };
export const P_FORMATTED = 0.1;

export interface ChatExample { messages: { role: 'system' | 'user' | 'assistant'; content: string }[] }
export interface ExampleMeta {
  id: string;
  category: Category;
  subtype: string;
  reason: EmptyReason | null;
  /** strict, or inferred for indirect descriptions and repaired mishears (V2-R4). Not part of the model input. */
  policy: 'strict' | 'inferred';
  template: string;
  paraphrased: boolean;
  paraphrase_model: string | null;
  paraphrase_rules: string[];
  noise: string[];
  mishear: boolean;
  formatted: boolean;
  /** How a [] label was checked: "engine" = the would-be ops fail on the engine; otherwise by construction. */
  verified_by: 'engine' | 'construction' | null;
}
export interface Example { input: MapperInput; ops: Op[]; meta: ExampleMeta }
export interface GenOptions { n: number; seed: number; valN?: number; paraphraser?: Paraphraser; bench?: BenchUtterance[] }
export interface GenResult {
  train: Example[];
  val: Example[];
  drops: { unsatisfiable: number; leak: Record<string, number>; duplicate: number; val_overlaps_train: number; paraphrase_rejected: number };
  seed: number;
}

const CATEGORIES = Object.keys(CATEGORY_WEIGHTS) as Category[];

export function quotas(n: number): Record<Category, number> {
  const q = Object.fromEntries(CATEGORIES.map(c => [c, Math.round(CATEGORY_WEIGHTS[c] * n)])) as Record<Category, number>;
  q.simple += n - Object.values(q).reduce((s, v) => s + v, 0);
  return q;
}

/** The benchmark category a training example is checked as (caseErrors requires a known category and the inferred-only rule). */
function benchCategory(it: Intent, mishear: boolean): string {
  if (it.category === 'indirect') return 'indirect';
  if (it.category === 'messy') return mishear ? 'asr_errors' : 'messy_speech';
  if (it.category === 'multi_place') return 'multi_step';
  if (it.category === 'references') return 'references';
  if (it.category === 'simple') return it.ops[0].op === 'add' ? 'add' : it.ops[0].op === 'undo' || it.ops[0].op === 'clear' ? 'undo_clear' : 'edit';
  return it.reason === 'unsupported_object' || it.reason === 'chatter' ? 'unsupported_mix'
    : it.reason === 'unsupported_color' ? 'edits_tricky'
    : it.reason === 'undo_no_history' || it.reason === 'undo_clear_combo' ? 'undo_clear_tricky' : 'references';
}

/** Throws if an example breaks the benchmark schema, does not run on the engine, or has an unverifiable [] reason. */
export function validateExample(ex: Example, k = 0): void {
  const category = benchCategory({ category: ex.meta.category, ops: ex.ops, reason: ex.meta.reason ?? undefined } as Intent, ex.meta.mishear);
  const rec = { id: `${category}_${String(k % 1000).padStart(3, '0')}`, category, policy: ex.meta.policy, input: ex.input, expected_ops: ex.ops };
  const errs = caseErrors(rec);
  if (errs.length) throw new Error(`${ex.meta.subtype} "${ex.input.utterance}": ${errs.join('; ')}`);
  if (!execute(ex.input, ex.ops)) throw new Error(`${ex.meta.subtype} "${ex.input.utterance}": ops do not run on the engine`);
}

function checkReason(it: Intent, text: string): 'engine' | 'construction' {
  const r = it.reason!;
  if (ENGINE_CHECKED.includes(r)) {
    if (!it.rejected) throw new Error(`${it.subtype}: ${r} needs rejected ops`);
    if (execute(it.input, it.rejected)) throw new Error(`${it.subtype} "${text}": rejected ops run on the engine, so ${r} is wrong`);
    return 'engine';
  }
  const ok = r === 'no_focus' ? it.input.focus_id === null
    : r === 'unsupported_object' ? UNSUPPORTED_NOUNS.some(w => new RegExp(`\\b${w}\\b`).test(it.input.utterance)) || / with | wearing | holding /.test(it.input.utterance)
    : r === 'unsupported_color' ? UNSUPPORTED_COLORS.some(w => new RegExp(`\\b${w}\\b`).test(it.input.utterance)) || /\bnot\b/.test(it.input.utterance)
    : true;
  if (!ok) throw new Error(`${it.subtype} "${text}": ${r} not supported by the text/scene`);
  return 'construction';
}

const capitalize = (t: string) => t[0].toUpperCase() + t.slice(1) + (/^(can|could)\b/.test(t) ? '?' : '.');

function makeExample(rng: Rng, category: Category, paraphraser: Paraphraser, drops: GenResult['drops']): Example | null {
  const it = sampleIntent(rng, category);
  if (!it) { drops.unsatisfiable++; return null; }
  const verified_by = it.reason ? checkReason(it, it.input.utterance) : null;
  const template = it.input.utterance;
  let text = template;

  let para: { text: string; rules: string[] } | null = null;
  if (rng.chance(P_PARAPHRASE)) {
    const p = paraphraser.paraphrase(text, rng);
    if (p && slotsPreserved(text, p.text)) { para = p; text = p.text; } else if (p) drops.paraphrase_rejected++;
  }

  const noisy = category === 'messy' || rng.chance(P_NOISE);
  const noise = noisy ? applyNoise(text, it.ops, rng, { mishear: rng.chance(category === 'messy' ? P_MISHEAR.messy : P_MISHEAR.other) }) : null;
  if (noise) text = noise.text;
  const formatted = !noisy && rng.chance(P_FORMATTED);
  text = formatted ? capitalize(speechCase(text)) : speechCase(text);

  const mishear = noise?.mishear ?? false;
  return {
    input: { ...it.input, utterance: text },
    ops: it.ops,
    meta: {
      id: '', category, subtype: it.subtype, reason: it.reason ?? null, policy: mishear ? 'inferred' : it.policy, template,
      paraphrased: !!para, paraphrase_model: para ? paraphraser.name : null, paraphrase_rules: para?.rules ?? [],
      noise: noise?.noise ?? [], mishear, formatted, verified_by,
    },
  };
}

const dedupeKey = (ex: Example) => `${normalize(ex.input.utterance)}|${canonical([ex.input.scene, ex.input.focus_id, ex.input.history_len])}`;

export function generate(opts: GenOptions): GenResult {
  const rng = new Rng(opts.seed);
  const paraphraser = opts.paraphraser ?? ruleParaphraser;
  const bench = opts.bench ?? loadBenchmarkUtterances();
  const drops: GenResult['drops'] = { unsatisfiable: 0, leak: {}, duplicate: 0, val_overlaps_train: 0, paraphrase_rejected: 0 };
  const seen = new Set<string>();
  const trainUtterances = new Set<string>();

  const fill = (n: number, split: 'train' | 'val'): Example[] => {
    const out: Example[] = [];
    for (const [category, quota] of Object.entries(quotas(n)) as [Category, number][]) {
      let got = 0;
      for (let attempts = 0; got < quota; attempts++) {
        if (attempts > quota * 200 + 1000) throw new Error(`could not fill ${split}/${category}: ${got}/${quota} after ${attempts} attempts`);
        const ex = makeExample(rng, category, paraphraser, drops);
        if (!ex) continue;
        validateExample(ex, out.length);
        if (nearestLeak(ex.input.utterance, bench)) { drops.leak[category] = (drops.leak[category] ?? 0) + 1; continue; }
        const key = dedupeKey(ex);
        if (seen.has(key)) { drops.duplicate++; continue; }
        if (split === 'val' && trainUtterances.has(normalize(ex.input.utterance))) { drops.val_overlaps_train++; continue; }
        seen.add(key);
        if (split === 'train') trainUtterances.add(normalize(ex.input.utterance));
        out.push(ex);
        got++;
      }
    }
    return rng.shuffle(out).map((ex, i) => ({ ...ex, meta: { ...ex.meta, id: `${split}_${String(i + 1).padStart(5, '0')}` } }));
  };

  const train = fill(opts.n, 'train');
  const val = fill(opts.valN ?? Math.round(opts.n / 10), 'val');
  return { train, val, drops, seed: opts.seed };
}

export function toChat(ex: Example): ChatExample {
  return { messages: [
    { role: 'system', content: SFT_SYSTEM_PROMPT },
    { role: 'user', content: userContent(ex.input) },
    { role: 'assistant', content: JSON.stringify(ex.ops) },
  ] };
}
