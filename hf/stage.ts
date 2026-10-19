// Usage: npx tsx hf/stage.ts <hf-user> <adapter-dir>
// Stages the three Hugging Face repos in /tmp/yap-hf/{model,sft,eval} with filled-in cards. Uploading is a separate, manual step.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SFT_SYSTEM_PROMPT } from '../train/data/prompt.ts';

export const MODEL_REPO = 'qwen2.5-1.5b-yap-scene-lora';
const CANARY = '136c8ddf-7b80-4c91-9d6b-9b5842bc9c89';
const [user, adapterDir] = process.argv.slice(2);
if (!user || !adapterDir) throw new Error('usage: npx tsx hf/stage.ts <hf-user> <adapter-dir>');

const root = new URL('../', import.meta.url).pathname;
const out = '/tmp/yap-hf';
const fill = (card: string) => readFileSync(`${root}hf/${card}`, 'utf8')
  .replaceAll('{{HF_USER}}', user).replaceAll('{{MODEL_REPO}}', MODEL_REPO).replaceAll('{{CANARY}}', CANARY).replaceAll('{{SYSTEM_PROMPT}}', SFT_SYSTEM_PROMPT);
const stage = (dir: string, card: string, files: [string, string][]) => {
  mkdirSync(`${out}/${dir}`, { recursive: true });
  writeFileSync(`${out}/${dir}/README.md`, fill(card));
  for (const [src, name] of files) copyFileSync(src, `${out}/${dir}/${name}`);
};

const ADAPTER_FILES = ['adapter_config.json', 'adapter_model.safetensors', 'run_info.json', 'tokenizer.json', 'tokenizer_config.json',
  'special_tokens_map.json', 'added_tokens.json', 'vocab.json', 'merges.txt', 'chat_template.jinja'];
stage('model', 'model-card.md', ADAPTER_FILES.map(f => [`${adapterDir}/${f}`, f]));
stage('sft', 'sft-card.md', ['train.jsonl', 'val.jsonl', 'train.meta.jsonl', 'val.meta.jsonl', 'stats.md'].map(f => [`${root}train/data/${f}`, f]));
stage('eval', 'eval-card.md', ['yap-eval-v1.jsonl', 'yap-eval-v2-hard.jsonl', 'README.md', 'README-v2.md', 'validate.mjs']
  .map(f => [`${root}${f}`, f === 'README.md' ? 'RULES-v1.md' : f === 'README-v2.md' ? 'RULES-v2.md' : f]));
console.log(`staged ${out}/{model,sft,eval} for ${user}`);
