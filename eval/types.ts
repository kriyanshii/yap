import type { Op, SceneObject } from '../src/scene/engine.ts';

export type SceneOperation = Op;
export interface SceneGraph { objects: SceneObject[] }

export interface MapperInput {
  utterance: string;
  scene: SceneGraph;
  focus_id: string | null;
  history_len: number;
}

export interface MapperResult {
  /** The model's text, or "error: ..." on failure. */
  raw: string;
  /** null when nothing usable came back. */
  ops: SceneOperation[] | null;
  /** The model answered with ops, but the output guard rejected them (ops is then []). */
  guardRejected?: boolean;
}

export interface SceneMapper {
  name: string;
  predict(input: MapperInput): Promise<MapperResult>;
}

export interface EvalCase {
  id: string;
  category: string;
  policy: 'strict' | 'inferred';
  input: MapperInput;
  expected_ops: SceneOperation[];
  notes?: string;
}
