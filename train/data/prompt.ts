// System prompt and user-message format shared by the SFT data (train/data) and the qwen eval mapper, so training and inference match.
import { COLORS, RELATIONS, SPOTS, TYPES } from '../../src/scene/engine.ts';
import type { MapperInput } from '../../eval/types.ts';

export const SFT_SYSTEM_PROMPT = `Turn one spoken drawing instruction into a JSON array of scene ops. Output only the array.
Input: {utterance, scene, focus_id, history_len}.
Ops: add{type,color?,at?,scale?} recolor{target,color} move{target,to} scale{target,factor} delete{target} undo clear.
Types: ${TYPES.join(', ')}. Colors: ${COLORS.join(', ')}.
target = id already in the scene. at/to = spot (${SPOTS.join(', ')}) or {"relation": ${RELATIONS.join('|')}, "ref": scene id or {"added_in_op": N}}.
Rules: emit only what was said. big 1.5, small 0.6 on add; bigger 1.3, smaller 0.75, twice 2, half 0.5, "N times" N.
Selectors (left, bigger, red, middle, other, next to) pick an id; they are not edits. Pronouns need focus_id unless anchored in the utterance.
Ignore fillers, restarts and chatter; keep only the corrected item. Repair obvious speech-to-text mishears.
Return [] for unsupported objects, colors or extras, missing, ambiguous or deleted refs, vague descriptions, chatter alone, undo with no history, or undo/clear combined with anything.`;

/** The user turn: the mapper input as JSON, keys in benchmark order. */
export function userContent(input: MapperInput): string {
  return JSON.stringify({ utterance: input.utterance, scene: input.scene, focus_id: input.focus_id, history_len: input.history_len });
}
