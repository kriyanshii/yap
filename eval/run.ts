// Usage: npm run eval -- --mapper keyword|gemini|qwen [--bench v1|v2] [--only add,focus] [--rpm 15]
// --bench picks the benchmark file (default v1). Results go to results/<mapper>-<bench>-<timestamp>.jsonl.
// --rpm paces requests (default 15 for gemini, the free-tier limit); waiting is not counted in latency.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { KeywordMapper } from './mappers/keyword.ts';
import { caseErrors } from './schema.ts';
import { scoreCase, type Failure, type Scores } from './scorer.ts';
import type { EvalCase, SceneMapper, SceneOperation } from './types.ts';

const BENCHMARKS: Record<string, URL> = {
  v1: new URL('../yap-eval-v1.jsonl', import.meta.url),
  v2: new URL('../yap-eval-v2-hard.jsonl', import.meta.url),
};

interface Row { id: string; category: string; policy: string; utterance: string; expected: SceneOperation[]; ops: SceneOperation[] | null; raw: string; scores: Scores; failure: Failure }

/** Loads a benchmark and checks every case against the validate.mjs rules, so a bad file fails before any API calls. */
function loadBenchmark(bench: string): EvalCase[] {
  const url = BENCHMARKS[bench];
  if (!url) throw new Error(`unknown bench "${bench}" (expected ${Object.keys(BENCHMARKS).join(' or ')})`);
  const records: unknown[] = readFileSync(url, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const seen = new Set<string>();
  const errors = records.flatMap((r: any, i) => {
    const errs = caseErrors(r).map(e => `line ${i + 1} (${r?.id}): ${e}`);
    if (seen.has(r?.id)) errs.push(`line ${i + 1}: duplicate id "${r.id}"`);
    seen.add(r?.id);
    return errs;
  });
  if (errors.length) throw new Error(`${url.pathname} is invalid:\n  ${errors.join('\n  ')}`);
  return records as EvalCase[];
}

async function makeMapper(name: string): Promise<SceneMapper> {
  if (name === 'keyword') return new KeywordMapper();
  if (name !== 'gemini' && name !== 'qwen') throw new Error(`unknown mapper "${name}" (expected keyword, gemini or qwen)`);
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* fall back to the shell environment */ }
  if (name === 'gemini') {
    const { GeminiMapper } = await import('./mappers/gemini.ts');
    return new GeminiMapper();
  }
  const { QwenMapper } = await import('./mappers/qwen.ts');
  return QwenMapper.fromEnv();
}

const pct = (k: number, n: number) => (n ? `${Math.round((100 * k) / n)}%` : '-').padStart(5);
const short = (ops: unknown) => (ops === null ? 'null' : JSON.stringify(ops));

function summaryLine(label: string, rows: Row[]): string {
  const n = rows.length;
  const count = (key: keyof Scores) => rows.filter(r => r.scores[key] === true).length;
  const noops = rows.filter(r => r.scores.noop_correct !== null);
  const lat = rows.map(r => r.scores.latency_ms).sort((a, b) => a - b);
  return [
    label.padEnd(24), String(n).padStart(3),
    pct(count('valid_json'), n), pct(count('schema_valid'), n), pct(count('executable'), n),
    pct(count('exact_match'), n), pct(count('state_match'), n),
    (noops.length ? `${count('noop_correct')}/${noops.length}` : '-').padStart(6), pct(count('noop_correct'), noops.length),
    String(rows.reduce((s, r) => s + r.scores.invented_objects, 0)).padStart(8),
    String(lat[Math.floor(lat.length / 2)] ?? 0).padStart(7),
  ].join(' ');
}

function printSummary(title: string, rows: Row[]) {
  console.log(`\n${title}: ${rows.length} cases`);
  console.log(['group'.padEnd(24), '  n', ' json', 'schema', 'exec', 'exact', 'state', '  noop', 'noop%', 'invented', 'p50 ms'].join(' '));
  const groups: [string, Row[]][] = [['overall', rows]];
  for (const cat of [...new Set(rows.map(r => r.category))]) groups.push([`  ${cat}`, rows.filter(r => r.category === cat)]);
  for (const policy of ['strict', 'inferred']) {
    const ofPolicy = rows.filter(r => r.policy === policy);
    if (!ofPolicy.length) continue;
    groups.push([policy, ofPolicy]);
    for (const cat of [...new Set(ofPolicy.map(r => r.category))]) groups.push([`  ${cat}`, ofPolicy.filter(r => r.category === cat)]);
  }
  for (const [label, g] of groups) console.log(summaryLine(label, g));

  const failures = rows.filter(r => r.failure !== 'ok');
  if (failures.length) {
    console.log('\nfailures:');
    for (const r of failures) {
      console.log(`\n  ${r.id}  [${r.policy}]  ${r.failure}`);
      console.log(`    utterance: ${r.utterance}`);
      console.log(`    expected:  ${short(r.expected)}`);
      console.log(`    predicted: ${short(r.ops)}${r.ops === null ? `  (raw: ${r.raw.slice(0, 200)})` : ''}`);
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { mapper: { type: 'string', default: 'keyword' }, bench: { type: 'string', default: 'v1' }, only: { type: 'string' }, rpm: { type: 'string' } } });
  const only = values.only?.split(',').map(s => s.trim());
  const bench = values.bench!;
  const cases = loadBenchmark(bench);
  const selected = only ? cases.filter(c => only.includes(c.category)) : cases;
  if (!selected.length) throw new Error(`no cases match --only ${values.only}`);

  const mapper = await makeMapper(values.mapper!);
  const rpm = Number(values.rpm ?? (mapper.name === 'gemini' ? 15 : 0));
  const gapMs = rpm > 0 ? 60_000 / rpm : 0;
  let nextStart = 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  const out = new URL(`../results/${mapper.name}-${bench}-${stamp}.jsonl`, import.meta.url);

  const rows: Row[] = [];
  const lines: string[] = [];
  for (const c of selected) {
    await new Promise(r => setTimeout(r, Math.max(0, nextStart - performance.now())));
    const start = performance.now();
    nextStart = start + gapMs;
    const pred = await mapper.predict(c.input);
    const latency = Math.round(performance.now() - start);
    const { scores, failure } = scoreCase(c, pred, latency);
    rows.push({ id: c.id, category: c.category, policy: c.policy, utterance: c.input.utterance, expected: c.expected_ops, ops: pred.ops, raw: pred.raw, scores, failure });
    lines.push(JSON.stringify({ id: c.id, category: c.category, policy: c.policy, utterance: c.input.utterance, raw: pred.raw, ops: pred.ops, expected_ops: c.expected_ops, scores, failure }));
    process.stderr.write(failure === 'ok' ? '.' : 'x');
  }
  writeFileSync(out, lines.join('\n') + '\n');
  printSummary(`${mapper.name} on ${bench}`, rows);
  console.log(`\nwrote ${out.pathname}`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
