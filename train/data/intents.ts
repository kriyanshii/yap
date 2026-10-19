// Intent sampler + template writer. Each generator picks the target op batch in code and writes a template utterance for it,
// following README.md rules 1-10 and README-v2.md V2-R1..R19, so labels are correct by construction.
import { COLORS, TYPES, type Color, type ObjectType, type Op, type Pos, type Relation, type SceneObject, type Spot } from '../../src/scene/engine.ts';
import type { MapperInput } from '../../eval/types.ts';
import type { Rng } from './rng.ts';
import { absentTypes, ofType, sampleScene, uniqueTypes } from './scene.ts';

export const CATEGORY_WEIGHTS = { empty: 0.3, multi_place: 0.15, references: 0.15, messy: 0.15, indirect: 0.1, simple: 0.15 } as const;
export type Category = keyof typeof CATEGORY_WEIGHTS;

export const EMPTY_REASONS = ['unsupported_object', 'missing_ref', 'deleted_ref', 'ambiguous_ref', 'no_focus', 'unsupported_color', 'chatter',
  'undo_no_history', 'undo_clear_combo', 'vague_description'] as const;
export type EmptyReason = typeof EMPTY_REASONS[number];
/** Reasons whose `rejected` ops are checked to fail on the engine; the rest hold by construction (vocabulary, focus null, hand-labeled vague). */
export const ENGINE_CHECKED: readonly EmptyReason[] = ['missing_ref', 'deleted_ref', 'ambiguous_ref', 'undo_no_history', 'undo_clear_combo'];

export interface Intent {
  category: Category;
  subtype: string;
  /** `utterance` holds the template text. */
  input: MapperInput;
  ops: Op[];
  policy: 'strict' | 'inferred';
  reason?: EmptyReason;
  /** [] cases: what a mapper would emit if it ignored the problem. For ENGINE_CHECKED reasons the engine must reject it. */
  rejected?: Op[];
}
type Gen = (rng: Rng) => Intent | null;

// ---------- phrases ----------
const PLURAL: Record<ObjectType, string> = { cat: 'cats', tree: 'trees', house: 'houses', sun: 'suns', cloud: 'clouds' };
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five'];
const SIZE_WORDS: Record<number, string[]> = { 1.5: ['big', 'large'], 0.6: ['small', 'little'] };
const SPOT_ADD: Record<Spot, string[]> = {
  left: ['on the left', 'on the left side'], right: ['on the right', 'on the right side'],
  center: ['in the middle', 'in the center'], top: ['at the top', 'up top', 'up high', 'high up'], bottom: ['at the bottom', 'down at the bottom'],
  'top-left': ['in the top left', 'in the top left corner'], 'top-right': ['in the top right', 'in the top right corner'],
  'bottom-left': ['in the bottom left', 'in the bottom left corner'], 'bottom-right': ['in the bottom right', 'in the bottom right corner'],
};
/** V2-R5: sky phrases mean `top`; only used for things that belong in the sky. */
const SKY_TOP = ['up in the sky', 'high in the sky', 'in the sky'];
export const SKY_RE = /\b(up in|high in|in|across) the (daytime )?sky\b|\bup high\b|\bhigh up\b/;
const spotText = (rng: Rng, spot: Spot, type?: ObjectType) =>
  spot === 'top' && (type === 'sun' || type === 'cloud') && rng.chance(0.4) ? rng.pick(SKY_TOP) : rng.pick(SPOT_ADD[spot]);
const SPOT_MOVE: Record<Spot, string[]> = {
  left: ['to the left', 'over to the left', 'to the left side'], right: ['to the right', 'over to the right', 'to the right side'],
  center: ['to the middle', 'to the center'], top: ['to the top', 'up to the top', 'up high'], bottom: ['to the bottom', 'down to the bottom'],
  'top-left': ['to the top left', 'to the top left corner'], 'top-right': ['to the top right', 'to the top right corner'],
  'bottom-left': ['to the bottom left', 'to the bottom left corner'], 'bottom-right': ['to the bottom right', 'to the bottom right corner'],
};
const SPOTS_LIST = Object.keys(SPOT_ADD) as Spot[];
const REL_WORDS: Record<Relation, string[]> = {
  on: ['on', 'on top of'], near: ['next to', 'beside', 'near'], above: ['above', 'over'],
  below: ['under', 'below', 'beneath', 'underneath'], left_of: ['to the left of', 'left of'], right_of: ['to the right of', 'right of'],
};
const RELS = Object.keys(REL_WORDS) as Relation[];
const ON_OK: readonly ObjectType[] = ['house', 'tree', 'cloud'];

export const UNSUPPORTED_NOUNS = ['dog', 'car', 'bird', 'flower', 'boat', 'horse', 'moon', 'fish', 'mountain', 'river', 'rocket', 'robot', 'bicycle',
  'dragon', 'airplane', 'snowman', 'butterfly', 'rainbow', 'fence', 'umbrella', 'pizza', 'guitar', 'train', 'cow', 'duck', 'lamp', 'truck', 'whale'];
const EXTRAS: Record<ObjectType, string[]> = {
  cat: ['wearing a scarf', 'with a bow tie', 'holding a fish', 'with a crown on', 'wearing boots'],
  tree: ['with apples', 'with a swing hanging from it', 'with flowers around it', 'with a ladder against it', 'with an owl in it'],
  house: ['with a chimney', 'with a garden', 'with a fence around it', 'with a garage', 'with a mailbox out front'],
  sun: ['with a smiley face', 'wearing a hat', 'with a moon next to it', 'with stars around it'],
  cloud: ['with lightning', 'with rain falling', 'with a rainbow under it', 'with birds flying past'],
};
export const UNSUPPORTED_COLORS = ['silver', 'gold', 'teal', 'beige', 'maroon', 'turquoise', 'navy', 'lavender', 'cyan', 'magenta', 'cream',
  'crimson', 'tan', 'olive', 'indigo', 'peach', 'lime', 'violet'];
const CHATTER_OPEN = ['', 'haha ', 'lol ', 'okay ', 'hey ', 'oh man ', 'wow ', 'hmm '];
const CHATTER_BODY = ['this is so fun', 'i love this game', 'who is winning right now', 'whats the score', 'my turn next', 'hang on a second',
  'can you guys hear me', 'i dont know what to do', 'that looks so weird', 'nice one', 'wait what happened', 'hold on my mic is acting up',
  'okay im ready', 'is it my turn yet', 'how much time is left', 'that was hilarious', 'good game everyone', 'what are we supposed to make',
  'i need a snack', 'be right back', 'you are so good at this', 'my brother is laughing at me', 'is this thing on', 'testing testing'];
const UNDO_PHRASES = ['undo', 'undo that', 'undo the last thing', 'go back', 'take that back', 'scratch that', 'undo please', 'undo what i just did',
  'revert that', 'oops undo', 'that was wrong undo it', 'go back one step', 'reverse that'];
const CLEAR_PHRASES = ['clear', 'clear everything', 'clear the canvas', 'clear it all', 'start over', 'wipe the canvas', 'erase everything',
  'delete everything', 'clear the screen', 'start from scratch', 'wipe everything', 'remove everything', 'clear the whole picture'];
const INDIRECT_CLEAR: Record<ObjectType, string[]> = {
  cat: ['the animal that purrs', 'a pet that says meow', 'a pet with whiskers that purrs', 'the furry animal that hunts mice', 'the pet that sleeps all day and purrs'],
  tree: ['a tall plant with branches', 'the thing birds build nests in', 'a plant with bark and branches', 'the plant that drops its leaves in autumn', 'a woody plant that grows tall'],
  house: ['a home with a roof and a door', 'the place where people live', 'a building with windows and a front door', 'the place you go home to at night'],
  sun: ['the star that lights up the day', 'the hot glowing ball in the daytime sky', 'the bright light that makes it daytime', 'the thing that gives us daylight'],
  cloud: ['a puffy shape that floats in the sky', 'the soft fluffy thing drifting across the sky', 'the thing in the sky that rain falls from', 'a fluffy patch of mist in the sky'],
};
const INDIRECT_VAGUE = ['a creature', 'some kind of animal', 'something that lives outside', 'something big', 'something nice', 'a shape', 'a living thing',
  'something in nature', 'something you see outside', 'something soft', 'something bright', 'a plant', 'a building', 'something with four legs',
  'a thing that flies', 'something hot', 'something round and yellow', 'something green', 'a thing up in the air', 'something pretty', 'an object',
  'something that moves', 'a thing you find in a park'];

const art = (next: string) => (/^[aeiou]/.test(next) ? 'an' : 'a');
const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');
const theT = (t: ObjectType) => `the ${t}`;

function noun(rng: Rng, f: { type: ObjectType; color?: Color; scale?: number }, count = 1): string {
  const rest = join(f.scale !== undefined && rng.pick(SIZE_WORDS[f.scale]), f.color, count > 1 ? PLURAL[f.type] : f.type);
  return `${count > 1 ? NUM[count] : art(rest)} ${rest}`;
}
function addFields(rng: Rng, pColor = 0.35, pScale = 0.2): { color?: Color; scale?: number } {
  return { ...(rng.chance(pColor) && { color: rng.pick(COLORS) }), ...(rng.chance(pScale) && { scale: rng.pick([1.5, 0.6]) }) };
}
const addOp = (type: ObjectType, f: { color?: Color; scale?: number }, at?: Pos): Op =>
  ({ op: 'add', type, ...(f.color && { color: f.color }), ...(at !== undefined && { at }), ...(f.scale !== undefined && { scale: f.scale }) });
function relText(rng: Rng, rel: Relation, ref: string, refType: ObjectType): string {
  if (rel === 'on' && refType === 'house' && (ref === 'it' || ref === 'the house') && rng.chance(0.3)) return ref === 'it' ? 'on its roof' : 'on the roof';
  return `${rng.pick(REL_WORDS[rel])} ${ref}`;
}
const relFor = (rng: Rng, refType: ObjectType) => rng.pick(RELS.filter(r => r !== 'on' || ON_OK.includes(refType)));
const otherColor = (rng: Rng, c?: Color) => rng.pick(COLORS.filter(x => x !== c));

/** One edit clause on an existing object. `T` is how the target is named ("the tree", "the left tree", "it"). */
function editClause(rng: Rng, input: MapperInput, target: SceneObject, T: string, kind = rng.weighted({ recolor: 3, move: 3, scale: 2, delete: 2 })): { text: string; op: Op } {
  switch (kind) {
    case 'recolor': {
      const color = otherColor(rng, target.color);
      return { text: rng.pick([`make ${T} ${color}`, `color ${T} ${color}`, `turn ${T} ${color}`, `paint ${T} ${color}`, `change ${T} to ${color}`]), op: { op: 'recolor', target: target.id, color } };
    }
    case 'move': {
      const refs = uniqueTypes(input).filter(t => t !== target.type);
      if (refs.length && rng.chance(0.3)) {
        const refType = rng.pick(refs);
        const rel = relFor(rng, refType);
        return { text: `${rng.pick(['move', 'put'])} ${T} ${relText(rng, rel, theT(refType), refType)}`, op: { op: 'move', target: target.id, to: { relation: rel, ref: ofType(input, refType)[0].id } } };
      }
      const spot = rng.pick(SPOTS_LIST);
      return { text: rng.chance(0.7) ? `move ${T} ${rng.pick(SPOT_MOVE[spot])}` : `put ${T} ${rng.pick(SPOT_ADD[spot])}`, op: { op: 'move', target: target.id, to: spot } };
    }
    case 'scale': {
      const k = rng.weighted({ bigger: 3, smaller: 3, twice: 2, half: 2, times: 1 });
      const [factor, texts]: [number, string[]] =
        k === 'bigger' ? [1.3, [`make ${T} bigger`, `make ${T} larger`]]
        : k === 'smaller' ? [0.75, [`make ${T} smaller`, `make ${T} a bit smaller`]]
        : k === 'twice' ? [2, [`make ${T} twice as big`, `make ${T} twice as large`, `double the size of ${T}`]]
        : k === 'half' ? [0.5, [`make ${T} half the size`, `make ${T} half as big`]]
        : (() => { const n = rng.pick([3, 4, 5, 10]); const w = n === 10 ? 'ten' : NUM[n]; return [n, [`make ${T} ${w} times bigger`, `make ${T} ${w} times as big`]] as [number, string[]]; })();
      return { text: rng.pick(texts), op: { op: 'scale', target: target.id, factor } };
    }
    default: {
      const verbs = ['delete', 'remove', 'erase', 'get rid of', 'take away', ...(T === 'it' || T === 'that' ? [] : ['clear'])];
      return { text: `${rng.pick(verbs)} ${T}`, op: { op: 'delete', target: target.id } };
    }
  }
}

const intent = (category: Category, subtype: string, input: MapperInput, text: string, ops: Op[], extra: Partial<Intent> = {}): Intent =>
  ({ category, subtype, input: { ...input, utterance: text }, ops, policy: category === 'indirect' ? 'inferred' : 'strict', ...extra });
const empty = (subtype: string, input: MapperInput, text: string, reason: EmptyReason, rejected?: Op[], category: Category = 'empty') =>
  intent(category, subtype, input, text, [], { reason, ...(rejected && { rejected }) });

// ---------- simple: adds, edits, undo, clear ----------
const addVerb = (rng: Rng, placed: boolean) => rng.pick(placed ? ['draw', 'add', 'put', 'place', 'sketch', ''] : ['draw', 'add', 'sketch', 'make', '']);

function placement(rng: Rng, input: MapperInput, exclude: ObjectType[] = []): { at?: Pos; text?: string } {
  const refs = uniqueTypes(input).filter(t => !exclude.includes(t));
  if (refs.length && rng.chance(0.35)) {
    const refType = rng.pick(refs);
    const rel = relFor(rng, refType);
    return { at: { relation: rel, ref: ofType(input, refType)[0].id }, text: relText(rng, rel, theT(refType), refType) };
  }
  const spot = rng.pick(SPOTS_LIST);
  return { at: spot, text: rng.pick(SPOT_ADD[spot]) };
}

const simple: Record<string, [number, Gen]> = {
  add_single: [3, rng => {
    const input = sampleScene(rng);
    const type = rng.pick(TYPES);
    const f = addFields(rng);
    const p = rng.chance(0.5) ? placement(rng, input) : {};
    const text = p.at === 'top' ? spotText(rng, 'top', type) : p.text;
    return intent('simple', 'add_single', input, join(addVerb(rng, !!p.at), noun(rng, { type, ...f }), text), [addOp(type, f, p.at)]);
  }],
  add_count: [2, rng => {
    const input = sampleScene(rng);
    const type = rng.pick(TYPES);
    const n = rng.int(2, 4);
    const f = addFields(rng, 0.3, 0.2);
    const p = rng.chance(0.4) ? placement(rng, input, [type]) : {};
    return intent('simple', 'add_count', input, join(addVerb(rng, !!p.at), noun(rng, { type, ...f }, n), p.text), Array.from({ length: n }, () => addOp(type, f, p.at)));
  }],
  add_pair: [2, rng => {
    const input = sampleScene(rng);
    const [t1, t2] = rng.sample(TYPES, 2);
    const f1 = addFields(rng, 0.25, 0.15), f2 = addFields(rng, 0.25, 0.15);
    const mode = rng.weighted({ shared: 2, anchored: 2, none: 1 });
    if (mode === 'anchored') {
      const rel = relFor(rng, t1);
      return intent('simple', 'add_pair_anchored', input, join(addVerb(rng, false), noun(rng, { type: t1, ...f1 }), 'and', noun(rng, { type: t2, ...f2 }), relText(rng, rel, 'it', t1)),
        [addOp(t1, f1), addOp(t2, f2, { relation: rel, ref: { added_in_op: 0 } })]);
    }
    const p = mode === 'shared' ? placement(rng, input, [t1, t2]) : {};
    return intent('simple', `add_pair_${mode}`, input, join(addVerb(rng, !!p.at), noun(rng, { type: t1, ...f1 }), 'and', noun(rng, { type: t2, ...f2 }), p.text),
      [addOp(t1, f1, p.at), addOp(t2, f2, p.at)]);
  }],
  add_new_ref: [2, rng => { // V2-R6: "the house" refers to the house added earlier in the same batch
    const input = sampleScene(rng, { max: 4 });
    const absent = absentTypes(input);
    if (!absent.length) return null;
    const t1 = rng.pick(absent);
    const t2 = rng.pick(TYPES.filter(t => t !== t1));
    const rel = relFor(rng, t1);
    const f2 = addFields(rng, 0.25, 0.15);
    const second = rng.chance(0.6) ? relText(rng, rel, theT(t1), t1) : relText(rng, rel, 'it', t1);
    const text = join(rng.pick(['draw', 'add']), noun(rng, { type: t1 }), rng.pick(['and', 'then', 'and then']), rng.pick(['', 'put', 'add']), noun(rng, { type: t2, ...f2 }), second);
    return intent('simple', 'add_new_ref', input, text, [addOp(t1, {}), addOp(t2, f2, { relation: rel, ref: { added_in_op: 0 } })]);
  }],
  add_fold: [2, rng => { // V2-R7: edits on a same-batch add fold into the add
    const input = sampleScene(rng);
    const type = rng.pick(TYPES);
    const parts: string[] = [];
    const f: { color?: Color; scale?: number } = {};
    let at: Spot | undefined;
    for (const k of rng.shuffle(['color', 'size', 'spot'])) {
      if (parts.length && rng.chance(0.4)) continue;
      if (k === 'color') { f.color = rng.pick(COLORS); parts.push(`make it ${f.color}`); }
      if (k === 'size') { f.scale = rng.pick([1.5, 0.6]); parts.push(`make it ${rng.pick(SIZE_WORDS[f.scale])}`); }
      if (k === 'spot') { at = rng.pick(SPOTS_LIST); parts.push(rng.chance(0.5) ? `put it ${rng.pick(SPOT_ADD[at])}` : `move it ${rng.pick(SPOT_MOVE[at])}`); }
    }
    return intent('simple', 'add_fold', input, join(rng.pick(['draw', 'add']), noun(rng, { type }), 'and', parts.join(' and ')), [addOp(type, f, at)]);
  }],
  add_relation: [4, rng => { // short "put a cat on the house" with a unique referent
    const refType = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 1, require: { [refType]: 1 } });
    const type = rng.pick(TYPES);
    const f = addFields(rng, 0.2, 0.15);
    const rel = relFor(rng, refType);
    return intent('simple', 'add_relation', input, join(rng.pick(['', 'put', 'draw', 'add', 'place']), noun(rng, { type, ...f }), relText(rng, rel, theT(refType), refType)),
      [addOp(type, f, { relation: rel, ref: ofType(input, refType)[0].id })]);
  }],
  delete_readd: [2, rng => { // "delete the tree and draw a new tree on the right then put a cat under it": the new tree is a real add
    const [type, other] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 1, require: { [type]: 1 } });
    const X = ofType(input, type)[0];
    const spot = rng.pick(SPOTS_LIST);
    const ops: Op[] = [{ op: 'delete', target: X.id }, addOp(type, {}, spot)];
    let text = `${rng.pick(['delete', 'remove', 'erase', 'get rid of'])} the ${type} ${rng.pick(['and', 'then', 'and then'])} ${rng.pick(['draw', 'add', 'put'])} ${rng.pick(['a new', 'another'])} ${type} ${rng.pick(SPOT_ADD[spot])}`;
    if (rng.chance(0.6)) {
      const rel = relFor(rng, type);
      text += ` ${rng.pick(['then put', 'and put', 'then add', 'and'])} ${noun(rng, { type: other })} ${relText(rng, rel, rng.chance(0.7) ? 'it' : `the new ${type}`, type)}`;
      ops.push(addOp(other, {}, { relation: rel, ref: { added_in_op: 1 } }));
    }
    return intent('simple', 'delete_readd', input, text, ops);
  }],
  edit: [6, rng => {
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 1, require: { [type]: 1 } });
    const target = ofType(input, type)[0];
    const c = editClause(rng, input, target, theT(type));
    return intent('simple', `edit_${c.op.op}`, input, c.text, [c.op]);
  }],
  undo: [1.5, rng => {
    const input = sampleScene(rng, { minHistory: 1 });
    return intent('simple', 'undo', input, rng.pick(UNDO_PHRASES), [{ op: 'undo' }]);
  }],
  clear: [1.5, rng => intent('simple', 'clear', sampleScene(rng), rng.pick(CLEAR_PHRASES), [{ op: 'clear' }])],
  multi_edit: [3, rng => {
    const mode = rng.weighted({ anchored: 2, gapped: 2, mixed: 2 });
    if (mode === 'anchored') { // "make the tree blue and move it left": the pronoun is anchored by the noun, regardless of focus
      const type = rng.pick(TYPES);
      const input = sampleScene(rng, { min: 1, require: { [type]: 1 } });
      const target = ofType(input, type)[0];
      const kinds = rng.sample(['recolor', 'move', 'scale'] as const, rng.int(2, 3));
      const clauses = kinds.map((k, i) => editClause(rng, input, target, i === 0 ? theT(type) : 'it', k));
      return intent('simple', 'multi_edit_anchored', input, clauses.map(c => c.text).join(rng.pick([' and ', ' then ', ' and then '])), clauses.map(c => c.op));
    }
    if (mode === 'gapped') { // "make the house blue the tree yellow and the sun smaller"
      const types = rng.sample(TYPES, rng.int(2, 3));
      const input = sampleScene(rng, { min: types.length, require: Object.fromEntries(types.map(t => [t, 1])) });
      const ops: Op[] = [];
      const bits = types.map((t, i) => {
        const o = ofType(input, t)[0];
        if (rng.chance(0.75)) { const color = otherColor(rng, o.color); ops.push({ op: 'recolor', target: o.id, color }); return i === 0 ? `make the ${t} ${color}` : `the ${t} ${color}`; }
        const [factor, w] = rng.pick([[1.3, 'bigger'], [0.75, 'smaller']] as const); ops.push({ op: 'scale', target: o.id, factor }); return i === 0 ? `make the ${t} ${w}` : `the ${t} ${w}`;
      });
      const text = bits.length === 2 ? bits.join(' and ') : `${bits[0]} ${bits[1]} and ${bits[2]}`;
      return intent('simple', 'multi_edit_gapped', input, text, ops);
    }
    // mixed add + edit on different types
    const [editType, addType] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 1, require: { [editType]: 1 }, forbid: [addType] });
    const c = editClause(rng, input, ofType(input, editType)[0], theT(editType));
    const f = addFields(rng, 0.25, 0.15);
    const p = rng.chance(0.5) ? placement(rng, input, [editType]) : {};
    const add = join(rng.pick(['draw', 'add']), noun(rng, { type: addType, ...f }), p.text);
    const addFirst = rng.chance(0.5);
    const text = addFirst ? `${add} ${rng.pick(['and', 'then'])} ${c.text}` : `${c.text} ${rng.pick(['and', 'then'])} ${add}`;
    const a = addOp(addType, f, p.at);
    return intent('simple', 'multi_edit_mixed', input, text, addFirst ? [a, c.op] : [c.op, a]);
  }],
};

// ---------- multi_place: 3-5 objects, each with its own position ----------
const multiPlace: Gen = rng => {
  const input = sampleScene(rng, { max: 2, require: {} });
  // Scene refs must be unique and not re-added; new refs must not exist in the scene (V2-R6), so added types are absent ones.
  const sceneRefs = uniqueTypes(input);
  const pool = rng.shuffle(absentTypes(input));
  if (pool.length < 2) return null;
  const k = rng.int(3, 5);
  const ops: Op[] = [];
  const clauses: string[] = [];
  const addedOnce = new Map<ObjectType, number>(); // type -> op index, for types added exactly once
  let lastSingle: { type: ObjectType; idx: number } | null = null;
  const usedSpots = new Set<Spot>();
  const freshSpot = () => rng.pick(SPOTS_LIST.filter(s => !usedSpots.has(s)));

  while (ops.length < k && pool.length) {
    const type = pool.shift()!;
    const remaining = k - ops.length;
    const f = addFields(rng, 0.25, 0.15);
    const groupWith = remaining >= 2 && pool.length && rng.chance(0.2) ? pool.shift()! : null;
    const count = !groupWith && remaining >= 2 && rng.chance(0.15) ? rng.int(2, Math.min(3, remaining)) : 1;
    // position: own spot, relative to an earlier add, or relative to a unique scene object
    const r = rng.next();
    let at: Pos; let posText: string;
    const earlier = [...addedOnce.entries()];
    if (r < 0.3 && earlier.length) {
      const [refType, idx] = rng.pick(earlier);
      const rel = relFor(rng, refType);
      const pronoun = lastSingle?.type === refType && rng.chance(0.4);
      at = { relation: rel, ref: { added_in_op: idx } };
      posText = relText(rng, rel, pronoun ? 'it' : theT(refType), refType);
    } else if (r < 0.45 && sceneRefs.length) {
      const refType = rng.pick(sceneRefs);
      const rel = relFor(rng, refType);
      at = { relation: rel, ref: ofType(input, refType)[0].id };
      posText = relText(rng, rel, theT(refType), refType);
    } else {
      const spot = freshSpot(); usedSpots.add(spot);
      at = spot; posText = groupWith || count > 1 ? rng.pick(SPOT_ADD[spot]) : spotText(rng, spot, type);
    }
    const nounText = groupWith ? `${noun(rng, { type, ...f })} and ${noun(rng, { type: groupWith })}` : noun(rng, { type, ...f }, count);
    const lead = clauses.length === 0 ? rng.pick(['draw', 'add', 'put', '']) : rng.pick(['', '', 'and', 'then', 'then put', 'and put', 'plus']);
    clauses.push(join(lead, nounText, posText));
    for (let i = 0; i < count; i++) ops.push(addOp(type, f, at));
    if (count === 1) { addedOnce.set(type, ops.length - 1); lastSingle = { type, idx: ops.length - 1 }; } else lastSingle = null;
    if (groupWith) { ops.push(addOp(groupWith, {}, at)); addedOnce.set(groupWith, ops.length - 1); lastSingle = null; }
  }
  if (ops.length < 3) return null;
  // the last clause gets "and" if it has no connector yet
  const last = clauses.length - 1;
  if (last > 0 && !/^(and|then|plus)\b/.test(clauses[last])) clauses[last] = `and ${clauses[last]}`;
  return intent('multi_place', `multi_place_${ops.length}`, input, clauses.join(' '), ops);
};

// ---------- references ----------
function spread(objs: SceneObject[], key: 'x' | 'y', lo: number, hi: number, rng: Rng) {
  const n = objs.length;
  const step = (hi - lo) / Math.max(1, n - 1);
  const vals = rng.shuffle(Array.from({ length: n }, (_, i) => Math.round((lo + i * step) * 100) / 100));
  objs.forEach((o, i) => { o[key] = vals[i]; });
}

const references: Record<string, [number, Gen]> = {
  spatial: [6, rng => {
    const type = rng.pick(TYPES);
    const n = rng.int(2, 3);
    const input = sampleScene(rng, { min: n, require: { [type]: n } });
    const objs = ofType(input, type);
    const axis = rng.pick(['x', 'x', 'y'] as const);
    // ids deliberately out of spatial order, so "the left tree" can't be guessed from "_1" (like v2 148)
    const idNum = (o: SceneObject) => Number(o.id.split('_')[1]);
    const byId = [...objs].sort((a, b) => idNum(a) - idNum(b)).map(o => o.id).join();
    let sorted: SceneObject[] = [];
    for (let tries = 0; tries < 20; tries++) {
      spread(objs, axis, 0.15, axis === 'x' ? 0.85 : (type === 'sun' || type === 'cloud' ? 0.4 : 0.9), rng);
      sorted = [...objs].sort((a, b) => a[axis] - b[axis]);
      if (sorted.map(o => o.id).join() !== byId) break;
    }
    if (sorted.map(o => o.id).join() === byId) return null;
    let target: SceneObject; let sel: string;
    if (axis === 'x' && n === 3 && rng.chance(0.5)) { target = sorted[1]; sel = `the middle ${type}`; }
    else {
      const low = rng.chance(0.5);
      target = low ? sorted[0] : sorted[n - 1];
      sel = axis === 'x'
        ? (n === 2 ? rng.pick([`the ${low ? 'left' : 'right'} ${type}`, `the ${type} on the ${low ? 'left' : 'right'}`]) : rng.pick([`the ${low ? 'leftmost' : 'rightmost'} ${type}`, `the ${type} on the far ${low ? 'left' : 'right'}`]))
        : (n === 2 ? `the ${low ? 'top' : 'bottom'} ${type}` : `the ${low ? 'highest' : 'lowest'} ${type}`);
    }
    const c = editClause(rng, input, target, sel);
    return intent('references', 'ref_spatial', input, c.text, [c.op]);
  }],
  size: [2, rng => {
    const type = rng.pick(TYPES);
    const n = rng.int(2, 3);
    const input = sampleScene(rng, { min: n, require: { [type]: n } });
    const objs = ofType(input, type);
    rng.sample([0.6, 1, 1.5, 2], n).forEach((s, i) => { objs[i].scale = s; });
    const big = rng.chance(0.5);
    const target = [...objs].sort((a, b) => (big ? b.scale - a.scale : a.scale - b.scale))[0];
    const sel = n === 2 ? `the ${big ? rng.pick(['bigger', 'larger']) : 'smaller'} ${type}` : `the ${big ? rng.pick(['biggest', 'largest']) : 'smallest'} ${type}`;
    const c = editClause(rng, input, target, sel);
    return intent('references', 'ref_size', input, c.text, [c.op]);
  }],
  color: [2, rng => {
    const type = rng.pick(TYPES);
    const n = rng.int(2, 3);
    const input = sampleScene(rng, { min: n, require: { [type]: n } });
    const objs = ofType(input, type);
    rng.sample(COLORS, n).forEach((c, i) => { objs[i].color = c; });
    const target = rng.pick(objs);
    const c = editClause(rng, input, target, rng.chance(0.8) ? `the ${target.color} ${type}` : `the ${type} that is ${target.color}`);
    return intent('references', 'ref_color', input, c.text, [c.op]);
  }],
  nearest: [2, rng => { // "the tree next to the house": nearest by distance, only used with a clear gap
    const [type, anchorType] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 3, require: { [type]: 2, [anchorType]: 1 } });
    const anchor = ofType(input, anchorType)[0];
    const [near, far] = ofType(input, type);
    near.x = Math.round(Math.min(0.9, Math.max(0.1, anchor.x + (anchor.x < 0.5 ? 0.12 : -0.12))) * 100) / 100;
    near.y = anchor.y;
    far.x = anchor.x < 0.5 ? 0.88 : 0.12;
    if (rng.chance(0.5)) { // anchored: "make the cat green and the tree next to it yellow"
      const c1 = otherColor(rng, anchor.color), c2 = otherColor(rng, near.color);
      return intent('references', 'ref_nearest_anchored', input, `make the ${anchorType} ${c1} and the ${type} ${rng.pick(['next to it', 'beside it', 'near it'])} ${c2}`,
        [{ op: 'recolor', target: anchor.id, color: c1 }, { op: 'recolor', target: near.id, color: c2 }]);
    }
    const c = editClause(rng, input, near, `the ${type} ${rng.pick(['next to', 'beside', 'near', 'by'])} the ${anchorType}`, rng.pick(['recolor', 'scale', 'delete']));
    return intent('references', 'ref_nearest', input, c.text, [c.op]);
  }],
  other: [2, rng => { // V2-R11
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 2, require: { [type]: 2 }, focus: type });
    const target = ofType(input, type).find(o => o.id !== input.focus_id)!;
    const c = editClause(rng, input, target, `the other ${type}`);
    return intent('references', 'ref_other', input, c.text, [c.op]);
  }],
  noun_vs_focus: [2, rng => { // V2-R12: an explicit noun beats focus
    const [focusType, type] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 2, require: { [type]: 1, [focusType]: rng.int(1, 2) }, focus: focusType });
    const c = editClause(rng, input, ofType(input, type)[0], theT(type));
    return intent('references', 'ref_noun_vs_focus', input, c.text, [c.op]);
  }],
  focus_disambig: [2, rng => { // rule 5: focus disambiguates "the house" when the focused object is a house
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 2, require: { [type]: rng.int(2, 3) }, focus: type });
    const c = editClause(rng, input, input.scene.objects.find(o => o.id === input.focus_id)!, theT(type));
    return intent('references', 'ref_focus_disambig', input, c.text, [c.op]);
  }],
  focus_disambig_rel: [2, rng => { // "put a cat on the house" with two houses and focus on one (v1 focus_023 pattern)
    const refType = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 2, require: { [refType]: rng.int(2, 3) }, focus: refType });
    const type = rng.pick(TYPES);
    const rel = relFor(rng, refType);
    return intent('references', 'ref_focus_disambig_rel', input, join(rng.pick(['', 'put', 'draw', 'add']), noun(rng, { type }), relText(rng, rel, theT(refType), refType)),
      [addOp(type, {}, { relation: rel, ref: input.focus_id! })]);
  }],
  pronoun_focus: [3, rng => {
    const input = sampleScene(rng, { min: 1 });
    const focus = rng.pick(input.scene.objects);
    input.focus_id = focus.id;
    if (rng.chance(0.3)) { // "put a sun above that"
      const type = rng.pick(TYPES);
      const rel = relFor(rng, focus.type);
      const f = addFields(rng, 0.2, 0.1);
      return intent('references', 'ref_pronoun_add', input, join(rng.pick(['put', 'draw', 'add']), noun(rng, { type, ...f }), relText(rng, rel, rng.pick(['it', 'that']), focus.type)),
        [addOp(type, f, { relation: rel, ref: focus.id })]);
    }
    const c = editClause(rng, input, focus, rng.pick(['it', 'it', 'that']));
    return intent('references', 'ref_pronoun', input, c.text, [c.op]);
  }],
  relative_color: [1, rng => { // V2-R10: "same color as" uses the referent's current color
    const [a, b] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 2, require: { [a]: 1, [b]: 1 } });
    const A = ofType(input, a)[0], B = ofType(input, b)[0];
    if (A.color === B.color) B.color = otherColor(rng, A.color);
    return intent('references', 'ref_relative_color', input, rng.pick([`make the ${a} the same color as the ${b}`, `color the ${a} the same as the ${b}`, `make the ${a} match the ${b}`]),
      [{ op: 'recolor', target: A.id, color: B.color }]);
  }],
  negation: [1, rng => { // V2-R18: "not the cat the tree make it blue"
    const [a, b] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 2, require: { [a]: 1, [b]: 1 } });
    if (rng.chance(0.5)) input.focus_id = ofType(input, a)[0].id;
    const B = ofType(input, b)[0];
    const c = editClause(rng, input, B, 'it', rng.pick(['recolor', 'scale', 'delete']));
    return intent('references', 'ref_negation', input, `${rng.pick(['not', 'no not'])} the ${a} the ${b} ${c.text}`, [c.op]);
  }],
  except: [1, rng => { // V2-R19: one delete per other object, in scene order
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 3, require: { [type]: 1 } });
    const others = input.scene.objects.filter(o => o.type !== type);
    if (!others.length) return null;
    return intent('references', 'ref_except', input, `${rng.pick(['delete', 'remove', 'erase', 'get rid of'])} everything ${rng.pick(['except', 'but'])} the ${type}`,
      others.map(o => ({ op: 'delete', target: o.id }) as Op));
  }],
};

// ---------- should-return-[] ----------
const emptyGens: Record<string, [number, Gen]> = {
  unsupported_object: [5, rng => {
    const input = sampleScene(rng);
    const thing = rng.pick(UNSUPPORTED_NOUNS);
    const mode = rng.weighted({ alone: 1, mixed: 2, extra: 3 });
    if (mode === 'alone') return empty('unsupported_alone', input, join(addVerb(rng, false), `${art(thing)} ${thing}`, rng.chance(0.3) && rng.pick(SPOT_ADD[rng.pick(SPOTS_LIST)])), 'unsupported_object');
    const type = rng.pick(TYPES);
    if (mode === 'mixed') {
      const sup = noun(rng, { type, ...addFields(rng, 0.2, 0.1) });
      const bad = `${art(thing)} ${thing}`;
      const [first, second] = rng.chance(0.5) ? [sup, bad] : [bad, sup];
      return empty('unsupported_mixed', input, join(addVerb(rng, false), first, 'and', second), 'unsupported_object');
    }
    // V2-R8: "a tree with apples" asks for the extra too, and the extra is unsupported
    return empty('unsupported_extra', input, join(addVerb(rng, false), noun(rng, { type, ...addFields(rng, 0.2, 0.1) }), rng.pick(EXTRAS[type])), 'unsupported_object');
  }],
  unsupported_in_batch: [4, rng => { // V2-R6 atomic: one unsupported clause in the middle or at the end of a long batch rejects it all
    const input = sampleScene(rng, { min: 2 });
    const targets = rng.shuffle(uniqueTypes(input));
    const thing = rng.pick(UNSUPPORTED_NOUNS);
    const clauses: string[] = [];
    const ok: Op[] = [];
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const t = targets.shift();
      if (t && rng.chance(0.6)) { const c = editClause(rng, input, ofType(input, t)[0], theT(t), rng.pick(['recolor', 'move', 'scale'])); clauses.push(c.text); ok.push(c.op); }
      else { const type = rng.pick(TYPES); const spot = rng.pick(SPOTS_LIST); clauses.push(join(rng.pick(['draw', 'add', 'put']), noun(rng, { type }), rng.pick(SPOT_ADD[spot]))); ok.push(addOp(type, {}, spot)); }
    }
    const ref = uniqueTypes(input)[0];
    const bad = rng.pick([
      `move the ${thing} ${rng.pick(SPOT_MOVE[rng.pick(SPOTS_LIST)])}`, `make the ${thing} ${rng.pick(COLORS)}`, `delete the ${thing}`,
      `draw ${art(thing)} ${thing}`, `add ${art(thing)} ${thing} ${rng.pick(SPOT_ADD[rng.pick(SPOTS_LIST)])}`,
      ...(ref ? [`put ${art(thing)} ${thing} ${rng.pick(['next to', 'in', 'above', 'under'])} the ${ref}`] : []),
    ]);
    clauses.splice(rng.chance(0.5) ? clauses.length : rng.int(1, clauses.length - 1), 0, bad);
    const text = clauses.map((c, i) => (i === 0 ? c : `${rng.pick(['', 'and', 'then', 'and then'])} ${c}`.trim())).join(' ');
    return empty('unsupported_in_batch', input, text, 'unsupported_object', ok);
  }],
  missing_ref: [4, rng => {
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { forbid: [type] });
    const movable = uniqueTypes(input);
    if (movable.length && rng.chance(0.3)) { // "put the cat on the house" with no house (v1 edit_039/040 pattern)
      const Z = ofType(input, rng.pick(movable))[0];
      const rel = relFor(rng, type);
      return empty('missing_move_rel', input, `${rng.pick(['move', 'put'])} the ${Z.type} ${relText(rng, rel, theT(type), type)}`, 'missing_ref',
        [{ op: 'move', target: Z.id, to: { relation: rel, ref: { type } } }]);
    }
    if (rng.chance(0.4)) { // add relative to a missing object
      const newType = rng.pick(TYPES);
      const rel = relFor(rng, type);
      return empty('missing_rel', input, join(rng.pick(['put', 'draw', 'add']), noun(rng, { type: newType }), relText(rng, rel, theT(type), type)), 'missing_ref',
        [addOp(newType, {}, { relation: rel, ref: { type } })]);
    }
    const ghost: SceneObject = { id: `${type}_1`, type, color: 'red', x: 0.5, y: 0.5, scale: 1 };
    const c = editClause(rng, input, ghost, theT(type));
    return empty('missing_edit', input, c.text, 'missing_ref', [{ ...c.op, target: { type } } as Op]);
  }],
  deleted_ref: [4, rng => { // "delete the cat and put a tree next to the cat"
    const [type, other] = rng.sample(TYPES, 2);
    const input = sampleScene(rng, { min: 2, require: { [type]: 1, [other]: 1 } });
    const X = ofType(input, type)[0];
    const del = `${rng.pick(['delete', 'remove', 'erase', 'get rid of'])} the ${type}`;
    const mode = rng.weighted({ add: 2, edit: 2, move: 1 });
    let second: string; let op: Op;
    if (mode === 'add') { const rel = relFor(rng, type); second = join(rng.pick(['put', 'draw', 'add']), noun(rng, { type: other }), relText(rng, rel, theT(type), type)); op = addOp(other, {}, { relation: rel, ref: X.id }); }
    else if (mode === 'edit') { const c = editClause(rng, input, X, theT(type), rng.pick(['recolor', 'scale'])); second = c.text; op = c.op; }
    else { const rel = relFor(rng, type); const O = ofType(input, other)[0]; second = `move the ${other} ${relText(rng, rel, theT(type), type)}`; op = { op: 'move', target: O.id, to: { relation: rel, ref: X.id } }; }
    return empty('deleted_ref', input, `${del} ${rng.pick(['and', 'then', 'and then'])} ${second}`, 'deleted_ref', [{ op: 'delete', target: X.id }, op]);
  }],
  ambiguous_ref: [4, rng => {
    const type = rng.pick(TYPES);
    const others = TYPES.filter(t => t !== type);
    const focusType = rng.chance(0.5) ? rng.pick(others) : undefined;
    const input = sampleScene(rng, { min: 2, require: { [type]: rng.int(2, 3), ...(focusType && { [focusType]: 1 }) }, focus: focusType ?? 'none' });
    if (rng.chance(0.3)) { // "put a cat on the house" with two houses and no focus on either
      const newType = rng.pick(TYPES);
      const rel = relFor(rng, type);
      return empty('ambiguous_rel', input, join(rng.pick(['put', 'draw', 'add']), noun(rng, { type: newType }), relText(rng, rel, theT(type), type)), 'ambiguous_ref',
        [addOp(newType, {}, { relation: rel, ref: { type } })]);
    }
    const c = editClause(rng, input, ofType(input, type)[0], theT(type));
    return empty('ambiguous_edit', input, c.text, 'ambiguous_ref', [{ ...c.op, target: { type } } as Op]);
  }],
  no_focus: [4, rng => { // pronoun with no focus and no anchor in the utterance
    const input = sampleScene(rng, { min: 1, focus: 'none' });
    if (rng.chance(0.35)) {
      const type = rng.pick(TYPES);
      const rel = relFor(rng, 'house');
      return empty('no_focus_add', input, join(rng.pick(['put', 'draw', 'add']), noun(rng, { type }), `${rng.pick(REL_WORDS[rel])} ${rng.pick(['it', 'that'])}`), 'no_focus');
    }
    const c = editClause(rng, input, rng.pick(input.scene.objects), rng.pick(['it', 'that']));
    return empty('no_focus_edit', input, c.text, 'no_focus');
  }],
  unsupported_color: [3, rng => { // V2-R15
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { min: 1, require: { [type]: 1 } });
    const bad = rng.pick(UNSUPPORTED_COLORS);
    const mode = rng.weighted({ recolor: 3, add: 2, negation: 1 });
    if (mode === 'recolor') return empty('bad_color_recolor', input, rng.pick([`make the ${type} ${bad}`, `paint the ${type} ${bad}`, `turn the ${type} ${bad}`, `color the ${type} ${bad}`]), 'unsupported_color');
    if (mode === 'add') return empty('bad_color_add', input, join(addVerb(rng, false), `${art(bad)} ${bad} ${type}`), 'unsupported_color');
    return empty('bad_color_negation', input, rng.pick([`make the ${type} not ${rng.pick(COLORS)}`, `the ${type} should not be ${rng.pick(COLORS)}`]), 'unsupported_color');
  }],
  chatter: [3, rng => empty('chatter', sampleScene(rng), `${rng.pick(CHATTER_OPEN)}${rng.pick(CHATTER_BODY)}`.trim(), 'chatter')],
  undo_no_history: [2, rng => empty('undo_no_history', sampleScene(rng, { history: 0 }), rng.pick(UNDO_PHRASES), 'undo_no_history', [{ op: 'undo' }])],
  undo_clear_combo: [2, rng => { // V2-R16
    const type = rng.pick(TYPES);
    const input = sampleScene(rng, { minHistory: 2 });
    const add = noun(rng, { type });
    const mode = rng.weighted({ multi_undo: 2, undo_plus: 1, clear_plus: 2 });
    if (mode === 'multi_undo') return empty('multi_undo', input, rng.pick(['undo twice', 'undo two times', 'undo the last three things', 'go back two steps', 'undo three times', 'undo the last couple of things']), 'undo_clear_combo', [{ op: 'undo' }, { op: 'undo' }]);
    if (mode === 'undo_plus') return empty('undo_plus', input, `${rng.pick(['undo that', 'undo'])} and ${rng.pick(['then', ''])} draw ${add}`.replace(/\s+/g, ' '), 'undo_clear_combo', [{ op: 'undo' }, addOp(type, {})]);
    return empty('clear_plus', input, `${rng.pick(['clear', 'clear', 'clear everything', 'clear the canvas', 'start over', 'wipe it'])} ${rng.pick(['and', 'then', 'and then'])} ${rng.pick(['draw', 'add', 'put'])} ${add}`, 'undo_clear_combo', [{ op: 'clear' }, addOp(type, {})]);
  }],
};

// ---------- indirect ----------
const indirect: Gen = rng => {
  const input = sampleScene(rng);
  if (rng.chance(0.4)) {
    const v = rng.pick(INDIRECT_VAGUE);
    return empty('indirect_vague', input, join(rng.pick(['draw', 'add', 'make', 'can you draw', '']), v, rng.chance(0.25) && rng.pick(SPOT_ADD[rng.pick(SPOTS_LIST)])), 'vague_description', undefined, 'indirect');
  }
  const type = rng.pick(TYPES);
  const d = rng.pick(INDIRECT_CLEAR[type]);
  const f: { color?: Color } = rng.chance(0.15) ? { color: rng.pick(COLORS) } : {};
  const inSky = SKY_RE.test(d); // "a puffy shape that floats in the sky" already says where: top (V2-R5)
  const spot: Spot | undefined = inSky ? 'top' : rng.chance(0.3) ? rng.pick(SPOTS_LIST) : undefined;
  const text = join(spot && !inSky ? rng.pick(['put', 'draw', 'add']) : rng.pick(['draw', 'add', 'can you draw', 'i want', '']), d, spot && !inSky && spotText(rng, spot, type), f.color && `and make it ${f.color}`);
  return intent('indirect', 'indirect_clear', input, text, [addOp(type, f, spot)]);
};

function weightedGen(rng: Rng, table: Record<string, [number, Gen]>): Intent | null {
  const key = rng.weighted(Object.fromEntries(Object.entries(table).map(([k, [w]]) => [k, w])));
  return table[key][1](rng);
}

/** Samples one intent of a category (null when the sampled scene can't support it; the caller retries). */
export function sampleIntent(rng: Rng, category: Category): Intent | null {
  switch (category) {
    case 'simple': return weightedGen(rng, simple);
    case 'multi_place': return multiPlace(rng);
    case 'references': return weightedGen(rng, references);
    case 'empty': return weightedGen(rng, emptyGens);
    case 'indirect': return indirect(rng);
    case 'messy': { // a positive base intent; generator.ts forces the noise layer on it
      const base = rng.chance(0.6) ? weightedGen(rng, simple) : rng.chance(0.5) ? weightedGen(rng, references) : multiPlace(rng);
      return base && { ...base, category: 'messy', subtype: `messy/${base.subtype}` };
    }
  }
}
