// Fine-tuned Qwen2.5-1.5B + LoRA, served by train/modal_train.py (QwenMapper.generate) as a Modal web endpoint.
// Used by the eval CLI (eval/run.ts, reads .env) and by the game server (Cloudflare Worker); both pass settings explicitly,
// so this file has no Node or Workers dependencies.
// The prompt comes from train/data/prompt.ts, the same one the training data uses.
// Output guard (on by default): ops that fail the benchmark schema for this scene (unknown type, target id, relation,
// color, spot, ...) reject the whole batch as [], the way the app would refuse to run them. `raw` keeps the model's own output.
import { SFT_SYSTEM_PROMPT, userContent } from '../../train/data/prompt.ts';
import { schemaErrors } from '../schema.ts';
import type { MapperInput, MapperResult, SceneMapper, SceneOperation } from '../types.ts';

/** Atomic rejection of anything the scene engine must not run. */
export function guardOps(ops: SceneOperation[], input: MapperInput): SceneOperation[] {
  return schemaErrors(ops, input).length ? [] : ops;
}

/** Generous default for the eval: the first request can cold-start the GPU container. The game passes a short timeout. */
export const TIMEOUT_MS = 120_000;

export interface QwenOptions {
  url: string;
  /** Modal proxy auth (Modal-Key / Modal-Secret headers). */
  key?: string;
  secret?: string;
  guard?: boolean;
  timeoutMs?: number;
}

export class QwenMapper implements SceneMapper {
  name = 'qwen';
  private opts: Required<Omit<QwenOptions, 'key' | 'secret'>> & Pick<QwenOptions, 'key' | 'secret'>;

  constructor(opts: QwenOptions) {
    if (!opts.url) throw new Error('QWEN_ENDPOINT_URL is not set (expected in .env; `modal deploy train/modal_train.py` prints it)');
    this.opts = { guard: true, timeoutMs: TIMEOUT_MS, ...opts };
  }

  async predict(input: MapperInput): Promise<MapperResult> {
    const { url, key, secret, guard, timeoutMs } = this.opts;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key && secret && { 'Modal-Key': key, 'Modal-Secret': secret }) },
        body: JSON.stringify({ messages: [{ role: 'system', content: SFT_SYSTEM_PROMPT }, { role: 'user', content: userContent(input) }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { raw: `error: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, ops: null };
      const raw = String(((await res.json()) as { text?: unknown }).text ?? '');
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { raw, ops: null }; }
      if (!Array.isArray(parsed)) return { raw, ops: null };
      if (!guard) return { raw, ops: parsed as SceneOperation[] };
      const ops = guardOps(parsed as SceneOperation[], input);
      return { raw, ops, ...(parsed.length > 0 && ops.length === 0 && { guardRejected: true }) };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { raw: `error: ${timedOut ? `timeout after ${timeoutMs} ms` : e instanceof Error ? e.message : String(e)}`, ops: null };
    }
  }
}
