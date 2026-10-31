// Geometry checks shared by the canvas report and the scenic-scene test.
import type { SceneObject } from '../src/scene/engine.ts';

export type Rel = 'on' | 'under' | 'above' | 'next_to' | 'left_of' | 'right_of';
export type Spot = 'left' | 'right' | 'top';
export interface Expect {
  objects: { type: string; color?: string; count?: number; size?: 'big' | 'small' }[];
  relations?: ([string, Rel, string] | [string, Rel, string, 'all' | 'some'])[];
  spots?: [string, Spot][];
}

function holds(rel: Rel, a: SceneObject, b: SceneObject): boolean {
  switch (rel) {
    case 'on': return a.y < b.y && Math.abs(a.x - b.x) <= 0.15;
    case 'above': return a.y < b.y - 0.05;
    case 'under': return a.y > b.y + 0.05;
    case 'next_to': return Math.abs(a.x - b.x) <= 0.3 && Math.abs(a.y - b.y) <= 0.25;
    case 'left_of': return a.x < b.x - 0.05;
    case 'right_of': return a.x > b.x + 0.05;
  }
}

/** Problems with the final canvas, or [] if it shows the scene. */
export function check(objects: SceneObject[], e: Expect): string[] {
  const problems: string[] = [];
  const of = (t: string) => objects.filter((o) => o.type === t);
  for (const want of e.objects) {
    const got = of(want.type);
    const n = want.count ?? 1;
    if (got.length !== n) problems.push(`${n} ${want.type}${n > 1 ? 's' : ''} expected, canvas has ${got.length}`);
    if (want.color && got.length && !got.some((o) => o.color === want.color)) problems.push(`no ${want.color} ${want.type} (got ${[...new Set(got.map((o) => o.color))].join(', ')})`);
    if (want.size === 'big' && got.length && !got.some((o) => o.scale >= 1.3)) problems.push(`${want.type} isn't big`);
    if (want.size === 'small' && got.length && !got.some((o) => o.scale <= 0.75)) problems.push(`${want.type} isn't small`);
  }
  const wanted = new Set(e.objects.map((o) => o.type));
  for (const o of objects) if (!wanted.has(o.type)) problems.push(`extra ${o.color} ${o.type}`);
  for (const [ta, rel, tb, mode = 'all'] of (e.relations ?? []) as [string, Rel, string, ('all' | 'some')?][]) {
    const as = of(ta), bs = of(tb);
    if (!as.length || !bs.length) continue;
    const ok = (a: SceneObject) => bs.some((b) => b !== a && holds(rel, a, b));
    if (mode === 'all' ? !as.every(ok) : !as.some(ok)) problems.push(`${ta} isn't ${rel.replace('_', ' ')} the ${tb}`);
  }
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const [a, b] = [objects[i], objects[j]];
    if (Math.abs(a.x - b.x) < 0.08 && Math.abs(a.y - b.y) < 0.08) problems.push(`${a.type} and ${b.type} are drawn on top of each other`);
  }
  for (const [t, spot] of e.spots ?? []) {
    const ok = of(t).some((o) => (spot === 'left' ? o.x < 0.4 : spot === 'right' ? o.x > 0.6 : o.y < 0.35));
    if (of(t).length && !ok) problems.push(`${t} isn't at the ${spot}`);
  }
  return problems;
}
