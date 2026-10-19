// Seeded PRNG (mulberry32) so `npm run gen:data -- --seed N` is reproducible. Never use Math.random in train/data.
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T {
    if (!arr.length) throw new Error('pick from empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  sample<T>(arr: readonly T[], k: number): T[] { return this.shuffle(arr).slice(0, k); }
  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    let r = this.next() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) if ((r -= w) < 0) return k;
    return entries[entries.length - 1][0];
  }
}
