// Held-out scenic wording. These sentences are not templates in the training generator's fixed benches (v1 / v2);
// leakage treats this file's jsonl twin as a bench so near-copies stay out of train.jsonl.
// A description that fits one stamp is that stamp. The same sentence with the description or the referent missing is [].
import type { ObjectType, Op, SceneObject } from '../src/scene/engine.ts';
import type { EvalCase } from './types.ts';

const house: SceneObject = { id: 'house_1', type: 'house', color: 'brown', x: 0.5, y: 0.62, scale: 1 };
const tree: SceneObject = { id: 'tree_1', type: 'tree', color: 'green', x: 0.42, y: 0.7, scale: 1 };
const mountain: SceneObject = { id: 'mountain_1', type: 'mountain', color: 'gray', x: 0.5, y: 0.55, scale: 1 };
const boat: SceneObject = { id: 'boat_1', type: 'boat', color: 'brown', x: 0.62, y: 0.68, scale: 1 };
const river: SceneObject = { id: 'river_1', type: 'river', color: 'blue', x: 0.5, y: 0.72, scale: 1 };

const withScene = (objects: SceneObject[], utterance: string) => ({
  utterance, scene: { objects }, focus_id: null, history_len: objects.length ? 1 : 0,
});

let n = 0;
const id = () => `indirect_${String(++n).padStart(3, '0')}`;
const pos = (utterance: string, objects: SceneObject[], ops: Op[], notes?: string): EvalCase =>
  ({ id: id(), category: 'indirect', policy: 'inferred', input: { ...withScene(objects, utterance) }, expected_ops: ops, ...(notes && { notes }) });
const nope = (utterance: string, objects: SceneObject[] = [], notes?: string): EvalCase =>
  pos(utterance, objects, [], notes);
const add = (type: ObjectType, extra: Omit<Extract<Op, { op: 'add' }>, 'op' | 'type'> = {}): Op => ({ op: 'add', type, ...extra });

export const SCENIC_CASES: EvalCase[] = [
  pos('draw an animal that purrs', [], [add('cat')]),
  pos('put two big red animals that purr on the house', [house], [add('cat', { color: 'red', scale: 1.5, at: { relation: 'on', ref: 'house_1' } }), add('cat', { color: 'red', scale: 1.5, at: { relation: 'on', ref: 'house_1' } })]),
  pos('draw a tall plant with branches', [], [add('tree')]),
  pos('add a small plant with bark and branches to the left of the house', [house], [add('tree', { scale: 0.6, at: { relation: 'left_of', ref: 'house_1' } })]),
  pos('draw a place where people live', [], [add('house')]),
  pos('draw a blue home with a roof and a door', [], [add('house', { color: 'blue' })]),
  pos('draw a hot glowing ball in the daytime sky', [], [add('sun', { at: 'top' })], 'in the sky is top'),
  pos('draw a large star that lights up the day', [], [add('sun', { scale: 1.5 })]),
  pos('draw a fluffy patch of mist in the sky', [], [add('cloud', { at: 'top' })]),
  pos('draw three soft fluffy things drifting across the sky', [], [add('cloud', { at: 'top' }), add('cloud', { at: 'top' }), add('cloud', { at: 'top' })]),
  pos('draw a pale round light in the night sky', [], [add('moon')]),
  pos('put a small pale round light in the night sky above the mountain', [mountain], [add('moon', { scale: 0.6, at: { relation: 'above', ref: 'mountain_1' } })]),
  pos('draw a tall rocky peak', [], [add('mountain')]),
  pos('draw a flowing stream of water', [], [add('river')]),
  pos('put a long path of flowing water below the mountain', [mountain], [add('river', { at: { relation: 'below', ref: 'mountain_1' } })]),
  pos('draw a human standing upright', [], [add('person')]),
  pos('put a standing figure with a face and two arms next to the house', [house], [add('person', { at: { relation: 'near', ref: 'house_1' } })]),
  pos('draw a pet that barks and wags its tail', [], [add('dog')]),
  pos('put a big red pet that barks and wags its tail next to the house', [house], [add('dog', { color: 'red', scale: 1.5, at: { relation: 'near', ref: 'house_1' } })]),
  pos('draw an animal with a beak and wings', [], [add('bird')]),
  pos('put two animals with a beak and wings above the tree', [tree], [add('bird', { at: { relation: 'above', ref: 'tree_1' } }), add('bird', { at: { relation: 'above', ref: 'tree_1' } })]),
  pos('draw an animal with fins that swims', [], [add('fish')]),
  pos('put a small animal with fins that swims next to the boat', [boat], [add('fish', { scale: 0.6, at: { relation: 'near', ref: 'boat_1' } })]),
  pos('draw a vessel that floats and carries people', [], [add('boat')]),
  pos('put a vessel that floats and carries people on the river', [river], [add('boat', { at: { relation: 'on', ref: 'river_1' } })]),
  pos('draw a machine with four wheels that drives on roads', [], [add('car')]),
  pos('draw a big red vehicle with four wheels and windows', [], [add('car', { color: 'red', scale: 1.5 })]),
  pos('draw a tall tower with blades that spin in the wind', [], [add('windmill')]),
  pos('put a tall tower with blades that spin in the wind to the right of the house', [house], [add('windmill', { at: { relation: 'right_of', ref: 'house_1' } })]),
  pos('draw a furry animal that hibernates', [], [add('bear')]),
  pos('draw a large furry animal that eats honey', [], [add('bear', { scale: 1.5 })]),

  // Same frames as a positive case, with the identifying words or the referent missing.
  nope('put a big red thing next to the house', [house], 'twin of the red pet that barks'),
  nope('draw an animal', [], 'an animal fits cat, dog, bear and bird'),
  nope('put an animal that purrs on it', [], 'no focus, so the referent is missing'),
  pos('put an animal that purrs on the house', [house], [add('cat', { at: { relation: 'on', ref: 'house_1' } })], 'the missing referent filled in'),
  nope('draw a shape'),
  nope('add two things on the left'),
  nope('put a small object above the tree', [tree], 'twin of the small animal with a beak'),
  pos('put a small animal with a beak and wings above the tree', [tree], [add('bird', { scale: 0.6, at: { relation: 'above', ref: 'tree_1' } })], 'the missing description filled in'),
  nope('draw something nice'),
  nope('put a pet that barks and wags its tail beside it', [house], 'the house is there, but "it" has no focus'),
  pos('put a pet that barks and wags its tail beside the house', [house], [add('dog', { at: { relation: 'near', ref: 'house_1' } })], 'the missing referent filled in'),
];
