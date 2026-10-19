// Fine-tuned Qwen2.5-1.5B + LoRA, served by train/modal_train.py (QwenMapper.generate) as a Modal web endpoint.
// Reads QWEN_ENDPOINT_URL and, for Modal proxy auth, MODAL_KEY / MODAL_SECRET from the environment (.env is loaded by run.ts).
// The prompt comes from train/data/prompt.ts, the same one the training data uses.
// Output guard (on unless QWEN_GUARD=0): ops that fail the benchmark schema for this scene (unknown type, target id, relation,
// color, spot, ...) reject the whole batch as [], the way the app would refuse to run them. `raw` keeps the model's own output.
import { SFT_SYSTEM_PROMPT, userContent } from '../../train/data/prompt.ts';
import { schemaErrors } from '../schema.ts';
import type { MapperInput, SceneMapper, SceneOperation } from '../types.ts';

/** Atomic rejection of anything the scene engine must not run. */
export function guardOps(ops: SceneOperation[], input: MapperInput): SceneOperation[] {
  return schemaErrors(ops, input).length ? [] : ops;
}

/** Generous because the first request can cold-start the GPU container; that request's latency includes the cold start. */
export const TIMEOUT_MS = 120_000;

export class QwenMapper implements SceneMapper {
  name = 'qwen';

  constructor(private url = process.env.QWEN_ENDPOINT_URL, private key = process.env.MODAL_KEY, private secret = process.env.MODAL_SECRET,
    private guard = process.env.QWEN_GUARD !== '0') {
    if (!url) throw new Error('QWEN_ENDPOINT_URL is not set (expected in .env; `modal deploy train/modal_train.py` prints it)');
  }

  async predict(input: MapperInput) {
    try {
      const res = await fetch(this.url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.key && this.secret && { 'Modal-Key': this.key, 'Modal-Secret': this.secret }) },
        body: JSON.stringify({ messages: [{ role: 'system', content: SFT_SYSTEM_PROMPT }, { role: 'user', content: userContent(input) }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { raw: `error: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, ops: null };
      const raw = String(((await res.json()) as { text?: unknown }).text ?? '');
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { raw, ops: null }; }
      if (!Array.isArray(parsed)) return { raw, ops: null };
      return { raw, ops: this.guard ? guardOps(parsed as SceneOperation[], input) : (parsed as SceneOperation[]) };
    } catch (e) {
      return { raw: `error: ${e instanceof Error ? e.message : String(e)}`, ops: null };
    }
  }
}
