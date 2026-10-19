---
license: cc-by-4.0
language: en
task_categories: [text-generation]
tags: [synthetic, structured-output, json, semantic-parsing, game]
size_categories: [1K<n<10K]
configs:
  - config_name: default
    data_files: [{split: train, path: train.jsonl}, {split: validation, path: val.jsonl}]
---

# Yap scene mapper: synthetic SFT data

4,000 train and 400 validation chat examples for teaching a model to turn a spoken drawing instruction into JSON draw ops for **Yap**, a party game where speech becomes drawings. Used to train [{{HF_USER}}/{{MODEL_REPO}}](https://huggingface.co/{{HF_USER}}/{{MODEL_REPO}}).

## Format

Each line is `{"messages": [system, user, assistant]}`:
- The **user** turn is JSON `{utterance, scene, focus_id, history_len}`.
- The **assistant** turn is the op array, or `[]` to reject.

`train.meta.jsonl` and `val.meta.jsonl` are line-aligned with the chat files. They record each example's category, subtype, `[]` reason, policy, template text, paraphrase rules, noise operations, and how the label was checked.

## How it was made

`npm run gen:data -- --n 4000 --seed 42` in the project repo. The output is byte-reproducible. Every example is synthetic; no LLM wrote any text or label.

1. **Scene sampler:** 0–5 objects with valid colors, positions and scales. Ids are deliberately out of spatial order.
2. **Intent sampler:** the target op batch is chosen in code. Every example passes the benchmark's schema checks and runs on the scene engine. For most `[]` reasons (missing, ambiguous or deleted refs, undo with no history, undo/clear combined with other ops), the ops a mapper would emit if it ignored the problem are run on the engine and confirmed to be rejected.
3. **Utterance writer:** templates, then a rule-based paraphrase step (`rules-v1`). A check rejects any rewrite that changes an object, color, position, number, size or reference word.
4. **Noise on about 30% of examples:** fillers, stutters, restarts, preambles, self-corrections, chatter, and speech-to-text mishears (son/sun, read/red, write/right, to/two, drawer/draw a, rough/roof).
5. **Filters:**
   - near-duplicates (same normalized utterance and scene) are dropped
   - val utterances never appear in train
   - **leakage check:** an utterance is rejected if it is within 5 character edits of a benchmark utterance *and* names the same objects and relations

Category mix: 30% should-return-`[]`, 15% multi-object placement, 15% references, 15% messy speech and mishears, 10% indirect descriptions, 15% simple. Full counts are in `stats.md`.

## Not included

The benchmark utterances are **not** in this dataset. They are published separately as an eval set, [{{HF_USER}}/yap-scene-eval](https://huggingface.co/datasets/{{HF_USER}}/yap-scene-eval). Don't mix the two.

## Known issues

- Several "refuse when X" templates have no matching positive version, which made the trained model over-refuse in those frames (see the model card).
- Utterances are longer than real speech on average: the median is about 9 words, against 6 in the benchmarks.
