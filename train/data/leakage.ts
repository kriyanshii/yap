// Leakage check: a training utterance leaks if it is within character edit distance LEAK_DISTANCE of a v1, v2, or scenic
// benchmark utterance AND names the same objects and relations. So "put a tree next to the cat" may stay, but "put the cat on the house"
// (a near-copy of a benchmark frame) may not. Mishears are canonicalized first, so "on the rough" counts as "on the roof".
import { readFileSync } from 'node:fs';
import { SCENIC_CASES } from '../../eval/scenicCases.ts';
import { TYPES } from '../../src/scene/engine.ts';
import { UNSUPPORTED_NOUNS } from './intents.ts';

export const LEAK_DISTANCE = 5;
export const BENCHMARK_FILES = ['yap-eval-v1.jsonl', 'yap-eval-v2-hard.jsonl'];

/** Lowercase, letters/digits only, single spaces: the form both sides are compared in. */
export const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Levenshtein distance, or max+1 as soon as it is known to exceed `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const OBJECT_CANON: Record<string, string> = {
  cats: 'cat', trees: 'tree', houses: 'house', suns: 'sun', clouds: 'cloud', kitty: 'cat', kitten: 'cat',
  roof: 'house', rough: 'house', son: 'sun', dogs: 'dog', cars: 'car', birds: 'bird', apple: 'apples',
  mountains: 'mountain', rivers: 'river', moons: 'moon', people: 'person', persons: 'person',
  boats: 'boat', windmills: 'windmill', bears: 'bear', puppy: 'dog', puppies: 'dog', lakes: 'river', lake: 'river',
};
/** Nouns that count as objects: supported types, the generator's unsupported nouns, and the other nouns the benchmarks use. */
const OBJECT_WORDS = new Set<string>([...TYPES, ...UNSUPPORTED_NOUNS, 'spaceship', 'tea', 'hat', 'chimney', 'smoke', 'apples', 'sunglasses', 'animal', 'pet']);
const RELATIONS: [RegExp, string][] = [
  [/\b(on top of|on the roof|on its roof|onto|on)\b/, 'on'], [/\b(next to|beside|near|by)\b/, 'near'], [/\b(above|over)\b/, 'above'],
  [/\b(under|underneath|beneath|below)\b/, 'below'], [/\bleft of\b/, 'left_of'], [/\bright of\b|\bwrite of\b/, 'right_of'], [/\bin the (tree|house)\b/, 'in'],
];

/** The objects and relations an utterance names, e.g. "cat,house|on". */
export function signature(text: string): string {
  const n = normalize(text);
  const objects = new Set(n.split(' ').map(w => OBJECT_CANON[w] ?? w).filter(w => OBJECT_WORDS.has(w)));
  // "on the left" is a spot, not the "on" relation
  const rel = n.replace(/\bon the ((top |bottom )?(left|right)|top|bottom)( side| corner)?\b/g, ' ');
  const relations = new Set(RELATIONS.filter(([re]) => re.test(rel)).map(([, r]) => r));
  return `${[...objects].sort().join(',')}|${[...relations].sort().join(',')}`;
}

export interface BenchUtterance { id: string; utterance: string; norm: string; sig: string }

export function loadBenchmarkUtterances(root = new URL('../../', import.meta.url)): BenchUtterance[] {
  const fromFiles = BENCHMARK_FILES.flatMap(f => readFileSync(new URL(f, root), 'utf8').split('\n').filter(Boolean).map(l => {
    const c = JSON.parse(l);
    return { id: c.id as string, utterance: c.input.utterance as string, norm: normalize(c.input.utterance), sig: signature(c.input.utterance) };
  }));
  const scenic = SCENIC_CASES.map(c => ({ id: c.id, utterance: c.input.utterance, norm: normalize(c.input.utterance), sig: signature(c.input.utterance) }));
  return [...fromFiles, ...scenic];
}

/** The closest benchmark utterance within LEAK_DISTANCE that names the same objects and relations, else null. */
export function nearestLeak(utterance: string, bench: BenchUtterance[], max = LEAK_DISTANCE): { bench: BenchUtterance; distance: number } | null {
  const u = normalize(utterance);
  const sig = signature(utterance);
  let best: { bench: BenchUtterance; distance: number } | null = null;
  for (const b of bench) {
    if (b.sig !== sig) continue;
    const d = editDistance(u, b.norm, best ? best.distance - 1 : max);
    if (d <= max && (!best || d < best.distance)) best = { bench: b, distance: d };
  }
  return best;
}

export interface LeakReport {
  checked: number;
  leaks: { utterance: string; bench: BenchUtterance; distance: number }[];
  /** Utterances within LEAK_DISTANCE of a benchmark utterance but naming different objects/relations (allowed). */
  nearButDifferent: number;
  /** Closest pair with the same objects and relations (the margin the rule protects). */
  minDistance: number;
  closest?: { utterance: string; bench: string };
}

export function checkLeakage(utterances: string[], bench = loadBenchmarkUtterances()): LeakReport {
  const leaks: LeakReport['leaks'] = [];
  let nearButDifferent = 0;
  let minDistance = Infinity;
  let closest: LeakReport['closest'];
  for (const u of utterances) {
    const n = normalize(u);
    const sig = signature(u);
    let near = false;
    for (const b of bench) {
      const same = b.sig === sig;
      const d = editDistance(n, b.norm, same ? Math.min(minDistance, 1e9) : LEAK_DISTANCE);
      if (same && d < minDistance) { minDistance = d; closest = { utterance: u, bench: `${b.id}: ${b.utterance}` }; }
      if (!same && d <= LEAK_DISTANCE) near = true;
    }
    const hit = nearestLeak(u, bench);
    if (hit) leaks.push({ utterance: u, ...hit });
    else if (near) nearButDifferent++;
  }
  return { checked: utterances.length, leaks, nearButDifferent, minDistance, closest };
}
