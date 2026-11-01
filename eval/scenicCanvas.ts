// Circumlocution pictures checked without calling the model. The boat-on-a-river scene stays out of the live
// clue pack, because "on the river" was refused on the scenic bench. The other pictures are live rounds.
import type { Op } from '../src/scene/engine.ts';
import type { Expect } from './pictureCheck.ts';

export interface ScenicCanvas {
  id: string;
  text: string;
  banned: string[];
  phrases: string[];
  expect: Expect;
  /** What those phrases should do, so the picture can be checked without calling the model. */
  ops: Op[];
}

export const SCENIC_CANVAS: ScenicCanvas[] = [
  {
    id: 'barking-pet',
    text: 'a dog next to a house',
    banned: ['dog', 'house'],
    phrases: ['the place where people live', 'put the pet that barks and wags its tail next to it'],
    expect: { objects: [{ type: 'house' }, { type: 'dog' }], relations: [['dog', 'next_to', 'house']] },
    ops: [
      { op: 'add', type: 'house' },
      { op: 'add', type: 'dog', at: { relation: 'near', ref: 'house_1' } },
    ],
  },
  {
    id: 'night-peak',
    text: 'a moon above a mountain',
    banned: ['moon', 'mountain'],
    phrases: ['a tall rocky peak', 'put the pale round light in the night sky above it'],
    expect: { objects: [{ type: 'mountain' }, { type: 'moon' }], relations: [['moon', 'above', 'mountain']], spots: [['moon', 'top']] },
    ops: [
      { op: 'add', type: 'mountain' },
      { op: 'add', type: 'moon', at: { relation: 'above', ref: 'mountain_1' } },
    ],
  },
  {
    id: 'floating-vessel',
    text: 'a boat on a river',
    banned: ['boat', 'river'],
    phrases: ['a flowing stream of water', 'put the vessel that floats and carries people on it'],
    expect: { objects: [{ type: 'river' }, { type: 'boat' }], relations: [['boat', 'on', 'river']] },
    ops: [
      { op: 'add', type: 'river' },
      { op: 'add', type: 'boat', at: { relation: 'on', ref: 'river_1' } },
    ],
  },
  {
    id: 'two-fliers',
    text: 'two birds above a tree',
    banned: ['bird', 'tree'],
    phrases: ['a tall plant with branches', 'put two animals with a beak and wings above it'],
    expect: { objects: [{ type: 'tree' }, { type: 'bird', count: 2 }], relations: [['bird', 'above', 'tree']] },
    ops: [
      { op: 'add', type: 'tree' },
      { op: 'add', type: 'bird', at: { relation: 'above', ref: 'tree_1' } },
      { op: 'add', type: 'bird', at: { relation: 'above', ref: 'tree_1' } },
    ],
  },
  {
    id: 'wheeled-machine',
    text: 'a big red car',
    banned: ['car'],
    phrases: ['a machine with four wheels that drives on roads', 'make it red', 'make it big'],
    expect: { objects: [{ type: 'car', color: 'red', size: 'big' }] },
    ops: [
      { op: 'add', type: 'car' },
      { op: 'recolor', target: 'car_1', color: 'red' },
      { op: 'scale', target: 'car_1', factor: 1.5 },
    ],
  },
  {
    id: 'figure-and-blades',
    text: 'a person with a windmill to the left',
    banned: ['person', 'windmill'],
    phrases: ['a standing figure with a face and two arms', 'put a tall tower with blades that spin in the wind to the left of it'],
    expect: { objects: [{ type: 'person' }, { type: 'windmill' }], relations: [['windmill', 'left_of', 'person']] },
    ops: [
      { op: 'add', type: 'person' },
      { op: 'add', type: 'windmill', at: { relation: 'left_of', ref: 'person_1' } },
    ],
  },
  {
    id: 'small-swimmer',
    text: 'a small fish next to a boat',
    banned: ['fish', 'boat'],
    phrases: ['a vessel that floats and carries people', 'put a small animal with fins that swims next to it'],
    expect: { objects: [{ type: 'boat' }, { type: 'fish', size: 'small' }], relations: [['fish', 'next_to', 'boat']] },
    ops: [
      { op: 'add', type: 'boat' },
      { op: 'add', type: 'fish', scale: 0.6, at: { relation: 'near', ref: 'boat_1' } },
    ],
  },
];
