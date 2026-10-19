// Deterministic rule-based baseline. Any word outside its vocabulary, or any reference it cannot resolve, gives [].
import { COLORS, RELATIONS, SPOTS, TYPES, type Color, type ObjectType, type Pos, type Ref, type Relation, type Spot } from '../../src/scene/engine.ts';
import type { MapperInput, SceneMapper, SceneOperation } from '../types.ts';

// Multi-word phrases rewritten to single tokens. Order matters (longer phrases first).
const PHRASES: [RegExp, string][] = [
  [/\b(start over|(clear|erase|delete) (everything|it all|all|the (canvas|screen|picture)))\b/g, 'clear'],
  [/\bget rid of\b|\bremove\b|\berase\b/g, 'delete'],
  [/\btwice as (big|large)\b|\bdouble the size\b/g, 'x2'],
  [/\bhalf (the|its) size\b|\bhalf as (big|large)\b/g, 'x0.5'],
  [/\b(to the )?left of\b/g, 'left_of'],
  [/\b(to the )?right of\b/g, 'right_of'],
  [/\b(next to|beside|near|by)\b/g, 'near'],
  [/\b(under|underneath|beneath|below)\b/g, 'below'],
  [/\b(above|over)\b/g, 'above'],
  [/\bon top of\b/g, 'on'],
  [/\bon the roof\b/g, 'on_roof'],
  [/\bon top\b/g, 'on_top'],
  [/\b(in the )?(middle|centre|center)\b/g, 'center'],
  [/\b(top|upper) (left|right)( corner)?\b/g, 'top-$2'],
  [/\b(bottom|lower) (left|right)( corner)?\b/g, 'bottom-$2'],
  [/\bon the ((top-|bottom-)?(left|right)|top|bottom)\b/g, '$1'], // "on the left" is a spot, not the "on" relation
  [/\b(large|huge)\b/g, 'big'],
  [/\b(little|tiny)\b/g, 'small'],
  [/\blarger\b/g, 'bigger'],
  [/\bgrey\b/g, 'gray'],
];
const VERBS: Record<string, Verb> = { draw: 'add', add: 'add', place: 'add', put: 'put', make: 'make', move: 'move', delete: 'delete' };
const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
const FILLER = ['the', 'to', 'in', 'at', 'please', 'and', 'with', 'it', 'that', 'undo', 'clear', 'side', 'corner', 'on_top', 'on_roof'];
const SIZES: Record<string, number> = { big: 1.5, small: 0.6 };
const FACTORS: Record<string, number> = { bigger: 1.3, smaller: 0.75, x2: 2, 'x0.5': 0.5 };
const VOCAB = new Set([
  ...Object.keys(VERBS), ...Object.keys(COUNTS), ...FILLER, ...Object.keys(SIZES), ...Object.keys(FACTORS),
  ...TYPES, ...TYPES.map(t => t + 's'), ...COLORS, ...SPOTS, ...RELATIONS,
]);

type Verb = 'add' | 'put' | 'make' | 'move' | 'delete';
interface Clause {
  verb?: Verb;
  count: number;
  the: boolean;         // "the X" refers to an existing object
  type?: ObjectType;
  pronoun: boolean;
  color?: Color;
  size?: number;
  factor?: number;
  spot?: Spot;
  relation?: Relation;
  ref?: { type?: ObjectType; pronoun?: boolean; onTop?: boolean };
}

class Reject extends Error {}

const singular = (w: string) => (TYPES as readonly string[]).includes(w.replace(/s$/, '')) ? w.replace(/s$/, '') as ObjectType : undefined;

export function normalize(utterance: string): string[] {
  // Self-correction: keep only what follows the last "no" / "actually" / "i mean".
  const parts = utterance.toLowerCase().split(/(?:,|^|\s)\s*(?:no|actually|i mean|wait|sorry)\b\s*,?/);
  let text = parts.at(-1)!.replace(/[^a-z0-9.\s-]/g, ' ');
  for (const [re, to] of PHRASES) text = text.replace(re, to);
  return text.split(/\s+/).filter(Boolean).map(t => t.replace(/\.$/, ''));
}

function parseClause(tokens: string[]): Clause {
  const c: Clause = { count: 1, the: false, pronoun: false };
  let inRef = false;
  for (const [i, t] of tokens.entries()) {
    if (t in VERBS) c.verb = VERBS[t];
    else if (t in COUNTS) c.count = COUNTS[t];
    else if (t === 'the') { if (!inRef && singular(tokens[i + 1] ?? '')) c.the = true; }
    else if (t === 'it' || t === 'that') { if (inRef) c.ref = { pronoun: true }; else c.pronoun = true; }
    else if (singular(t)) { if (inRef) c.ref = { type: singular(t) }; else c.type = singular(t); }
    else if ((COLORS as readonly string[]).includes(t)) c.color = t as Color;
    else if (t in SIZES) c.size = SIZES[t];
    else if (t in FACTORS) c.factor = FACTORS[t];
    else if ((SPOTS as readonly string[]).includes(t)) c.spot = t as Spot;
    else if ((RELATIONS as readonly string[]).includes(t)) { c.relation = t as Relation; inRef = true; }
    else if (t === 'on_top' || t === 'on_roof') { c.relation = 'on'; c.ref = t === 'on_top' ? { onTop: true } : { type: 'house' }; }
  }
  return c;
}

export function keywordOps({ utterance, scene, focus_id, history_len }: MapperInput): SceneOperation[] {
  const tokens = normalize(utterance);
  if (tokens.length === 0 || tokens.some(t => !VOCAB.has(t))) return [];
  if (tokens.includes('undo')) return history_len > 0 && tokens.every(t => ['undo', 'that', 'it', 'please'].includes(t)) ? [{ op: 'undo' }] : [];
  if (tokens.includes('clear')) return tokens.every(t => ['clear', 'please'].includes(t)) ? [{ op: 'clear' }] : [];

  const clauses: Clause[] = [];
  let current: string[] = [];
  for (const t of [...tokens, 'and']) {
    if (t === 'and' || t === 'with') { if (current.length) clauses.push(parseClause(current)); current = []; }
    else current.push(t);
  }
  // "a sun and a cloud at the top": a trailing named spot applies to every add.
  const last = clauses.at(-1);
  if (last?.spot && clauses.every(c => !c.the && !c.pronoun && !c.relation && (c === last || !c.spot))) clauses.forEach(c => (c.spot = last.spot));

  const ops: SceneOperation[] = [];
  let lastRef: Ref | null = null; // most recently mentioned object in this utterance
  const findThe = (type: ObjectType): string => {
    const matches = scene.objects.filter(o => o.type === type);
    if (matches.length === 1) return matches[0].id;
    const focused = matches.find(o => o.id === focus_id);
    if (focused) return focused.id;
    throw new Reject();
  };
  const pronoun = (): Ref => { const r = lastRef ?? focus_id; if (r === null) throw new Reject(); return r; };
  const subject = (c: Clause): string => {
    const r = c.pronoun ? pronoun() : c.the && c.type ? findThe(c.type) : null;
    if (typeof r !== 'string') throw new Reject(); // targets must be existing scene ids
    return r;
  };
  const place = (c: Clause): Pos | undefined => {
    if (!c.relation) return c.spot;
    const r = c.ref;
    if (!r) throw new Reject();
    const ref = r.onTop ? lastRef ?? findThe('house') : r.pronoun ? pronoun() : findThe(r.type!);
    return { relation: c.relation, ref };
  };

  try {
    let verb: Verb | undefined;
    for (const c of clauses) {
      verb = c.verb ?? verb;
      const existing = c.the || c.pronoun;
      if (verb === 'delete') {
        const target = subject(c);
        ops.push({ op: 'delete', target });
        lastRef = target;
      } else if (verb === 'make') {
        const target = subject(c);
        if (c.color === undefined && c.factor === undefined) throw new Reject();
        if (c.color) ops.push({ op: 'recolor', target, color: c.color });
        if (c.factor) ops.push({ op: 'scale', target, factor: c.factor });
        lastRef = target;
      } else if (verb === 'move' || (verb === 'put' && existing)) {
        const target = subject(c);
        const to = place(c);
        if (!to) throw new Reject();
        ops.push({ op: 'move', target, to });
        lastRef = target;
      } else {
        if (!c.type || existing || c.factor) throw new Reject();
        const at = place(c);
        for (let i = 0; i < c.count; i++) {
          ops.push({
            op: 'add', type: c.type,
            ...(c.color && { color: c.color }), ...(at && { at }), ...(c.size !== undefined && { scale: c.size }),
          });
        }
        lastRef = { added_in_op: ops.length - 1 };
      }
    }
  } catch (e) {
    if (e instanceof Reject) return [];
    throw e;
  }
  return ops;
}

export class KeywordMapper implements SceneMapper {
  name = 'keyword';
  async predict(input: MapperInput) {
    const ops = keywordOps(input);
    return { raw: JSON.stringify(ops), ops };
  }
}
