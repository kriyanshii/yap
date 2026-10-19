---
license: cc-by-4.0
language: en
task_categories: [text-generation]
tags: [benchmark, evaluation, structured-output, json, semantic-parsing, game]
size_categories: [n<1K]
configs:
  - config_name: v1
    data_files: [{split: test, path: yap-eval-v1.jsonl}]
  - config_name: v2-hard
    data_files: [{split: test, path: yap-eval-v2-hard.jsonl}]
---

# Yap scene mapper: evaluation set

**Evaluation only. Do not train on this data.**

Canary GUID: `{{CANARY}}`. If you find this string in a training corpus, the benchmark has leaked.

Hand-labeled benchmarks for mapping one spoken drawing instruction, plus the current canvas, to a JSON array of draw ops for **Yap**, a party game where speech becomes drawings. Each case has an `input` (`utterance`, `scene`, `focus_id`, `history_len`), the `expected_ops`, a `category`, a `policy` (`strict` or `inferred`), and optional `notes`.

| config | cases | covers |
|---|---|---|
| `v1` | 50 | adds, relations, focus, edits, undo/clear, self-correction, inferred paraphrases, unsupported requests |
| `v2-hard` | 79 | disfluent speech, speech-to-text mishears, 3–5-op batches, indirect descriptions, selectors, unsupported items inside valid requests, tricky edits, tricky undo/clear |

- **Labelling rules:** `RULES-v1.md` (rules 1–10) and `RULES-v2.md` (V2-R1…R19), both included. RULES-v2 refers to RULES-v1 as `README.md`.
- **Validator:** `validate.mjs` (Node ≥ 18, no dependencies), included. Run `node validate.mjs yap-eval-v2-hard.jsonl`.
- **Scoring:** exact match on the op array, with key order ignored. The project's harness also reports final-scene state match and refusal accuracy.

`v2-hard` originally had 80 cases. `asr_errors_117` was removed because it had the same input as `asr_errors_116` with the opposite label.

## Baselines (exact match)

| mapper | v1 | v2-hard |
|---|---|---|
| keyword parser | 96% | 37% |
| Gemini 3.5 Flash-Lite, prompted | 98% | 87% |
| [{{HF_USER}}/{{MODEL_REPO}}](https://huggingface.co/{{HF_USER}}/{{MODEL_REPO}}), raw / guarded | 94% / 96% | 95% / 95% |

These are small benchmarks: one case is worth 2 points on v1 and about 1.3 on v2.
