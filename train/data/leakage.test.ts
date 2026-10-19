import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate } from './generator.ts';
import { checkLeakage, editDistance, loadBenchmarkUtterances, nearestLeak, normalize, signature } from './leakage.ts';

const bench = loadBenchmarkUtterances();

test('edit distance', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('same', 'same'), 0);
  assert.equal(editDistance('abcdefghij', 'a', 5), 6, 'returns max+1 once over the bound');
  assert.equal(editDistance('draw a dog', 'draw a cat', 5), 3);
});

test('normalize ignores case, punctuation and spacing', () => {
  assert.equal(normalize('  A sun, no,  a CLOUD! '), 'a sun no a cloud');
});

test('loads all 129 benchmark utterances (v1 50 + v2 79)', () => {
  assert.equal(bench.length, 129);
});

test('signature: objects and relations, with mishears and spots canonicalized', () => {
  assert.equal(signature('put a cat on the house'), 'cat,house|on');
  assert.equal(signature('a cat on the roof'), 'cat,house|on');
  assert.equal(signature('put a cat on the rough'), 'cat,house|on');
  assert.equal(signature('draw a son up in the sky'), 'sun|');
  assert.equal(signature('a cat on the left'), 'cat|', '"on the left" is a spot, not a relation');
  assert.equal(signature('make it blue'), '|');
});

test('leaks only when the wording is close AND the objects and relation are the same', () => {
  // near-copies of benchmark frames stay out
  assert.equal(nearestLeak('Draw a cat.', bench)?.distance, 0);
  assert.ok(nearestLeak('put the cat on the house', bench), 'v1 edit_039 frame');
  assert.ok(nearestLeak('put a cat onto the house', bench), 'paraphrase of v1 relation_022');
  assert.ok(nearestLeak('make it green', bench), 'same frame as "make it blue", no objects');
  assert.ok(nearestLeak('draw a sun up in the sky', bench), 'the repair of v2 asr_errors_116 is still a near-copy');
  assert.ok(nearestLeak('put a cat on the roof', bench), 'v2 asr_errors_120 with the mishear repaired');
  // different objects or relation: allowed back in
  assert.equal(nearestLeak('draw a sun', bench), null, 'differs from "draw a cat" in the object');
  assert.equal(nearestLeak('put a tree next to the cat', bench), null);
  assert.equal(nearestLeak('a cloud on the house', bench), null);
  assert.equal(nearestLeak('could you paint the leftmost cloud a nice shade of purple', bench), null);
  const report = checkLeakage(['put the cat on the house', 'draw a sun', 'could you paint the leftmost cloud a nice shade of purple'], bench);
  assert.equal(report.leaks.length, 1);
  assert.equal(report.leaks[0].utterance, 'put the cat on the house');
  assert.equal(report.nearButDifferent, 1, '"draw a sun" is close in wording but allowed');
  assert.equal(report.minDistance, 0);
});

test('every benchmark utterance is caught against itself', () => {
  assert.equal(checkLeakage(bench.map(b => b.utterance), bench).leaks.length, 129);
});

test('generated data has no leaks', () => {
  const res = generate({ n: 300, seed: 3, bench });
  const report = checkLeakage([...res.train, ...res.val].map(e => e.input.utterance), bench);
  assert.equal(report.leaks.length, 0, JSON.stringify(report.leaks.slice(0, 3)));
  assert.ok(report.minDistance > 5, 'closest same-objects pair is more than 5 edits away');
});
