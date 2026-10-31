import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keywordOps } from './mappers/keyword.ts';
import type { MapperInput } from './types.ts';

const input = (utterance: string, objects: MapperInput['scene']['objects'] = []): MapperInput =>
  ({ utterance, scene: { objects }, focus_id: null, history_len: 0 });

test('aliases and their plurals map onto the stamp, and an unknown word still refuses', () => {
  assert.deepEqual(keywordOps(input('draw a lake')), [{ op: 'add', type: 'river' }]);
  assert.deepEqual(keywordOps(input('draw two puppies')), [{ op: 'add', type: 'dog' }, { op: 'add', type: 'dog' }]);
  assert.deepEqual(keywordOps(input('draw three lakes on the left')), [
    { op: 'add', type: 'river', at: 'left' }, { op: 'add', type: 'river', at: 'left' }, { op: 'add', type: 'river', at: 'left' },
  ]);
  assert.deepEqual(keywordOps(input('draw an umbrella')), [{ op: 'add', type: 'tree' }]);
  assert.deepEqual(keywordOps(input('draw a van')), [{ op: 'add', type: 'car' }]);
  assert.deepEqual(keywordOps(input('draw two people')), [{ op: 'add', type: 'person' }, { op: 'add', type: 'person' }]);
  assert.deepEqual(keywordOps(input('draw a telescope')), []);
  assert.deepEqual(keywordOps(input('draw the animal that purrs')), []);
  assert.deepEqual(keywordOps(input('draw an animal')), []);
  assert.deepEqual(keywordOps(input('draw a furry')), []);
});

test('an alias can be the reference of a relation when that stamp is already in the scene', () => {
  const river = { id: 'river_1', type: 'river' as const, color: 'blue' as const, x: 0.5, y: 0.7, scale: 1 };
  assert.deepEqual(keywordOps(input('draw a castle next to the river', [river])), [
    { op: 'add', type: 'house', at: { relation: 'near', ref: 'river_1' } },
  ]);
  assert.deepEqual(keywordOps(input('draw a castle next to the river')), []);
});
