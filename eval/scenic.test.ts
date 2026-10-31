import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SceneEngine, TYPES } from '../src/scene/engine.ts';
import { hitsBanned } from '../party/match.ts';
import { caseErrors } from './schema.ts';
import { SCENIC_CASES } from './scenicCases.ts';
import { SCENIC_CANVAS } from './scenicCanvas.ts';
import { check } from './pictureCheck.ts';

test('scenic bench is schema-valid, covers every stamp, and never names the stamp it adds', () => {
  const added = new Set<string>();
  let colored = 0, sized = 0, counted = 0, related = 0, refused = 0;
  for (const c of SCENIC_CASES) {
    assert.deepEqual(caseErrors(c), [], c.id);
    const adds = c.expected_ops.filter(op => op.op === 'add');
    if (!adds.length) { refused++; continue; }
    counted += adds.length > 1 ? 1 : 0;
    for (const op of adds) {
      if (op.op !== 'add') continue;
      added.add(op.type);
      if (op.color) colored++;
      if (op.scale !== undefined) sized++;
      if (op.at && typeof op.at === 'object') related++;
      assert.doesNotMatch(c.input.utterance, new RegExp(`\\b${op.type}s?\\b`), c.id);
    }
  }
  assert.deepEqual([...added].sort(), [...TYPES].sort());
  assert.ok(colored > 0 && sized > 0 && counted > 0 && related > 0 && refused > 0);
});

test('scenic canvas hints never say a stamp, and the gold ops draw the picture', () => {
  for (const scene of SCENIC_CANVAS) {
    for (const phrase of scene.phrases) {
      assert.equal(hitsBanned(phrase, [...TYPES]), false, `${scene.id}: "${phrase}"`);
    }
    const engine = new SceneEngine();
    assert.equal(engine.execute(scene.ops), true, scene.id);
    assert.deepEqual(check(engine.state.objects, scene.expect), [], scene.id);
  }
});
