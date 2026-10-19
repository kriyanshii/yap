// Gemini scene-mapper prompt and response schema, shared by the eval mapper (SDK, Node) and the game server (REST, Cloudflare Worker).
// Kept free of SDK imports so it can be bundled anywhere.
import { COLORS, RELATIONS, SPOTS, TYPES } from '../../src/scene/engine.ts';

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

const str = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const opSchema = (op: string, props: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties: { op: str([op]), ...props },
  required: ['op', ...required],
});
const ref = {
  anyOf: [
    { type: 'string', description: 'id of an object already in the scene, e.g. "tree_1"' },
    { type: 'object', properties: { added_in_op: { type: 'integer', minimum: 0 } }, required: ['added_in_op'] },
  ],
};
const pos = {
  anyOf: [
    str(SPOTS),
    { type: 'object', properties: { relation: str(RELATIONS), ref }, required: ['relation', 'ref'] },
  ],
};
const target = { type: 'string', description: 'id of an object already in the scene' };

export const RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    anyOf: [
      opSchema('add', { type: str(TYPES), color: str(COLORS), at: pos, scale: { type: 'number', minimum: 0.3, maximum: 2 } }, ['type']),
      opSchema('recolor', { target, color: str(COLORS) }, ['target', 'color']),
      opSchema('move', { target, to: pos }, ['target', 'to']),
      opSchema('scale', { target, factor: { type: 'number', exclusiveMinimum: 0 } }, ['target', 'factor']),
      opSchema('delete', { target }, ['target']),
      opSchema('undo'),
      opSchema('clear'),
    ],
  },
};

export const SYSTEM_PROMPT = `You turn one spoken instruction for a drawing game into a JSON array of scene operations.
You receive {utterance, scene, focus_id, history_len}. Output only the array.

Ops:
- {"op":"add","type",["color"],["at"],["scale"]}
- {"op":"recolor","target","color"}
- {"op":"move","target","to"}
- {"op":"scale","target","factor"}
- {"op":"delete","target"}
- {"op":"undo"} and {"op":"clear"}: each must be the only op in the array.
Types: ${TYPES.join(', ')}. Colors: ${COLORS.join(', ')}.
"target" is the id of an object already in the scene. "at"/"to" is a named spot (${SPOTS.join(', ')}) or {"relation": ${RELATIONS.join('|')}, "ref": <scene id or {"added_in_op": N}>}, where N is the 0-based index of an earlier add op in the same array.

Rules:
1. Draw only what was said. Omit color, at and scale unless stated. Never invent placement. A stated color is emitted even if it is the default.
2. Sizes on add: big -> scale 1.5, small -> scale 0.6. Edits: bigger -> factor 1.3, smaller -> 0.75, twice as big -> 2, half the size -> 0.5.
3. "next to", "beside", "near" -> near. "under" -> below. "on the roof" / "on top" -> on the house. "in the middle" -> center.
4. Pronouns ("it", "that") resolve to focus_id. If there is no focus, return []. Exception: a pronoun that refers to a noun named earlier in the same utterance.
5. "the <type>" must match exactly one scene object. If several match, use focus_id only if the focused object has that type; otherwise return [].
6. The batch is atomic: if any object type is unsupported or any reference cannot be resolved, return [].
7. Undo only when history_len > 0, otherwise [].
8. One utterance is one action, even when it needs several ops (e.g. "three clouds" -> three adds).
9. Self-correction ("X, no, Y") emits only the corrected item.
10. Only draw supported types. A description that clearly fits exactly one supported type may be drawn as that type; if it is ambiguous, return [].
11. Nonsense, chatter and unsupported requests return [].

Examples:
{"utterance":"draw a blue cloud on the left","scene":{"objects":[]},"focus_id":null,"history_len":0}
-> [{"op":"add","type":"cloud","color":"blue","at":"left"}]
{"utterance":"three small suns","scene":{"objects":[]},"focus_id":null,"history_len":0}
-> [{"op":"add","type":"sun","scale":0.6},{"op":"add","type":"sun","scale":0.6},{"op":"add","type":"sun","scale":0.6}]
{"utterance":"add a house and a sun above it","scene":{"objects":[]},"focus_id":null,"history_len":0}
-> [{"op":"add","type":"house"},{"op":"add","type":"sun","at":{"relation":"above","ref":{"added_in_op":0}}}]
{"utterance":"put a cloud right of the sun","scene":{"objects":[{"id":"sun_1","type":"sun","color":"yellow","x":0.8,"y":0.2,"scale":1}]},"focus_id":null,"history_len":1}
-> [{"op":"add","type":"cloud","at":{"relation":"right_of","ref":"sun_1"}}]
{"utterance":"paint it purple","scene":{"objects":[{"id":"cat_1","type":"cat","color":"gray","x":0.5,"y":0.5,"scale":1},{"id":"cat_2","type":"cat","color":"gray","x":0.7,"y":0.5,"scale":1}]},"focus_id":"cat_2","history_len":2}
-> [{"op":"recolor","target":"cat_2","color":"purple"}]
{"utterance":"shrink the cat","scene":{"objects":[{"id":"cat_1","type":"cat","color":"gray","x":0.5,"y":0.5,"scale":1},{"id":"cat_2","type":"cat","color":"gray","x":0.7,"y":0.5,"scale":1}]},"focus_id":null,"history_len":2}
-> []
{"utterance":"remove the sun","scene":{"objects":[{"id":"sun_1","type":"sun","color":"yellow","x":0.8,"y":0.2,"scale":1}]},"focus_id":null,"history_len":1}
-> [{"op":"delete","target":"sun_1"}]
{"utterance":"go back","scene":{"objects":[]},"focus_id":null,"history_len":0}
-> []
{"utterance":"a tree and a dog","scene":{"objects":[]},"focus_id":null,"history_len":0}
-> []`;
