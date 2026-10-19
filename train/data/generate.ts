// Usage: npm run gen:data -- [--n 4000] [--seed 42] [--val <n/10>]
// Writes train.jsonl / val.jsonl (chat format), *.meta.jsonl (line-aligned provenance) and stats.md to train/data/.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generate, toChat, type Example } from './generator.ts';
import { checkLeakage, loadBenchmarkUtterances } from './leakage.ts';
import { renderStats } from './stats.ts';

const { values } = parseArgs({ options: { n: { type: 'string', default: '4000' }, seed: { type: 'string', default: '42' }, val: { type: 'string' } } });
const n = Number(values.n), seed = Number(values.seed);
const valN = values.val !== undefined ? Number(values.val) : Math.round(n / 10);
if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(seed) || !Number.isInteger(valN) || valN < 0) throw new Error('--n, --seed and --val must be integers');

const bench = loadBenchmarkUtterances();
const res = generate({ n, seed, valN, bench });
const dir = new URL('./', import.meta.url);
const write = (name: string, rows: unknown[]) => writeFileSync(new URL(name, dir), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
for (const [split, rows] of [['train', res.train], ['val', res.val]] as [string, Example[]][]) {
  write(`${split}.jsonl`, rows.map(toChat));
  write(`${split}.meta.jsonl`, rows.map(r => r.meta));
}

const leak = checkLeakage([...res.train, ...res.val].map(e => e.input.utterance), bench);
const cmd = `npm run gen:data -- --n ${n} --seed ${seed}${values.val !== undefined ? ` --val ${valN}` : ''}`;
writeFileSync(new URL('stats.md', dir), renderStats(res, leak, bench.length, cmd));
console.log(`wrote ${res.train.length} train + ${res.val.length} val examples and stats.md to ${dir.pathname}`);
console.log(`leakage: ${leak.leaks.length} of ${leak.checked} utterances within edit distance 5 of a benchmark utterance (closest: ${leak.minDistance})`);
if (leak.leaks.length) process.exit(1);
