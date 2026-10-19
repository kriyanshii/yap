// Usage: npx tsx eval/compare-runs.ts
// Re-scores saved result files against the current benchmark files and prints the RESULTS.md tables (markdown).
// Qwen rows are scored twice from the same model outputs: raw (no guard) and guarded (eval/mappers/qwen.ts guardOps).
import { readFileSync } from 'node:fs';
import { guardOps } from './mappers/qwen.ts';
import { scoreCase } from './scorer.ts';
import type { EvalCase } from './types.ts';

const RUNS: Record<'v1' | 'v2', Record<string, string>> = {
  v2: {
    keyword: 'keyword-v2-2026-10-19T15-47-24-513Z',
    gemini: 'gemini-v2-2026-10-19T08-12-44-998Z',
    'qwen run 1': 'qwen-v2-2026-10-19T15-21-46-358Z',
    'qwen run 2': 'qwen-v2-2026-10-19T16-50-21-503Z',
  },
  v1: {
    keyword: 'keyword-v1-2026-10-19T15-47-23-862Z',
    gemini: 'gemini-2026-10-19T07-35-44-533Z',
    'qwen run 1': 'qwen-v1-2026-10-19T15-23-07-753Z',
    'qwen run 2': 'qwen-v1-2026-10-19T16-51-19-579Z',
  },
};
const BENCH_FILE = { v1: 'yap-eval-v1.jsonl', v2: 'yap-eval-v2-hard.jsonl' };
const root = new URL('../', import.meta.url);
const load = (f: string) => readFileSync(new URL(f, root), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

type Mode = 'as-is' | 'raw' | 'guard';
function score(bench: 'v1' | 'v2', file: string, mode: Mode) {
  const cases = new Map<string, EvalCase>(load(BENCH_FILE[bench]).map(c => [c.id, c]));
  // Results recorded before a case was removed from the benchmark (v2 asr_errors_117) are skipped.
  return load(`results/${file}.jsonl`).filter(r => cases.has(r.id)).map(r => {
    const c = cases.get(r.id)!;
    let ops = r.ops;
    if (mode !== 'as-is') { try { const p = JSON.parse(r.raw); ops = Array.isArray(p) ? (mode === 'guard' ? guardOps(p, c.input) : p) : null; } catch { ops = null; } }
    return { category: c.category, policy: c.policy, ...scoreCase(c, { raw: r.raw, ops }, r.scores.latency_ms) };
  });
}
type Row = ReturnType<typeof score>[number];
const pct = (rows: Row[]) => (rows.length ? `${Math.round((100 * rows.filter(r => r.scores.exact_match).length) / rows.length)}%` : '-');
const refusals = (rows: Row[]) => { const n = rows.filter(r => r.scores.noop_correct !== null); return `${n.filter(r => r.scores.noop_correct).length}/${n.length}`; };
const p50 = (rows: Row[]) => { const l = rows.map(r => r.scores.latency_ms).sort((a, b) => a - b); return l[l.length >> 1]; };

for (const bench of ['v2', 'v1'] as const) {
  const cols: [string, Row[]][] = [];
  for (const [name, file] of Object.entries(RUNS[bench])) {
    if (name.startsWith('qwen')) { cols.push([`${name} raw`, score(bench, file, 'raw')], [`${name} guarded`, score(bench, file, 'guard')]); }
    else cols.push([name, score(bench, file, 'as-is')]);
  }
  const base = cols[0][1];
  console.log(`\n### ${bench} (${base.length} cases), exact match\n`);
  console.log(`| group | n | ${cols.map(([n]) => n).join(' | ')} |`);
  console.log(`|---|---|${cols.map(() => '---').join('|')}|`);
  const groups: [string, (r: Row) => boolean][] = [
    ['**overall**', () => true],
    ...[...new Set(base.map(r => r.category))].map(c => [c, (r: Row) => r.category === c] as [string, (r: Row) => boolean]),
    ['strict', r => r.policy === 'strict'], ['inferred', r => r.policy === 'inferred'],
  ];
  for (const [label, pred] of groups) console.log(`| ${label} | ${base.filter(pred).length} | ${cols.map(([, rows]) => pct(rows.filter(pred))).join(' | ')} |`);
  console.log(`| correct refusals | ${base.filter(r => r.scores.noop_correct !== null).length} | ${cols.map(([, rows]) => refusals(rows)).join(' | ')} |`);
  console.log(`| p50 latency (ms) | | ${cols.map(([, rows]) => p50(rows)).join(' | ')} |`);
}
