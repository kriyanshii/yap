#!/usr/bin/env node
// Yap eval v1 validator. No dependencies. Usage: node validate.mjs [path/to/file.jsonl]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'yap-eval-v1.jsonl');
const TYPES = ['cat', 'tree', 'house', 'sun', 'cloud'];
const COLORS = ['red','orange','yellow','green','blue','purple','pink','brown','black','white','gray'];
const CATEGORIES = ['add','relation','focus','edit','undo_clear','self_correction','paraphrase_strict','paraphrase_inferred','unsupported',
  // v2-hard categories (see README-v2.md)
  'messy_speech','asr_errors','multi_step','indirect','references','unsupported_mix','edits_tricky','undo_clear_tricky'];
const POLICIES = ['strict', 'inferred'];
const SPOTS = ['left','right','center','top','bottom','top-left','top-right','bottom-left','bottom-right'];
const RELATIONS = ['on','near','above','below','left_of','right_of'];
const OP_KEYS = {
  add: { req: ['op','type'], opt: ['color','at','scale'] },
  recolor: { req: ['op','target','color'], opt: [] },
  move: { req: ['op','target','to'], opt: [] },
  scale: { req: ['op','target','factor'], opt: [] },
  delete: { req: ['op','target'], opt: [] },
  undo: { req: ['op'], opt: [] },
  clear: { req: ['op'], opt: [] },
};
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

const errors = [];
const seen = new Set();
const counts = { category: {}, policy: {} };
const lines = readFileSync(file, 'utf8').split('\n');
if (lines.at(-1) === '') lines.pop();
let total = 0;

lines.forEach((line, i) => {
  const ln = i + 1;
  const err = msg => errors.push(`line ${ln}${rec?.id ? ` (${rec.id})` : ''}: ${msg}`);
  let rec;
  if (!line.trim()) return err('blank line');
  try { rec = JSON.parse(line); } catch (e) { rec = undefined; return err(`invalid JSON: ${e.message}`); }
  if (!isObj(rec)) return err('line is not a JSON object');
  total++;

  // top-level fields
  const allowedTop = ['id','category','policy','input','expected_ops','notes'];
  for (const k of Object.keys(rec)) if (!allowedTop.includes(k)) err(`unknown top-level field "${k}"`);
  if (typeof rec.id !== 'string' || !/^[a-z_]+_\d{3}$/.test(rec.id)) err(`bad id "${rec.id}" (expected e.g. add_001)`);
  else {
    if (seen.has(rec.id)) err(`duplicate id "${rec.id}"`);
    seen.add(rec.id);
    if (rec.id.replace(/_\d{3}$/, '') !== rec.category) err(`id prefix does not match category "${rec.category}"`);
  }
  if (!CATEGORIES.includes(rec.category)) err(`bad category "${rec.category}"`);
  if (!POLICIES.includes(rec.policy)) err(`bad policy "${rec.policy}"`);
  if (rec.category === 'paraphrase_inferred' && rec.policy !== 'inferred') err('paraphrase_inferred must use policy "inferred"');
  if (rec.category === 'indirect' && rec.policy !== 'inferred') err('indirect must use policy "inferred"');
  if (rec.notes !== undefined && typeof rec.notes !== 'string') err('notes must be a string');
  counts.category[rec.category] = (counts.category[rec.category] ?? 0) + 1;
  counts.policy[rec.policy] = (counts.policy[rec.policy] ?? 0) + 1;

  // input
  const inp = rec.input;
  if (!isObj(inp)) return err('input must be an object');
  for (const k of Object.keys(inp)) if (!['utterance','scene','focus_id','history_len'].includes(k)) err(`unknown input field "${k}"`);
  if (typeof inp.utterance !== 'string' || !inp.utterance.trim()) err('input.utterance must be a non-empty string');
  if (!Number.isInteger(inp.history_len) || inp.history_len < 0) err('input.history_len must be an integer >= 0');
  if (!isObj(inp.scene) || !Array.isArray(inp.scene.objects)) return err('input.scene.objects must be an array');

  const sceneIds = new Map();
  inp.scene.objects.forEach((ob, j) => {
    const p = `scene.objects[${j}]`;
    if (!isObj(ob)) return err(`${p} must be an object`);
    for (const k of ['id','type','color','x','y','scale']) if (!(k in ob)) err(`${p} missing "${k}"`);
    for (const k of Object.keys(ob)) if (!['id','type','color','x','y','scale'].includes(k)) err(`${p} unknown field "${k}"`);
    if (!TYPES.includes(ob.type)) err(`${p} bad type "${ob.type}"`);
    if (!COLORS.includes(ob.color)) err(`${p} bad color "${ob.color}"`);
    if (!isNum(ob.x) || ob.x < 0 || ob.x > 1) err(`${p} x out of [0,1]`);
    if (!isNum(ob.y) || ob.y < 0 || ob.y > 1) err(`${p} y out of [0,1]`);
    if (!isNum(ob.scale) || ob.scale < 0.3 || ob.scale > 2.0) err(`${p} scale out of [0.3,2.0]`);
    if (typeof ob.id !== 'string' || !/^[a-z]+_\d+$/.test(ob.id)) err(`${p} bad id "${ob.id}" (expected type_N)`);
    else {
      if (ob.id.split('_')[0] !== ob.type) err(`${p} id "${ob.id}" does not match type "${ob.type}"`);
      if (sceneIds.has(ob.id)) err(`${p} duplicate scene id "${ob.id}"`);
      sceneIds.set(ob.id, ob);
    }
  });
  if (inp.focus_id !== null) {
    if (typeof inp.focus_id !== 'string') err('input.focus_id must be string or null');
    else if (!sceneIds.has(inp.focus_id)) err(`focus_id "${inp.focus_id}" not in scene`);
  }

  // expected_ops
  const ops = rec.expected_ops;
  if (!Array.isArray(ops)) return err('expected_ops must be an array');
  const deleted = new Set();
  const checkTarget = (t, where) => {
    if (typeof t !== 'string') return err(`${where} target must be an existing scene id string`);
    if (!sceneIds.has(t)) err(`${where} target "${t}" not in scene`);
    else if (deleted.has(t)) err(`${where} target "${t}" was deleted by an earlier op`);
  };
  const checkPlace = (p, where, idx) => {
    if (typeof p === 'string') { if (!SPOTS.includes(p)) err(`${where} bad named spot "${p}"`); return; }
    if (!isObj(p)) return err(`${where} must be a named spot or {relation,ref}`);
    for (const k of Object.keys(p)) if (!['relation','ref'].includes(k)) err(`${where} unknown field "${k}"`);
    if (!RELATIONS.includes(p.relation)) err(`${where} bad relation "${p.relation}"`);
    const ref = p.ref;
    if (typeof ref === 'string') {
      if (!sceneIds.has(ref)) err(`${where} ref "${ref}" not in scene`);
      else if (deleted.has(ref)) err(`${where} ref "${ref}" was deleted by an earlier op`);
    } else if (isObj(ref) && Object.keys(ref).length === 1 && 'added_in_op' in ref) {
      const N = ref.added_in_op;
      if (!Number.isInteger(N) || N < 0 || N >= idx) err(`${where} added_in_op ${N} must point to an earlier op`);
      else if (ops[N]?.op !== 'add') err(`${where} added_in_op ${N} does not point to an add op`);
    } else err(`${where} ref must be a scene id or {"added_in_op":N}`);
  };

  ops.forEach((op, k) => {
    const w = `expected_ops[${k}]`;
    if (!isObj(op) || !(op.op in OP_KEYS)) return err(`${w} unknown op ${JSON.stringify(op?.op)}`);
    const spec = OP_KEYS[op.op];
    for (const r of spec.req) if (!(r in op)) err(`${w} (${op.op}) missing "${r}"`);
    for (const key of Object.keys(op)) if (![...spec.req, ...spec.opt].includes(key)) err(`${w} (${op.op}) unknown field "${key}"`);
    switch (op.op) {
      case 'add':
        if (!TYPES.includes(op.type)) err(`${w} bad type "${op.type}"`);
        if ('color' in op && !COLORS.includes(op.color)) err(`${w} bad color "${op.color}"`);
        if ('scale' in op && (!isNum(op.scale) || op.scale < 0.3 || op.scale > 2.0)) err(`${w} scale out of [0.3,2.0]`);
        if ('at' in op) checkPlace(op.at, `${w}.at`, k);
        break;
      case 'recolor':
        checkTarget(op.target, w);
        if (!COLORS.includes(op.color)) err(`${w} bad color "${op.color}"`);
        break;
      case 'move':
        checkTarget(op.target, w);
        checkPlace(op.to, `${w}.to`, k);
        if (isObj(op.to) && op.to.ref === op.target) err(`${w} cannot move an object relative to itself`);
        break;
      case 'scale':
        checkTarget(op.target, w);
        if (!isNum(op.factor) || op.factor <= 0) err(`${w} factor must be a positive number`);
        break;
      case 'delete':
        checkTarget(op.target, w);
        if (typeof op.target === 'string') deleted.add(op.target);
        break;
      case 'undo':
        if (inp.history_len < 1) err(`${w} undo requires history_len > 0`);
        if (ops.length !== 1) err(`${w} undo must be the only op in the batch`);
        break;
      case 'clear':
        if (ops.length !== 1) err(`${w} clear must be the only op in the batch`);
        break;
    }
  });
});

if (errors.length) {
  console.error(`FAIL: ${errors.length} error(s) in ${file}`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`OK: ${total} cases, ${seen.size} unique ids`);
console.log('by category:', JSON.stringify(counts.category));
console.log('by policy:  ', JSON.stringify(counts.policy));
