// Noise layer: label-preserving speech disfluencies (V2-R1, R2, R13) and speech-to-text mishears (V2-R4).
// Self-corrections insert a wrong item before the real one, so the label (the corrected item) is unchanged.
import { COLORS, TYPES, type Op } from '../../src/scene/engine.ts';
import type { Rng } from './rng.ts';

const FILLERS = ['uh', 'um', 'like', 'uh like', 'hmm', 'er', 'you know'];
const PREAMBLES = ['okay so', 'um', 'so uh', 'alright', 'okay', 'i think', 'lets see', 'uh okay', 'right so'];
const CORRECTIONS = ['no', 'wait no', 'actually', 'i mean', 'no wait', 'sorry', 'no no'];
const CHATTER_PRE = ['haha okay', 'this is fun', 'oh nice', 'my turn', 'ooh okay', 'lol okay'];
const CHATTER_POST = ['thanks', 'and thats it', 'thats all', 'cool', 'nice'];
const STUTTER_WORDS = new Set(['the', 'a', 'to', 'and', 'it', 'on', 'make', 'put']);
const RESTARTABLE = new Set(['draw', 'add', 'put', 'place', 'sketch', 'make', 'move', 'delete', 'remove', 'erase', 'turn', 'color', 'paint', 'change', 'give', 'me', 'a', 'an', 'the', 'can', 'you', 'could', 'please', 'i', 'want', 'lets', 'now', 'go', 'ahead', 'and']);

/** Mishears applied only where the word is used in the sense we repair (V2-R4). */
const MISHEARS: { name: string; re: RegExp; to: string }[] = [
  { name: 'sun->son', re: /\bsun\b/, to: 'son' },
  { name: 'red->read', re: /\bred\b/, to: 'read' },
  { name: 'right->write', re: /\bright\b/, to: 'write' },
  { name: 'two->to', re: /\btwo (?=(cats|trees|houses|suns|clouds|mountains|rivers|moons|people|dogs|birds|fish|boats|cars|windmills|bears)\b)/, to: 'to ' },
  { name: 'draw a->drawer', re: /^draw an? (?=[a-z])/, to: 'drawer ' },
  { name: 'roof->rough', re: /\broof\b/, to: 'rough' },
];

export interface NoiseResult { text: string; noise: string[]; mishear: boolean }

const words = (t: string) => t.split(' ');
function insertAt(t: string, rng: Rng, what: string): string {
  const w = words(t);
  const i = rng.int(1, Math.max(1, w.length - 1));
  return [...w.slice(0, i), what, ...w.slice(i)].join(' ');
}

/** Canvas speech style: lowercase, no punctuation, single spaces. */
export const speechCase = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function applyNoise(text: string, ops: Op[], rng: Rng, opts: { mishear: boolean }): NoiseResult {
  let t = speechCase(text);
  const noise: string[] = [];
  let mishear = false;

  if (opts.mishear) {
    const applicable = MISHEARS.filter(m => m.re.test(t));
    if (applicable.length) { const m = rng.pick(applicable); t = t.replace(m.re, m.to); noise.push(`mishear:${m.name}`); mishear = true; }
  }

  const adds = ops.filter((o): o is Extract<Op, { op: 'add' }> => o.op === 'add');
  const colors = ops.flatMap(o => ('color' in o && o.color ? [o.color] : []));
  const ops_ = rng.shuffle(['filler', 'filler', 'stutter', 'restart', 'preamble', 'self_correction', 'chatter']);
  const n = rng.chance(0.5) ? 1 : rng.int(2, 3);
  for (const kind of ops_) {
    if (noise.filter(x => !x.startsWith('mishear')).length >= n) break;
    switch (kind) {
      case 'filler': t = insertAt(t, rng, rng.pick(FILLERS)); noise.push('filler'); break;
      case 'preamble': t = `${rng.pick(PREAMBLES)} ${t}`; noise.push('preamble'); break;
      case 'stutter': {
        const w = words(t);
        const idx = w.map((x, i) => (STUTTER_WORDS.has(x) ? i : -1)).filter(i => i >= 0);
        if (!idx.length) break;
        const i = rng.pick(idx);
        t = [...w.slice(0, i + 1), w[i], ...w.slice(i + 1)].join(' ');
        noise.push('stutter');
        break;
      }
      case 'restart': { // "put a put a sun": only verbs/articles repeat, so the restart never reads as a second object
        const w = words(t);
        let k = 0;
        while (k < Math.min(3, w.length - 2) && RESTARTABLE.has(w[k])) k++;
        if (k < 2 || w.slice(0, k).every(x => ['a', 'an', 'the', 'and'].includes(x))) break;
        t = [...w.slice(0, k), ...w].join(' ');
        noise.push('restart');
        break;
      }
      case 'self_correction': { // only on positive batches: the corrected item is what the ops already say
        if (!ops.length) break;
        const typeHits = adds.map(a => a.type).filter(ty => (t.match(new RegExp(`\\ban? ${ty}\\b`, 'g')) ?? []).length === 1);
        const colorHits = colors.filter(c => (t.match(new RegExp(`\\b${c}\\b`, 'g')) ?? []).length === 1);
        if (typeHits.length && (!colorHits.length || rng.chance(0.6))) {
          const ty = rng.pick(typeHits);
          const decoy = rng.pick(TYPES.filter(x => x !== ty));
          t = t.replace(new RegExp(`\\b(an?) ${ty}\\b`), `a ${decoy} ${rng.pick(CORRECTIONS)} $1 ${ty}`);
          noise.push('self_correction');
        } else if (colorHits.length) {
          const c = rng.pick(colorHits);
          const decoy = rng.pick(COLORS.filter(x => x !== c));
          t = t.replace(new RegExp(`\\b${c}\\b`), `${decoy} ${rng.pick(CORRECTIONS)} ${c}`);
          noise.push('self_correction');
        }
        break;
      }
      case 'chatter': // V2-R13: chatter around a valid command is ignored
        if (!ops.length) break;
        t = rng.chance(0.5) ? `${rng.pick(CHATTER_PRE)} ${t}` : `${t} ${rng.pick(CHATTER_POST)}`;
        noise.push('chatter');
        break;
    }
  }
  return { text: speechCase(t), noise, mishear };
}
