import { SceneEngine, type SceneObject } from '../src/scene/engine.ts';
import { schemaErrors } from './schema.ts';
import type { EvalCase, MapperInput, SceneOperation } from './types.ts';

export const POSITION_TOLERANCE = 0.05;

export interface Scores {
  valid_json: boolean;
  schema_valid: boolean;
  executable: boolean;
  exact_match: boolean;
  state_match: boolean;
  noop_correct: boolean | null; // null when the expected output is not []
  invented_objects: number;
  latency_ms: number;
}

export type Failure =
  | 'ok'
  | 'api_error'       // the mapper call itself failed (timeout, HTTP error, ...)
  | 'invalid_json'    // output did not parse into an op array
  | 'missed_noop'     // expected [], but ops were emitted
  | 'false_noop'      // expected ops, but [] was emitted
  | 'schema_invalid'  // fails the validate.mjs checks
  | 'not_executable'  // the engine rejects the batch
  | 'wrong_state'     // runs, but the final scene differs
  | 'inexact_ops';    // same final scene, different ops

/** Runs ops on a fresh engine seeded with the case input. Returns the final objects, or null if the batch is rejected. */
export function execute(input: MapperInput, ops: unknown): SceneObject[] | null {
  const engine = new SceneEngine({ objects: input.scene.objects, focus_id: input.focus_id });
  // The benchmark only gives history_len, not the prior scenes; placeholder snapshots make undo executable.
  engine.state.history = Array.from({ length: input.history_len }, () => engine.snapshot());
  return engine.execute(ops) ? engine.state.objects : null;
}

/** JSON with object keys sorted, so equality ignores key order. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map(k => [k, val[k]]))
      : val);
}

export function scenesMatch(a: SceneObject[], b: SceneObject[], tol = POSITION_TOLERANCE): boolean {
  if (a.length !== b.length) return false;
  return a.every(x => {
    const y = b.find(o => o.id === x.id);
    return !!y && x.type === y.type && x.color === y.color && Math.abs(x.scale - y.scale) < 1e-9
      && Math.abs(x.x - y.x) <= tol && Math.abs(x.y - y.y) <= tol;
  });
}

function addedTypes(ops: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const op of ops as any[]) if (op?.op === 'add' && typeof op.type === 'string') counts.set(op.type, (counts.get(op.type) ?? 0) + 1);
  return counts;
}

/** Number of added objects beyond what the expected ops add, per type. */
export function inventedObjects(predicted: unknown[], expected: SceneOperation[]): number {
  const want = addedTypes(expected);
  let extra = 0;
  for (const [type, n] of addedTypes(predicted)) extra += Math.max(0, n - (want.get(type) ?? 0));
  return extra;
}

export function scoreCase(c: EvalCase, pred: { raw: string; ops: SceneOperation[] | null }, latency_ms: number): { scores: Scores; failure: Failure } {
  const ops = pred.ops;
  const expectNoop = c.expected_ops.length === 0;
  const valid_json = Array.isArray(ops);
  const schema_valid = valid_json && schemaErrors(ops, c.input).length === 0;
  const finalScene = valid_json ? execute(c.input, ops) : null;
  const goldScene = execute(c.input, c.expected_ops);
  if (!goldScene) throw new Error(`${c.id}: expected_ops do not execute on the engine`);

  const scores: Scores = {
    valid_json,
    schema_valid,
    executable: finalScene !== null,
    exact_match: valid_json && canonical(ops) === canonical(c.expected_ops),
    state_match: finalScene !== null && scenesMatch(finalScene, goldScene),
    noop_correct: expectNoop ? valid_json && ops.length === 0 : null,
    invented_objects: valid_json ? inventedObjects(ops, c.expected_ops) : 0,
    latency_ms,
  };
  return { scores, failure: classify(scores, pred, expectNoop) };
}

function classify(s: Scores, pred: { raw: string; ops: SceneOperation[] | null }, expectNoop: boolean): Failure {
  if (!s.valid_json) return pred.raw.startsWith('error:') ? 'api_error' : 'invalid_json';
  if (s.exact_match) return 'ok';
  if (expectNoop) return 'missed_noop';
  if (pred.ops!.length === 0) return 'false_noop';
  if (!s.schema_valid) return 'schema_invalid';
  if (!s.executable) return 'not_executable';
  if (!s.state_match) return 'wrong_state';
  return 'inexact_ops';
}
