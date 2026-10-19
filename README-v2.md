# Yap eval v2-hard

79 held-out, harder cases for Yap's speech-to-draw-ops mapper. Schema, ops, fields and all v1 interpretation rules (README.md, rules 1–10) are unchanged. **No new op types or fields.** v2 only adds categories and the clarifying rules V2-R1…R17 below, which make the labels decidable.

Why v2: on v1, prompted Gemini Flash-Lite scored 98% and a keyword parser 96%. v2 targets what a keyword parser gets wrong: fillers and restarts, ASR mishears, same-batch references, selector adjectives that look like edit words ("the **bigger** house", "the **red** cat", "the **middle** tree", "**clear** the tree"), negation, and atomic rejection hidden in long batches.

Files:
- `yap-eval-v2-hard.jsonl`: 79 cases, ids `<category>_101` … `<category>_180` (NNN = global case number, no collision with v1's 001–050; 117 was removed, see below)
- `validate.mjs`: the allowed category list gains the 8 v2 categories, and `indirect` must use policy `inferred` (same pattern as `paraphrase_inferred`). Nothing else changed; v1 still passes.
- `tools/gen_v2.py`: the generator script that produced the jsonl (source of truth for edits)

```sh
node validate.mjs                          # v1: OK 50
node validate.mjs yap-eval-v2-hard.jsonl   # v2: OK 79
```

Utterances are lowercase with no punctuation, the way the Web Speech API returns them.

Default colors are unchanged from v1: cat gray, tree green, house brown, sun yellow, cloud white (same as README.md, `scene-spec-v1.md` and the scene engine).

## Coverage (v2-hard)
| category | cases | ids | policy |
|---|---|---|---|
| messy_speech | 15 | 101–115 | strict |
| asr_errors | 7 | 116, 118–123 | inferred |
| multi_step | 12 | 124–135 | strict |
| indirect | 12 | 136–147 | inferred (6 clear: 136–141, 6 ambiguous → `[]`: 142–147) |
| references | 10 | 148–157 | strict |
| unsupported_mix | 8 | 158–165 | strict |
| edits_tricky | 10 | 166–175 | strict |
| undo_clear_tricky | 5 | 176–180 | strict |

Policies: 60 strict, 19 inferred. Rejections (`[]`): 24 of 79.

## Categories
- **messy_speech**: fillers (uh, um, like, okay so), stutters ("the the"), restarts ("put a put a"), hedges ("i think"), unpunctuated self-correction ("wait no").
- **asr_errors**: plausible mishears (son→sun, read→red, rough→roof, write→right, to→two, drawer→draw a). One is an unrepairable mishear ("tea" → `[]`).
- **multi_step**: 3–5 ops per batch, mixed add and edit, same-batch refs via `{"added_in_op":N}`, gapped verbs, an atomic failure hidden at the end of a long batch (131).
- **indirect**: taboo-style descriptions. Always policy `inferred`.
- **references**: spatial, comparative, ordinal, attribute and "other" selectors resolved to concrete ids, focus versus an explicit noun, pronouns with and without valid focus.
- **unsupported_mix**: unsupported parts, accessories or companions inside an otherwise valid request, plus out-of-domain chatter.
- **edits_tricky**: scale beyond the clamp, unsupported or negated colors, moves relative to another object, a reference to something deleted in the same batch, negation redirects, "everything except", relative color.
- **undo_clear_tricky**: multi-step undo, undo with no history, clear combined with other ops, "clear" used as a delete, idiomatic undo.

## Labeling rules added in v2
- **V2-R1 Disfluencies.** Fillers, hedges, preambles, stutters and restarts are ignored. A repeated fragment ("draw a draw a cloud", "put a put a sun") is one instruction, not two. Unpunctuated corrections ("wait no", "i mean", "no") follow rule 9.
- **V2-R2 Polite or question forms** ("can you uh get rid of the sun") are commands.
- **V2-R3 Direct synonyms count as naming under strict.** "kitty"/"kitten" → cat (101). This is lexical naming, not description. Descriptions ("the thing that meows") still need `inferred`.
- **V2-R4 ASR repair is inference.** Under `inferred`, a mishear is repaired only when the context makes exactly one supported reading plausible ("son up in the sky", "make the house read"). If several repairs are plausible, the result is `[]` ("draw a tea"). Under `strict`, a mis-transcribed type word is not an explicitly named supported type, so the result is `[]`. Repairs of non-type words (read→red, write→right, to→two, drawer→draw a) are also labeled `inferred`.
- **V2-R5 Sky placement.** "up in the sky" / "high in the sky" → `top` (consistent with v1 047/048, where "high"/"up high" → top).
- **V2-R6 Definite nouns may refer to same-batch adds.** "draw a house … a sun above the house" with no house in the scene → `{"added_in_op":0}`. A pronoun refers to the nearest preceding explicit noun phrase in the utterance (133: "it" = the new tree, not the deleted one).
- **V2-R7 Edits on same-batch adds fold into the add.** `target` must already exist, so "draw a tree and make it purple and big and put it on the left" becomes a single `add` with `color`, `scale` (big = 1.5, the add-time size word) and `at`. Same for "draw a cloud and put it on the left".
- **V2-R8 Descriptive parts vs extra content.** In an indirect description, parts describe the target ("something with leaves and a trunk" = tree). In a request for a named object, "with/wearing/having X" asks for X to be drawn too. If X is unsupported (chimney smoke, hat, apples, sunglasses), the batch is atomically rejected (rule 6).
- **V2-R9 Ambiguity is judged against the open world.** "an animal" or "a pet" → `[]`, even though cat is the only supported animal. This matches v1's reading of "a glowing ball in the sky".
- **V2-R10 Selectors resolve to concrete ids.** The schema has no ordinal or relative refs, so expected ops use the resolved id. Resolution uses scene state:
  - left/right: smallest/largest `x`; top/bottom: smallest/largest `y`; middle (of 3): median `x`
  - bigger/smaller/biggest: `scale`
  - color adjective: `color`
  - "the X next to it/the Y": the X nearest by Euclidean distance (only used when the gap is large)
  - relative color ("same color as the tree"): the referent's current `color`

  In these phrases, selector words are not ops: "delete the bigger house" contains no scale op and "move the red cat" contains no recolor. Scenes deliberately put ids out of spatial order (148), so "_1" is not a safe guess.
- **V2-R11 "the other X"**: valid only when exactly two X exist and focus is on one of them. It resolves to the non-focused one.
- **V2-R12 An explicit noun beats focus.** "make the house red" with focus on a tree → the house. Focus only disambiguates when the focused object has the named type (rule 5), and a pronoun anchored in the same utterance overrides focus (154).
- **V2-R13 Chatter around a valid command is ignored.** "this game is so fun lol draw a sun" → add sun. Chatter alone → `[]` (162, v1 050).
- **V2-R14 Factors are literal; the app clamps.** "ten times bigger" → `factor: 10`. "twice as big" on scale 1.8 → `factor: 2`. The mapper does not pre-clamp, because the factor bounds are only > 0 in the schema.
- **V2-R15 Colors must be in the 11-color list.** Unsupported colors (silver) do not map to the nearest color and give `[]`. A negation with no positive color ("not yellow") gives `[]`.
- **V2-R16 Undo/clear that can't be expressed in one batch → `[]`.** Rule 7 requires `undo`/`clear` to be alone and rule 8 makes one utterance one action, so "undo the last two" and "clear and draw a sun" cannot be represented. Under the atomic principle (rule 6) they are rejected, not partially executed.
- **V2-R17 "clear the <object>" is a delete.** "clear" is a canvas clear only with no object or with everything/all/the canvas. "scratch that" / "never mind scratch that" = undo.
- **V2-R18 Negation redirect.** "not the cat the tree make it blue" targets the tree. The negated object is excluded even when it is focused.
- **V2-R19 "everything except X"**: one `delete` per other object, in scene order, as one action. It is not a `clear`.

## Disputable cases (reviewer could disagree)
| id | label | alternative a reviewer might want |
|---|---|---|
| messy_speech_101 | kitty → cat under strict (V2-R3) | `[]` under strict, or move to inferred |
| asr_errors_119 | read → red | `[]` ("read" as a verb is unsupported) |
| asr_errors_122 | "draw to trees" → 2 trees | 1 tree, or `[]` |
| asr_errors_123 | "drawer house" → house | `[]` |
| multi_step_128 | fold, big → scale 1.5 | 1.3 ("make it bigger" sense) |
| multi_step_135 | sun+cloud left, house right | sun with no placement |
| indirect_138 | "building where a family lives" → house | `[]` (apartment) |
| indirect_143 / 146 | "an animal" / "a pet" → `[]` | cat (closed-world reading) |
| references_150 | "the other cat" via focus | `[]` |
| references_155 | nearest-tree resolution | `[]` (geometric judgment) |
| unsupported_mix_164 | chatter + command executes | `[]` |
| unsupported_mix_158 / 165 | chimney smoke / sunglasses → `[]` | draw the house / sun and drop the extra |
| edits_tricky_166 / 167 | literal factor | clamp-aware factor, or `[]` |
| edits_tricky_171 | delete + ref to deleted → `[]` | delete only, then tree near the former spot |
| undo_clear_tricky_176 | `[]` | single `undo` |
| undo_clear_tricky_178 | `[]` | `clear` only |
| undo_clear_tricky_179 | delete tree_1 | `clear` |

## Changes
- **Removed asr_errors_117.** It had the same input as asr_errors_116 ("draw a son up in the sky", empty scene) with the opposite label (strict `[]` vs inferred sun at top). The policy is not part of the mapper input, so no mapper could get both right. The strict reading of V2-R4 is still the documented rule; it just has no case.
