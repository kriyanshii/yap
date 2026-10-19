import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TYPES } from '../../src/scene/engine.ts';
import { caseErrors } from '../../eval/schema.ts';
import { execute } from '../../eval/scorer.ts';
import { generate, quotas, toChat } from './generator.ts';
import { CATEGORY_WEIGHTS, ENGINE_CHECKED, sampleIntent, type Category } from './intents.ts';
import { applyNoise } from './noise.ts';
import { ruleParaphraser, slotsPreserved } from './paraphrase.ts';
import { SFT_SYSTEM_PROMPT } from './prompt.ts';
import { Rng } from './rng.ts';
import { ofType, sampleScene } from './scene.ts';

const asCase = (input: ReturnType<typeof sampleScene>) => ({ id: 'add_001', category: 'add', policy: 'strict', input: { ...input, utterance: 'x' }, expected_ops: [] });
const small = generate({ n: 300, seed: 7 });

test('rng is deterministic per seed', () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const seq = (r: Rng) => Array.from({ length: 5 }, () => r.next());
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(new Rng(42)), seq(c));
});

test('scene sampler: valid scenes with 0-5 objects, unique type_N ids, real focus, constraints respected', () => {
  const rng = new Rng(1);
  for (let i = 0; i < 1000; i++) {
    const s = sampleScene(rng);
    assert.deepEqual(caseErrors(asCase(s)), [], JSON.stringify(s));
    assert.ok(s.scene.objects.length <= 5);
    assert.ok(s.focus_id === null || s.scene.objects.some(o => o.id === s.focus_id));
  }
  for (let i = 0; i < 300; i++) {
    const s = sampleScene(rng, { require: { tree: 2 }, forbid: ['cat'], focus: 'tree', minHistory: 2 });
    assert.deepEqual(caseErrors(asCase(s)), []);
    assert.equal(ofType(s, 'tree').length, 2);
    assert.equal(ofType(s, 'cat').length, 0);
    assert.equal(s.scene.objects.find(o => o.id === s.focus_id)?.type, 'tree');
    assert.ok(s.history_len >= 2);
    assert.equal(sampleScene(rng, { focus: 'none' }).focus_id, null);
  }
});

test('ids are not always _1 (scenes put ids out of order like the benchmarks)', () => {
  const rng = new Rng(3);
  const ids = Array.from({ length: 200 }, () => sampleScene(rng, { min: 1 }).scene.objects.map(o => o.id)).flat();
  assert.ok(ids.some(id => !id.endsWith('_1')));
});

test('intent sampler: every category gives ops that run on the engine; [] cases carry a reason the engine confirms', () => {
  const rng = new Rng(11);
  for (const category of Object.keys(CATEGORY_WEIGHTS) as Category[]) {
    let made = 0;
    for (let i = 0; i < 400; i++) {
      const it = sampleIntent(rng, category);
      if (!it) continue;
      made++;
      assert.ok(execute(it.input, it.ops), `${it.subtype}: ${it.input.utterance}`);
      if (it.ops.length === 0) {
        assert.ok(it.reason, `${it.subtype} [] without a reason`);
        if (ENGINE_CHECKED.includes(it.reason!)) assert.equal(execute(it.input, it.rejected), null, `${it.subtype}: ${it.input.utterance}`);
      } else assert.equal(it.reason, undefined);
      if (category === 'indirect') assert.equal(it.policy, 'inferred');
    }
    assert.ok(made > 300, `${category}: only ${made}/400 satisfiable`);
  }
});

test('generate: exact category quotas, valid chat format, no duplicates, rates near target', () => {
  const q = quotas(300);
  for (const [c, n] of Object.entries(q)) assert.equal(small.train.filter(e => e.meta.category === c).length, n, c);
  assert.equal(small.val.length, 30);
  const all = [...small.train, ...small.val];
  const keys = new Set(all.map(e => `${e.input.utterance}|${JSON.stringify(e.input.scene)}|${e.input.focus_id}|${e.input.history_len}`));
  assert.equal(keys.size, all.length);
  const noisy = all.filter(e => e.meta.noise.length).length / all.length;
  assert.ok(noisy > 0.22 && noisy < 0.4, `noise rate ${noisy}`);
  assert.ok(all.every(e => e.meta.category !== 'messy' || e.meta.noise.length > 0), 'messy examples are always noisy');
  assert.ok(all.every(e => !e.meta.paraphrased || e.meta.paraphrase_model === 'rules-v1'));
  const chat = toChat(small.train[0]);
  assert.deepEqual(chat.messages.map(m => m.role), ['system', 'user', 'assistant']);
  assert.equal(chat.messages[0].content, SFT_SYSTEM_PROMPT);
  assert.deepEqual(Object.keys(JSON.parse(chat.messages[1].content)), ['utterance', 'scene', 'focus_id', 'history_len']);
  assert.ok(Array.isArray(JSON.parse(chat.messages[2].content)));
});

test('generate is reproducible for a seed and differs across seeds', () => {
  const again = generate({ n: 300, seed: 7 });
  assert.equal(JSON.stringify(again), JSON.stringify(small));
  assert.notEqual(JSON.stringify(generate({ n: 300, seed: 8 }).train), JSON.stringify(small.train));
});

test('paraphrases keep every slot word; slotsPreserved catches changes', () => {
  assert.ok(slotsPreserved('draw a big red cat on the left', 'on the left could you sketch a large red cat'));
  assert.ok(!slotsPreserved('draw a red cat', 'draw a blue cat'));
  assert.ok(!slotsPreserved('draw two trees', 'draw three trees'));
  assert.ok(!slotsPreserved('move it to the left', 'move the cat to the left'));
  const rng = new Rng(5);
  for (let i = 0; i < 500; i++) {
    const it = sampleIntent(rng, rng.pick(['simple', 'references', 'multi_place'] as const));
    if (!it) continue;
    const p = ruleParaphraser.paraphrase(it.input.utterance, rng);
    if (p) assert.ok(slotsPreserved(it.input.utterance, p.text), `${it.input.utterance} -> ${p.text}`);
  }
});

test('noise: restarts repeat only verbs/articles, never an object; self-corrections end on the labeled item', () => {
  const rng = new Rng(9);
  const ops = [{ op: 'add', type: 'cat' }, { op: 'add', type: 'cloud', at: 'center' }] as const;
  for (let i = 0; i < 500; i++) {
    const r = applyNoise('a cat and a cloud in the center', [...ops], rng, { mishear: false });
    if (r.noise.includes('restart')) assert.fail(`restart on a noun-first utterance: ${r.text}`);
    const s = applyNoise('put a sun at the top', [{ op: 'add', type: 'sun', at: 'top' }], rng, { mishear: false });
    if (s.noise.includes('self_correction')) {
      const decoyAt = Math.max(...TYPES.filter(t => t !== 'sun').map(t => s.text.lastIndexOf(t)));
      assert.ok(decoyAt >= 0 && s.text.lastIndexOf(' sun') > decoyAt, `the corrected item must come last: ${s.text}`);
    }
    assert.equal(s.text, s.text.toLowerCase());
  }
  const m = applyNoise('draw a sun on the right', [{ op: 'add', type: 'sun', at: 'right' }], rng, { mishear: true });
  assert.ok(m.mishear);
  assert.match(m.text, /\bson\b|\bwrite\b|^drawer\b/);
});
