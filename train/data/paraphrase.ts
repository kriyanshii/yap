// Paraphrase step: rewrites wording only. Every paraphrase must keep the same slot words (objects, colors, positions, numbers,
// sizes and references); `slotsPreserved` enforces that, and any paraphraser (rules or an LLM) is held to it.
import { COLORS, TYPES } from '../../src/scene/engine.ts';
import type { Rng } from './rng.ts';

export interface Paraphraser {
  /** Logged per example as `paraphrase_model`. */
  name: string;
  paraphrase(text: string, rng: Rng): { text: string; rules: string[] } | null;
}

const SLOT_CANON: Record<string, string> = {
  cats: 'cat', trees: 'tree', houses: 'house', suns: 'sun', clouds: 'cloud',
  mountains: 'mountain', rivers: 'river', moons: 'moon', people: 'person', persons: 'person',
  dogs: 'dog', birds: 'bird', boats: 'boat', cars: 'car', windmills: 'windmill', bears: 'bear', puppy: 'dog', puppies: 'dog',
  large: 'big', little: 'small', larger: 'bigger', largest: 'biggest', centre: 'center', middle: 'center',
  beside: 'near', next: 'near', over: 'above', under: 'below', beneath: 'below', underneath: 'below',
  an: 'a', one: 'a',
};
const SLOT_WORDS = new Set([
  ...TYPES, ...COLORS, 'left', 'right', 'center', 'top', 'bottom', 'leftmost', 'rightmost', 'highest', 'lowest', 'far', 'roof',
  'on', 'near', 'above', 'below', 'of', 'a', 'two', 'three', 'four', 'five', 'ten', 'twice', 'half', 'times', 'double',
  'big', 'small', 'bigger', 'smaller', 'biggest', 'smallest', 'it', 'its', 'that', 'the', 'other', 'same', 'match', 'not', 'no',
  'except', 'but', 'everything', 'undo', 'clear', 'back', 'scratch', 'revert', 'reverse', 'over', 'wipe', 'start',
]);

/** Sorted multiset of canonical slot words. */
export function slotSignature(text: string): string {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\bget rid of\b/g, 'remove').split(/\s+/).filter(Boolean)
    .map(w => SLOT_CANON[w] ?? w).filter(w => SLOT_WORDS.has(w)).sort().join(' ');
}
export const slotsPreserved = (before: string, after: string) => slotSignature(before) === slotSignature(after);

type Rule = { name: string; apply: (t: string, rng: Rng) => string | null };
const LEAD_VERB = /^(draw|add|put|place|sketch|make|move|delete|remove|erase|get rid of|color|turn|paint|change|undo|clear|double)\b/;

const RULES: Rule[] = [
  { name: 'polite_prefix', apply: (t, rng) => (LEAD_VERB.test(t) ? `${rng.pick(['can you', 'could you', 'please', 'i want you to', 'lets', 'go ahead and', 'now'])} ${t}` : null) },
  { name: 'polite_suffix', apply: (t, rng) => `${t} ${rng.pick(['please', 'for me', 'thanks', 'thank you'])}` },
  { name: 'verb_swap', apply: (t, rng) => {
    const swaps: [RegExp, string[]][] = [
      [/^draw\b/, ['sketch', 'add', 'make']], [/^add\b/, ['draw', 'put in']], [/^sketch\b/, ['draw']],
      [/^delete\b/, ['remove', 'erase', 'get rid of']], [/^remove\b/, ['delete', 'erase', 'take away']], [/^erase\b/, ['delete', 'remove']],
      [/^get rid of\b/, ['delete', 'remove']], [/^move\b/, ['shift', 'slide']], [/^paint\b/, ['color', 'make']], [/^turn\b/, ['make', 'color']],
    ];
    for (const [re, alts] of swaps) if (re.test(t)) return t.replace(re, rng.pick(alts));
    return null;
  } },
  { name: 'recolor_frame', apply: (t, rng) => {
    const color = COLORS.join('|');
    const m = t.match(new RegExp(`^make (the [a-z ]+?|it|that) (${color})$`));
    return m ? rng.pick([`color ${m[1]} ${m[2]}`, `turn ${m[1]} ${m[2]}`, `paint ${m[1]} ${m[2]}`, `change ${m[1]} to ${m[2]}`]) : null;
  } },
  { name: 'want_frame', apply: (t, rng) => (/^(draw|add) an? /.test(t) && !/ and | then /.test(t) ? t.replace(/^(draw|add) /, `${rng.pick(['i want', 'i would like', 'give me', 'lets have', 'how about'])} `) : null) },
  { name: 'front_position', apply: t => {
    const m = t.match(/^((?:draw|add|put|place|sketch) an? [a-z ]+?) ((?:on|in|at) the (?:left|right|middle|center|top|bottom|top left|top right|bottom left|bottom right)(?: side| corner)?)$/);
    return m && !/ and | then /.test(m[1]) ? `${m[2]} ${m[1]}` : null;
  } },
];

export const ruleParaphraser: Paraphraser = {
  name: 'rules-v1',
  paraphrase(text, rng) {
    const rules: string[] = [];
    let out = text;
    for (const rule of rng.shuffle(RULES)) {
      if (rules.length >= (rng.chance(0.4) ? 2 : 1)) break;
      if (rule.name === 'polite_prefix' && rules.includes('want_frame')) continue;
      const next = rule.apply(out, rng);
      if (next && next !== out) { out = next; rules.push(rule.name); }
    }
    return rules.length ? { text: out, rules } : null;
  },
};
