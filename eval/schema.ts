// Checks ported from validate.mjs: `schemaErrors` holds predictions to the `expected_ops` rules, `caseErrors` checks a whole benchmark case.
import { COLORS, RELATIONS, SPOTS, TYPES } from '../src/scene/engine.ts';
import type { MapperInput } from './types.ts';

export const CATEGORIES = ['add', 'relation', 'focus', 'edit', 'undo_clear', 'self_correction', 'paraphrase_strict', 'paraphrase_inferred', 'unsupported',
  // v2-hard categories (see README-v2.md)
  'messy_speech', 'asr_errors', 'multi_step', 'indirect', 'references', 'unsupported_mix', 'edits_tricky', 'undo_clear_tricky'] as const;
export const POLICIES = ['strict', 'inferred'] as const;
/** Categories whose cases must use policy "inferred". */
export const INFERRED_ONLY: readonly string[] = ['paraphrase_inferred', 'indirect'];

const OP_KEYS: Record<string, { req: string[]; opt: string[] }> = {
  add: { req: ['op', 'type'], opt: ['color', 'at', 'scale'] },
  recolor: { req: ['op', 'target', 'color'], opt: [] },
  move: { req: ['op', 'target', 'to'], opt: [] },
  scale: { req: ['op', 'target', 'factor'], opt: [] },
  delete: { req: ['op', 'target'], opt: [] },
  undo: { req: ['op'], opt: [] },
  clear: { req: ['op'], opt: [] },
};
const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const has = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** Returns a list of schema errors; empty means the ops are valid for this input. */
export function schemaErrors(ops: unknown, input: MapperInput): string[] {
  const errors: string[] = [];
  if (!Array.isArray(ops)) return ['ops must be an array'];
  const sceneIds = new Set(input.scene.objects.map(o => o.id));
  const deleted = new Set<string>();

  const checkTarget = (t: unknown, w: string) => {
    if (typeof t !== 'string') return errors.push(`${w} target must be an existing scene id string`);
    if (!sceneIds.has(t)) errors.push(`${w} target "${t}" not in scene`);
    else if (deleted.has(t)) errors.push(`${w} target "${t}" was deleted by an earlier op`);
  };
  const checkPlace = (p: unknown, w: string, idx: number) => {
    if (typeof p === 'string') { if (!has(SPOTS, p)) errors.push(`${w} bad named spot "${p}"`); return; }
    if (!isObj(p)) return errors.push(`${w} must be a named spot or {relation,ref}`);
    for (const k of Object.keys(p)) if (k !== 'relation' && k !== 'ref') errors.push(`${w} unknown field "${k}"`);
    if (!has(RELATIONS, p.relation)) errors.push(`${w} bad relation "${p.relation}"`);
    const ref = p.ref;
    if (typeof ref === 'string') {
      if (!sceneIds.has(ref)) errors.push(`${w} ref "${ref}" not in scene`);
      else if (deleted.has(ref)) errors.push(`${w} ref "${ref}" was deleted by an earlier op`);
    } else if (isObj(ref) && Object.keys(ref).length === 1 && 'added_in_op' in ref) {
      const n = ref.added_in_op;
      if (!Number.isInteger(n) || n < 0 || n >= idx) errors.push(`${w} added_in_op ${n} must point to an earlier op`);
      else if (ops[n]?.op !== 'add') errors.push(`${w} added_in_op ${n} does not point to an add op`);
    } else errors.push(`${w} ref must be a scene id or {"added_in_op":N}`);
  };

  ops.forEach((op: any, k) => {
    const w = `ops[${k}]`;
    if (!isObj(op) || !(op.op in OP_KEYS)) return errors.push(`${w} unknown op ${JSON.stringify(op?.op)}`);
    const spec = OP_KEYS[op.op];
    for (const r of spec.req) if (!(r in op)) errors.push(`${w} (${op.op}) missing "${r}"`);
    for (const key of Object.keys(op)) if (![...spec.req, ...spec.opt].includes(key)) errors.push(`${w} (${op.op}) unknown field "${key}"`);
    switch (op.op) {
      case 'add':
        if (!has(TYPES, op.type)) errors.push(`${w} bad type "${op.type}"`);
        if ('color' in op && !has(COLORS, op.color)) errors.push(`${w} bad color "${op.color}"`);
        if ('scale' in op && (!isNum(op.scale) || op.scale < 0.3 || op.scale > 2.0)) errors.push(`${w} scale out of [0.3,2.0]`);
        if ('at' in op) checkPlace(op.at, `${w}.at`, k);
        break;
      case 'recolor':
        checkTarget(op.target, w);
        if (!has(COLORS, op.color)) errors.push(`${w} bad color "${op.color}"`);
        break;
      case 'move':
        checkTarget(op.target, w);
        checkPlace(op.to, `${w}.to`, k);
        if (isObj(op.to) && op.to.ref === op.target) errors.push(`${w} cannot move an object relative to itself`);
        break;
      case 'scale':
        checkTarget(op.target, w);
        if (!isNum(op.factor) || op.factor <= 0) errors.push(`${w} factor must be a positive number`);
        break;
      case 'delete':
        checkTarget(op.target, w);
        if (typeof op.target === 'string') deleted.add(op.target);
        break;
      case 'undo':
        if (input.history_len < 1) errors.push(`${w} undo requires history_len > 0`);
        if (ops.length !== 1) errors.push(`${w} undo must be the only op in the batch`);
        break;
      case 'clear':
        if (ops.length !== 1) errors.push(`${w} clear must be the only op in the batch`);
        break;
    }
  });
  return errors;
}

/** Returns a list of errors for one benchmark case (top-level fields, input, scene, expected_ops); empty means valid. */
export function caseErrors(rec: unknown): string[] {
  if (!isObj(rec)) return ['case is not a JSON object'];
  const errors: string[] = [];
  for (const k of Object.keys(rec)) if (!['id', 'category', 'policy', 'input', 'expected_ops', 'notes'].includes(k)) errors.push(`unknown top-level field "${k}"`);
  if (typeof rec.id !== 'string' || !/^[a-z_]+_\d{3}$/.test(rec.id)) errors.push(`bad id "${rec.id}" (expected e.g. add_001)`);
  else if (rec.id.replace(/_\d{3}$/, '') !== rec.category) errors.push(`id prefix does not match category "${rec.category}"`);
  if (!has(CATEGORIES, rec.category)) errors.push(`bad category "${rec.category}"`);
  if (!has(POLICIES, rec.policy)) errors.push(`bad policy "${rec.policy}"`);
  if (INFERRED_ONLY.includes(rec.category) && rec.policy !== 'inferred') errors.push(`${rec.category} must use policy "inferred"`);
  if (rec.notes !== undefined && typeof rec.notes !== 'string') errors.push('notes must be a string');

  const inp = rec.input;
  if (!isObj(inp)) return [...errors, 'input must be an object'];
  for (const k of Object.keys(inp)) if (!['utterance', 'scene', 'focus_id', 'history_len'].includes(k)) errors.push(`unknown input field "${k}"`);
  if (typeof inp.utterance !== 'string' || !inp.utterance.trim()) errors.push('input.utterance must be a non-empty string');
  if (!Number.isInteger(inp.history_len) || inp.history_len < 0) errors.push('input.history_len must be an integer >= 0');
  if (!isObj(inp.scene) || !Array.isArray(inp.scene.objects)) return [...errors, 'input.scene.objects must be an array'];

  const sceneIds = new Set<string>();
  inp.scene.objects.forEach((ob: unknown, j: number) => {
    const p = `scene.objects[${j}]`;
    if (!isObj(ob)) return errors.push(`${p} must be an object`);
    for (const k of ['id', 'type', 'color', 'x', 'y', 'scale']) if (!(k in ob)) errors.push(`${p} missing "${k}"`);
    for (const k of Object.keys(ob)) if (!['id', 'type', 'color', 'x', 'y', 'scale'].includes(k)) errors.push(`${p} unknown field "${k}"`);
    if (!has(TYPES, ob.type)) errors.push(`${p} bad type "${ob.type}"`);
    if (!has(COLORS, ob.color)) errors.push(`${p} bad color "${ob.color}"`);
    if (!isNum(ob.x) || ob.x < 0 || ob.x > 1) errors.push(`${p} x out of [0,1]`);
    if (!isNum(ob.y) || ob.y < 0 || ob.y > 1) errors.push(`${p} y out of [0,1]`);
    if (!isNum(ob.scale) || ob.scale < 0.3 || ob.scale > 2.0) errors.push(`${p} scale out of [0.3,2.0]`);
    if (typeof ob.id !== 'string' || !/^[a-z]+_\d+$/.test(ob.id)) errors.push(`${p} bad id "${ob.id}" (expected type_N)`);
    else {
      if (ob.id.split('_')[0] !== ob.type) errors.push(`${p} id "${ob.id}" does not match type "${ob.type}"`);
      if (sceneIds.has(ob.id)) errors.push(`${p} duplicate scene id "${ob.id}"`);
      sceneIds.add(ob.id);
    }
  });
  if (inp.focus_id !== null) {
    if (typeof inp.focus_id !== 'string') errors.push('input.focus_id must be string or null');
    else if (!sceneIds.has(inp.focus_id)) errors.push(`focus_id "${inp.focus_id}" not in scene`);
  }

  if (!Array.isArray(rec.expected_ops)) return [...errors, 'expected_ops must be an array'];
  return [...errors, ...schemaErrors(rec.expected_ops, inp as unknown as MapperInput).map(e => e.replace(/^ops\[/, 'expected_ops['))];
}
