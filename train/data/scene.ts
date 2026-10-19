// Scene sampler: random valid scenes of 0-5 objects, with ids out of spatial order (like the benchmarks), a focus and history_len.
import { COLORS, DEFAULTS, TYPES, type ObjectType, type SceneObject } from '../../src/scene/engine.ts';
import type { MapperInput } from '../../eval/types.ts';
import type { Rng } from './rng.ts';

export interface SceneOpts {
  min?: number;
  max?: number;
  /** Exact counts for these types; other types fill the rest. */
  require?: Partial<Record<ObjectType, number>>;
  /** Types that must not appear. */
  forbid?: ObjectType[];
  /** 'none' forces focus_id null; 'any' (default) is null half the time. A type forces focus on an object of that type. */
  focus?: 'none' | 'any' | ObjectType;
  /** Minimum history_len (e.g. 1 for undo). */
  minHistory?: number;
  /** Exact history_len. */
  history?: number;
}

const round = (v: number) => Math.round(v * 100) / 100;
const SKY: readonly ObjectType[] = ['sun', 'cloud'];

function position(rng: Rng, type: ObjectType): [number, number] {
  const x = round(0.08 + rng.next() * 0.84);
  const y = SKY.includes(type) ? round(0.08 + rng.next() * 0.3) : round(0.45 + rng.next() * 0.45);
  return [x, y];
}

export function sampleScene(rng: Rng, opts: SceneOpts = {}): MapperInput {
  const required = Object.entries(opts.require ?? {}) as [ObjectType, number][];
  const nRequired = required.reduce((s, [, n]) => s + n, 0);
  const min = Math.max(opts.min ?? 0, nRequired);
  const max = Math.max(opts.max ?? 5, min);
  const n = rng.int(min, max);
  const fillTypes = TYPES.filter(t => !opts.forbid?.includes(t) && !(opts.require && t in opts.require));

  const types: ObjectType[] = required.flatMap(([t, k]) => Array<ObjectType>(k).fill(t));
  while (types.length < n && fillTypes.length) types.push(rng.pick(fillTypes));

  // Ids are type_N with distinct N per type, drawn from 1..count+2 and shuffled, so "_1" is not a safe guess.
  const ids = new Map<ObjectType, number[]>();
  for (const t of new Set(types)) {
    const count = types.filter(x => x === t).length;
    ids.set(t, rng.sample(Array.from({ length: count + 2 }, (_, i) => i + 1), count));
  }
  const objects: SceneObject[] = rng.shuffle(types).map(type => {
    const [x, y] = position(rng, type);
    return {
      id: `${type}_${ids.get(type)!.shift()}`,
      type,
      color: rng.chance(0.6) ? DEFAULTS[type] : rng.pick(COLORS),
      x, y,
      scale: rng.chance(0.7) ? 1 : rng.pick([0.6, 0.75, 1.3, 1.5, 2]),
    };
  });

  let focus_id: string | null = null;
  if (opts.focus && opts.focus !== 'any' && opts.focus !== 'none') focus_id = rng.pick(objects.filter(o => o.type === opts.focus)).id;
  else if (opts.focus !== 'none' && objects.length && rng.chance(0.5)) focus_id = rng.pick(objects).id;

  const history_len = opts.history ?? Math.max(opts.minHistory ?? 0, rng.chance(0.15) ? 0 : rng.int(objects.length ? 1 : 0, objects.length + 3));
  return { utterance: '', scene: { objects }, focus_id, history_len };
}

export const ofType = (input: MapperInput, t: ObjectType) => input.scene.objects.filter(o => o.type === t);
/** Types with exactly one object in the scene. */
export const uniqueTypes = (input: MapperInput) => TYPES.filter(t => ofType(input, t).length === 1);
export const absentTypes = (input: MapperInput) => TYPES.filter(t => ofType(input, t).length === 0);
