import type { Op, SceneObject } from '../src/scene/engine.ts';

export type SceneOperation = Op;
export interface SceneGraph { objects: SceneObject[] }

export interface MapperInput {
  utterance: string;
  scene: SceneGraph;
  focus_id: string | null;
  history_len: number;
}

export interface SceneMapper {
  name: string;
  /** `raw` is the model's text (or "error: ..." on failure); `ops` is null when nothing usable came back. */
  predict(input: MapperInput): Promise<{ raw: string; ops: SceneOperation[] | null }>;
}

export interface EvalCase {
  id: string;
  category: string;
  policy: 'strict' | 'inferred';
  input: MapperInput;
  expected_ops: SceneOperation[];
  notes?: string;
}
