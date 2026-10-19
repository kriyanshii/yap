// Gemini-backed mapper. Server side only: reads GEMINI_API_KEY from the environment (.env is loaded by run.ts).
import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, RESPONSE_SCHEMA, SYSTEM_PROMPT } from './geminiPrompt.ts';
import type { MapperInput, SceneMapper, SceneOperation } from '../types.ts';

export { GEMINI_MODEL, RESPONSE_SCHEMA, SYSTEM_PROMPT };
export const TIMEOUT_MS = 10_000;

export class GeminiMapper implements SceneMapper {
  name = 'gemini';
  private ai: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY, private model = GEMINI_MODEL) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set (expected in .env)');
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  }

  async predict(input: MapperInput) {
    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: JSON.stringify(input),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_SCHEMA,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      });
      const raw = res.text ?? '';
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { raw, ops: null }; }
      return { raw, ops: Array.isArray(parsed) ? (parsed as SceneOperation[]) : null };
    } catch (e) {
      return { raw: `error: ${e instanceof Error ? e.message : String(e)}`, ops: null };
    }
  }
}
