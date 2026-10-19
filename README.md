# Yap eval v1

50 evaluation cases for **Yap**, a game where speech becomes symbolic draw ops on a canvas.
Each case gives an utterance plus the current canvas state. The expected output is the exact op batch the interpreter should emit.

Files:
- `yap-eval-v1.jsonl`: one case per line (50 lines)
- `validate.mjs`: schema and reference validator (Node ≥ 18, no dependencies)

```sh
node validate.mjs                 # validates yap-eval-v1.jsonl next to the script
node validate.mjs other.jsonl     # validates another file
```
It exits 0 and prints counts per category and policy on success. It exits 1 and lists every error on failure.

## Case schema

```jsonc
{
  "id": "add_001",                 // <category>_<NNN>, unique; NNN = global case number
  "category": "add",               // add | relation | focus | edit | undo_clear | self_correction |
                                   // paraphrase_strict | paraphrase_inferred | unsupported
  "policy": "strict",              // "strict" | "inferred"
  "input": {
    "utterance": "draw a cat",
    "scene": { "objects": [ { "id": "house_1", "type": "house", "color": "red", "x": 0.5, "y": 0.7, "scale": 1.0 } ] },
    "focus_id": null,              // string id present in scene, or null
    "history_len": 0               // int >= 0, number of undoable actions
  },
  "expected_ops": [ { "op": "add", "type": "cat" } ],
  "notes": "optional free text"
}
```

### Scene objects
Every object has its full state: `id`, `type`, `color`, `x`, `y`, `scale`.
- **Types:** `cat`, `tree`, `house`, `sun`, `cloud`
- **Colors:** `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `brown`, `black`, `white`, `gray`
- **Default colors:** cat gray, tree green, house brown, sun yellow, cloud white (same as `scene-spec-v1.md` and the scene engine)
- **Coordinates:** `x`, `y` in [0, 1], where (0, 0) is the top-left
- **Scale:** in [0.3, 2.0], default 1.0
- **IDs:** assigned by the app as `type_N` (e.g. `tree_2`)

### Ops
| op | fields |
|---|---|
| `add` | `type`, optional `color`, `at`, `scale` |
| `recolor` | `target`, `color` |
| `move` | `target`, `to` |
| `scale` | `target`, `factor` |
| `delete` | `target` |
| `undo` | (none) |
| `clear` | (none) |

- `target` is an id that **already exists** in the scene.
- `at` / `to` is either:
  - a named spot: `left`, `right`, `center`, `top`, `bottom`, `top-left`, `top-right`, `bottom-left`, `bottom-right`
  - `{"relation": "on|near|above|below|left_of|right_of", "ref": <ref>}`, where `<ref>` is an existing scene id or `{"added_in_op": N}`. `N` is the 0-based index of an earlier `add` op in the same batch.
- An empty array `[]` means the whole utterance is rejected (nothing happens).

## Interpretation rules
1. **Draw only what was said.** Omit `color`, `at`, and `scale` unless stated. Never invent placement. For example, "a sun and a cloud at the top" gives both `at: "top"` with no left/right spread. A color that is stated is emitted even when it equals the default ("a brown house" → `color: "brown"`).
2. **Size words:** big → `scale 1.5`, small → `scale 0.6` (on add). bigger → `factor 1.3`, smaller → `0.75`, twice as big → `2.0`, half (the size) → `0.5`.
3. **Spatial words:** "next to", "beside", and "near" map to `near`. "under" maps to `below`. "on the roof" and "on top" map to `on` the house. "in the middle" maps to `center`.
4. **Pronouns** ("it", "that") need a valid `focus_id`, otherwise `[]`. The one exception is a pronoun anchored by an explicit noun earlier in the same utterance ("a tree and a cat beside it", "make the tree blue and move it left").
5. **Ambiguous nouns:** an explicit noun with several scene matches and no focus gives `[]`. Focus disambiguates "the house" when the focused object has that type.
6. **Atomic batches:** any unsupported object, or any reference that cannot be resolved (missing or ambiguous), rejects the whole batch with `[]`.
7. **Undo** is only meaningful when `history_len > 0`. `undo` and `clear` are each emitted alone in their batch.
8. **One spoken instruction = one undoable action**, even when it expands to several ops (e.g. "draw two trees" → two `add`s, undone together).
9. **Self-correction** ("a sun, no, a cloud") emits only the corrected item.
10. **Policies:**
    - `strict`: only explicitly named supported types are drawn.
    - `inferred`: a description that clearly fits exactly one supported type is drawn as that type ("a glowing yellow ball high in the daytime sky" → sun at top; "a fluffy white thing up high" → white cloud at top). If the description is ambiguous, the result is `[]`. Example: "a glowing ball in the sky" on its own could be the sun or something else, so it is inferred-ambiguous → `[]`. That variant is documented here but **not** included in the 50 cases.

## What the validator checks
- Every line parses as a JSON object with only the known fields. Ids are unique, match `<category>_NNN`, and their prefix equals the category.
- `category` and `policy` are in their enums. `paraphrase_inferred` cases use `policy: "inferred"`.
- Scene objects have the full state, valid type and color, x/y in [0, 1], scale in [0.3, 2.0], ids of the form `type_N` that match the type, and no duplicate ids. `focus_id` is null or present in the scene.
- Ops have exactly the allowed fields with valid values. `add.scale` is in [0.3, 2.0] and factors are > 0.
- Every `target` or `ref` id exists in the scene and was not deleted earlier in the batch. Every `{"added_in_op": N}` points to an earlier `add` op.
- `undo` appears only when `history_len > 0`. `undo` and `clear` are the only op in their batch.

## Coverage (v1)
| category | cases |
|---|---|
| add | 12 (001–012) |
| relation | 10 (013–022) |
| focus | 5 (023–027) |
| edit | 13 (028–040) |
| undo_clear | 4 (041–044) |
| self_correction | 2 (045–046) |
| paraphrase_inferred | 2 (047–048) |
| paraphrase_strict | 0 (reserved for v2) |
| unsupported | 2 (049–050) |

Policies: 48 strict, 2 inferred.
