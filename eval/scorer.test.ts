import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { keywordOps } from './mappers/keyword.ts';
import { caseErrors } from './schema.ts';
import { canonical, execute, inventedObjects, scoreCase } from './scorer.ts';
import type { EvalCase, SceneOperation } from './types.ts';

const tree = { id: 'tree_1', type: 'tree' as const, color: 'green' as const, x: 0.3, y: 0.65, scale: 1 };
const mk = (utterance: string, expected_ops: SceneOperation[], objects = [tree], focus_id: string | null = null, history_len = 0): EvalCase =>
  ({ id: 'x_001', category: 'x', policy: 'strict', input: { utterance, scene: { objects }, focus_id, history_len }, expected_ops });
const score = (c: EvalCase, ops: SceneOperation[] | null, raw = JSON.stringify(ops)) => scoreCase(c, { raw, ops }, 0);

test('exact prediction scores everything true', () => {
  const c = mk('make the tree blue', [{ op: 'recolor', target: 'tree_1', color: 'blue' }]);
  const { scores, failure } = score(c, [{ op: 'recolor', color: 'blue', target: 'tree_1' } as SceneOperation]);
  assert.equal(failure, 'ok');
  assert.deepEqual(
    [scores.valid_json, scores.schema_valid, scores.executable, scores.exact_match, scores.state_match, scores.noop_correct],
    [true, true, true, true, true, null]);
});

test('valid ops that reach the same state still fail exact_match', () => {
  // "twice as big" scaled in two steps: schema-valid, executable, same final scene, different ops.
  const c = mk('make the tree twice as big', [{ op: 'scale', target: 'tree_1', factor: 2 }]);
  const { scores, failure } = score(c, [{ op: 'scale', target: 'tree_1', factor: 1.5 }, { op: 'scale', target: 'tree_1', factor: 4 / 3 }]);
  assert.equal(scores.schema_valid, true);
  assert.equal(scores.executable, true);
  assert.equal(scores.exact_match, false);
  assert.equal(scores.state_match, true);
  assert.equal(failure, 'inexact_ops');
});

test('valid ops with a different result fail both matches', () => {
  const c = mk('make the tree smaller', [{ op: 'scale', target: 'tree_1', factor: 0.75 }]);
  const { scores, failure } = score(c, [{ op: 'scale', target: 'tree_1', factor: 0.5 }]);
  assert.equal(scores.schema_valid && scores.executable, true);
  assert.equal(scores.exact_match || scores.state_match, false);
  assert.equal(failure, 'wrong_state');
});

test('positions within 0.05 count as the same state', () => {
  const c = mk('a cat', [{ op: 'add', type: 'cat' }], []);
  // center (0.5, 0.5) vs right_of a tree at (0.3, 0.5) -> (0.5, 0.5): different ops, same place.
  const near = mk('a cat', [{ op: 'add', type: 'cat' }], [{ ...tree, y: 0.52 }]);
  assert.equal(score(c, [{ op: 'add', type: 'cat', at: 'center' }]).scores.state_match, true);
  assert.equal(score(near, [{ op: 'add', type: 'cat', at: { relation: 'right_of', ref: 'tree_1' } }]).scores.state_match, true);
  assert.equal(score(c, [{ op: 'add', type: 'cat', at: 'left' }]).scores.state_match, false);
});

test('unparseable output and API errors', () => {
  const c = mk('draw a cat', [{ op: 'add', type: 'cat' }], []);
  const bad = score(c, null, '```json [');
  assert.equal(bad.scores.valid_json, false);
  assert.equal(bad.scores.executable, false);
  assert.equal(bad.failure, 'invalid_json');
  assert.equal(score(c, null, 'error: timeout').failure, 'api_error');
});

test('schema checks match validate.mjs, separately from executability', () => {
  const c = mk('make the tree bigger', [{ op: 'scale', target: 'tree_1', factor: 1.3 }]);
  // {type} refs are legal for the engine but not in the benchmark schema.
  const typeRef = score(c, [{ op: 'scale', target: { type: 'tree' }, factor: 1.3 }]);
  assert.equal(typeRef.scores.schema_valid, false);
  assert.equal(typeRef.scores.executable, true);
  assert.equal(typeRef.scores.state_match, true);
  const extraKey = score(c, [{ op: 'scale', target: 'tree_1', factor: 1.3, note: 'hi' } as SceneOperation]);
  assert.equal(extraKey.scores.schema_valid, false);
  assert.equal(extraKey.failure, 'schema_invalid');
  const missing = score(c, [{ op: 'scale', target: 'house_1', factor: 1.3 }]);
  assert.equal(missing.scores.schema_valid || missing.scores.executable, false);
});

test('noop cases', () => {
  const c = mk('make it bigger', []);
  assert.equal(score(c, []).scores.noop_correct, true);
  const acted = score(c, [{ op: 'scale', target: 'tree_1', factor: 1.3 }]);
  assert.equal(acted.scores.noop_correct, false);
  assert.equal(acted.failure, 'missed_noop');
  assert.equal(score(mk('draw a cat', [{ op: 'add', type: 'cat' }], []), []).failure, 'false_noop');
});

test('invented objects count extra adds per type', () => {
  const expected: SceneOperation[] = [{ op: 'add', type: 'tree' }];
  assert.equal(inventedObjects([{ op: 'add', type: 'tree' }], expected), 0);
  assert.equal(inventedObjects([{ op: 'add', type: 'tree' }, { op: 'add', type: 'sun' }, { op: 'add', type: 'tree' }], expected), 2);
  assert.equal(inventedObjects([{ op: 'add', type: 'car' }], []), 1);
});

test('undo executes using history_len', () => {
  const c = mk('undo', [{ op: 'undo' }], [tree], null, 1);
  assert.equal(score(c, [{ op: 'undo' }]).failure, 'ok');
  assert.equal(execute({ ...c.input, history_len: 0 }, [{ op: 'undo' }]), null);
});

test('canonical ignores key order but not op order', () => {
  assert.equal(canonical([{ a: 1, b: { c: 2, d: 3 } }]), canonical([{ b: { d: 3, c: 2 }, a: 1 }]));
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
});

const load = (file: string): EvalCase[] => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

for (const [file, n] of [['yap-eval-v1.jsonl', 50], ['yap-eval-v2-hard.jsonl', 79]] as const) {
  test(`every ${file} case: valid per schema.ts, and expected ops execute and score ok against themselves`, () => {
    const cases = load(file);
    assert.equal(cases.length, n);
    assert.equal(new Set(cases.map(c => c.id)).size, n);
    for (const c of cases) {
      assert.deepEqual(caseErrors(c), [], c.id);
      assert.equal(score(c, structuredClone(c.expected_ops)).failure, 'ok', c.id);
    }
  });
}

test('caseErrors enforces categories and the inferred-only rule, like validate.mjs', () => {
  const c = { id: 'indirect_136', category: 'indirect', policy: 'inferred', input: { utterance: 'x', scene: { objects: [] }, focus_id: null, history_len: 0 }, expected_ops: [] };
  assert.deepEqual(caseErrors(c), []);
  assert.deepEqual(caseErrors({ ...c, policy: 'strict' }), ['indirect must use policy "inferred"']);
  assert.deepEqual(caseErrors({ ...c, id: 'paraphrase_inferred_047', category: 'paraphrase_inferred', policy: 'strict' }), ['paraphrase_inferred must use policy "inferred"']);
  assert.deepEqual(caseErrors({ ...c, id: 'bogus_001', category: 'bogus' }), ['bad category "bogus"']);
  assert.deepEqual(caseErrors({ ...c, expected_ops: [{ op: 'delete', target: 'tree_9' }] }), ['expected_ops[0] target "tree_9" not in scene']);
});

test('default house colour is brown (README.md, README-v2.md and scene-spec-v1.md agree)', () => {
  assert.equal(execute({ utterance: '', scene: { objects: [] }, focus_id: null, history_len: 0 }, [{ op: 'add', type: 'house' }])?.[0].color, 'brown');
});

test('keyword mapper is deterministic and rejects unsupported input', () => {
  const input = { utterance: 'draw a spaceship', scene: { objects: [] }, focus_id: null, history_len: 0 };
  assert.deepEqual(keywordOps(input), []);
  assert.deepEqual(keywordOps({ ...input, utterance: 'a big red tree on the left' }), [{ op: 'add', type: 'tree', color: 'red', at: 'left', scale: 1.5 }]);
});

test('qwen guard rejects ops with unknown types, targets or relations, and keeps valid ones', async () => {
  const { guardOps } = await import('./mappers/qwen.ts');
  const input = { utterance: '', scene: { objects: [tree] }, focus_id: null, history_len: 0 };
  const valid: SceneOperation[] = [{ op: 'add', type: 'cat', at: { relation: 'near', ref: 'tree_1' } }];
  assert.deepEqual(guardOps(valid, input), valid);
  assert.deepEqual(guardOps([{ op: 'move', target: 'dog', to: 'left' } as unknown as SceneOperation], input), [], 'unknown target (v2 131)');
  assert.deepEqual(guardOps([{ op: 'add', type: 'bird', at: { relation: 'in', ref: 'tree_1' } } as unknown as SceneOperation], input), [], 'unknown type and relation (v2 163)');
  assert.deepEqual(guardOps([{ op: 'move', target: 'tree_1', to: { relation: 'below', ref: 'cloud' } } as unknown as SceneOperation], input), [], 'ref is not a scene id (v1 040)');
});
