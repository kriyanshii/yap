// Usage: npm run check:leakage [-- file.jsonl ...]  (default: train/data/train.jsonl and val.jsonl)
// Exits 1 if any utterance is within edit distance 5 of a v1 or v2 benchmark utterance.
import { readFileSync } from 'node:fs';
import { LEAK_DISTANCE, checkLeakage } from './leakage.ts';

const files = process.argv.slice(2).length ? process.argv.slice(2).map(f => new URL(f, `file://${process.cwd()}/`)) : ['train.jsonl', 'val.jsonl'].map(f => new URL(f, import.meta.url));
const utterances = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => {
  const user = JSON.parse(l).messages.find((m: { role: string }) => m.role === 'user');
  return JSON.parse(user.content).utterance as string;
}));
const report = checkLeakage(utterances);
console.log(`checked ${report.checked} utterances from ${files.map(f => f.pathname.split('/').pop()).join(', ')}`);
console.log(`closest: distance ${report.minDistance}: "${report.closest?.utterance}" vs ${report.closest?.bench}`);
if (report.leaks.length) {
  console.log(`FAIL: ${report.leaks.length} within edit distance ${LEAK_DISTANCE}`);
  for (const l of report.leaks.slice(0, 50)) console.log(`  d=${l.distance}  "${l.utterance}"  ~  ${l.bench.id}: "${l.bench.utterance}"`);
  process.exit(1);
}
console.log(`PASS: none within edit distance ${LEAK_DISTANCE}`);
