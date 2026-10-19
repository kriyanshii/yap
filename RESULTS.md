# Yap scene mapper: results

Yap is a party game where players speak, and their words become drawings on a shared canvas. The **scene mapper** turns one spoken instruction plus the current canvas into a JSON array of draw ops, which a deterministic scene engine (`src/scene/engine.ts`) executes.

**Live demo:** https://yap.kriyanshishah06.workers.dev

## Summary

- **Result:** a LoRA fine-tune of **Qwen2.5-1.5B-Instruct** (about 2 A10G-hours on Modal) scores **95% exact match vs 87% for prompted Gemini 3.5 Flash-Lite** on a 79-case adversarial benchmark (v2), with **24/24 correct refusals**. Median latency is under 1 s on a warm A10G.
- **Easier benchmark (v1):** 94% raw / 96% with the output guard, against 98% for Gemini. That gap is one case, which is within noise.
- **Cleanest held-out number:** run 1 scored **90% raw / 92% guarded on v2**. Run 2's data was revised after studying run 1's benchmark failures, so its 95% is somewhat optimistic as a held-out estimate (see Caveats).
- **Data and evaluation:**
  - two hand-labelled benchmarks with a schema validator
  - a template-first synthetic data pipeline (4,400 examples, labels verified by running them on the scene engine)
  - a leakage check against both benchmarks
- **Failure analysis:** the model's failures traced to the data, not model size.
  - **Leakage rule:** a flawed leakage rule had removed short positive examples. Fixing it recovered **4 v1 cases** (relation_013, relation_014, relation_015 and focus_023). With the other data fixes, v1 went from **86% to 94% raw** (90% to 96% guarded).
  - **Over-refusal:** one-sided "refuse when X" templates caused over-refusal (documented below).
- **Shipped:** the model runs in a **live multiplayer game** on Cloudflare Workers + Durable Objects. It sits behind a schema guard, with Gemini and rule-based fallbacks. All 18 game scenes draw correctly from their hint phrases. The adapter, training data and eval set are public on Hugging Face.

## Published

- Adapter: [kriyanshi/qwen2.5-1.5b-yap-scene-lora](https://huggingface.co/kriyanshi/qwen2.5-1.5b-yap-scene-lora) (Apache-2.0)
- Synthetic training data: [kriyanshi/yap-scene-sft](https://huggingface.co/datasets/kriyanshi/yap-scene-sft) (CC-BY-4.0)
- Eval set, v1 and v2-hard, evaluation only: [kriyanshi/yap-scene-eval](https://huggingface.co/datasets/kriyanshi/yap-scene-eval) (CC-BY-4.0, with a canary GUID)

## In the live game

In the demo build, a round's secret scene uses only the five types (e.g. *"a blue cat under a tree"*). The Yapper describes it without saying the object words, and each utterance goes through this pipeline:

1. **Qwen (fine-tuned, Modal)** with a 3 s timeout. Its output passes the **schema guard**: any unknown type, target, relation or colour rejects the whole batch.
2. **Gemini** with the same prompt and guard, used on a timeout, an error or a guard rejection.
3. **The keyword parser,** if both fail. The canvas is never cleared on failure.
4. **Best guess:** if the answer is a refusal, Gemini with a game prompt may still *add* the closest object from a loose description ("an orange round thing" → orange sun). It can never edit or remove anything.

The scene engine applies the ops (one utterance is one undoable action), and the canvas renders its scene graph with Paint-style stamps. The secret scene never goes to the models or to guessers' browsers. A host-only panel shows which model answered each utterance and how fast.

**Canvas check** (`eval/canvas-check.mts`): for each of the 18 demo scenes, a rule-following Yapper script runs through the real chain, and the final canvas is checked for objects, colours, counts, sizes and relations. A visual report puts each description next to the canvas it produced.

| | scenes drawn correctly | lines answered by Qwen | median latency |
|---|---|---|---|
| first scripted pass | 13/18 | 49/49 | 0.76 s |
| hint phrases (after rewording) | **18/18** | 50/50 | 0.78 s |

The first pass found a data gap. Descriptions combined with a relation or a size ("put the animal that purrs **on it**", "a **small** place where people live") lost the relation or size, because the training templates never combined them. Rewording ("on top of it", "make it small" as a separate edit) works today, and those phrases became the in-game **hints**. The proper fix belongs in the next data run.

**Known issue:** objects added without a position in separate utterances land on the same spot, so "two cats on a house" can look like one cat. That's an engine layout issue, not a model error.

**Serving:**
- The Qwen endpoint scales to zero, with one container at most.
- The game warms it when a lobby opens and keeps it warm while a room is open. A cold start takes about 15–25 s.
- PartyKit's hosted platform stopped accepting deploys in October 2026, so the game server was moved to PartyServer on Cloudflare Workers + Durable Objects.

## The task

Input: `{utterance, scene, focus_id, history_len}`. The utterance is lowercase speech-to-text without punctuation. The scene holds up to 5 objects, each with id, type, color, x, y and scale.

Output: an op batch, for example `[{"op":"add","type":"cat","at":{"relation":"on","ref":"house_1"}}]`.

- **Ops:** `add`, `recolor`, `move`, `scale`, `delete`, `undo`, `clear`.
- **Types:** cat, tree, house, sun, cloud. **Colors:** 11 named colors.
- **Positions:** 9 named spots, or a relation (`on`, `near`, `above`, `below`, `left_of`, `right_of`) to a scene id or to an earlier add in the same batch.
- **`[]` means reject.** That covers unsupported objects or colors, missing, ambiguous or deleted references, pronouns with no focus, chatter, undo with no history, and batches that can't be expressed (for example "undo the last two").

The labelling rules are in `README.md` (rules 1–10) and `README-v2.md` (V2-R1…R19).

## Benchmarks

| | cases | what it tests | `[]` cases |
|---|---|---|---|
| **v1** (`yap-eval-v1.jsonl`) | 50 | basic adds, relations, focus, edits, undo/clear, self-correction, 2 inferred paraphrases | 8 |
| **v2-hard** (`yap-eval-v2-hard.jsonl`) | 79 | disfluent speech, speech-to-text mishears, 3–5-op batches, indirect descriptions, selectors ("the left tree", "the bigger house", "the other cat"), unsupported items mixed into valid requests, tricky edits, tricky undo/clear | 24 |

Both files pass `node validate.mjs`. `eval/schema.ts` mirrors the validator, and the harness re-checks every case before it runs.

- **v2 change:** `asr_errors_117` was removed. It had the same input as `asr_errors_116` but the opposite label (strict `[]` vs inferred repair), and the policy isn't part of the mapper input, so no mapper could get both right. All v2 scores below use the 79 remaining cases, including those re-scored from runs recorded on 80.
- **Policy is not a model input.** `strict` and `inferred` are labels on the case. The fine-tuned model is trained to repair obvious mishears (the inferred reading).

## Mappers

| mapper | what it is |
|---|---|
| **keyword** | Deterministic rule parser (`eval/mappers/keyword.ts`). A floor; its rules were never changed for v2. |
| **gemini** | `gemini-3.5-flash-lite`, prompted (`eval/mappers/gemini.ts`) with the rules and 9 examples (none from v2), using a JSON-schema response format. |
| **qwen run 1 / run 2** | Qwen2.5-1.5B-Instruct (Apache 2.0) + LoRA, served from Modal (`eval/mappers/qwen.ts`, `train/modal_train.py`). |
| **qwen guarded** | The same model outputs, passed through `guardOps`. Any op that fails the benchmark schema for this scene (unknown type, target id, relation, color or spot) rejects the whole batch as `[]`, as the app would. |

Raw and guarded scores come from the same requests: the raw model text is logged, and both are scored from it. The raw score shows what the model learned. The guarded score shows what players get.

## Training data

`npm run gen:data -- --n 4000 --seed 42` writes 4,000 train and 400 val chat examples (`train/data/`). The output is byte-reproducible.

- **Template-first, labels correct by construction.** Each example's op batch is chosen in code, then turned into an utterance.
  - Every example passes `caseErrors()` and runs on the engine.
  - Most `[]` reasons are also confirmed on the engine: the ops a mapper would emit if it ignored the problem must be rejected.
- **Category mix:**
  - 30% should-return-`[]`
  - 15% multi-object placement
  - 15% references
  - 15% messy speech and mishears
  - 10% indirect descriptions
  - 15% simple adds, edits, undo and clear
- **Noise on about 30% of examples:** fillers, stutters, restarts, preambles, self-corrections, chatter, and mishears (son/sun, read/red, write/right, to/two, drawer/draw a, rough/roof).
- **Paraphrase:** a deterministic rule paraphraser (`rules-v1`, no LLM). A check rejects any rewrite that changes an object, color, position, number, size or reference word.
- **Leakage check (`npm run check:leakage`):** a training utterance is rejected if it is within 5 character edits of a v1 or v2 utterance **and** names the same objects and relations. Mishears are mapped to the intended word first. Exact or near copies of benchmark frames stay out, while e.g. "put a tree next to the cat" is allowed. 0 leaks in the final data.
- **Near-duplicates:** examples with the same normalized utterance and scene are dropped, and val utterances never appear in train.

## Training

LoRA r=16, alpha=32, dropout 0.05, on all attention and MLP projections.

- **Schedule:** 3 epochs, lr 2e-4 with cosine decay, effective batch 16 (2 × 8 accumulation), gradient checkpointing, bf16.
- **Hardware:** one Modal A10G.
- **Loss on the assistant turn only:** TRL prompt/completion split. Before training, the script checks the loss mask: 23 of 508 tokens in example 0, all of them the assistant's JSON.
- **Data check:** the job refuses to start unless the data in the container matches the local files' SHA-256.

| | eval loss by epoch | val exact match (100 examples) |
|---|---|---|
| run 1 | 0.0173 → 0.0087 → 0.0058 | 95% |
| run 2 | 0.0256 → 0.0148 → 0.0099 | 90% |

Run 2's val set includes the harder new templates, so these numbers aren't comparable across runs. Compare runs only on v1 and v2 below.

## Results

Exact match = the op array equals the label (key order ignored). Generated by `npx tsx eval/compare-runs.ts`.

### v2-hard (79 cases)

| group | n | keyword | gemini | qwen run 1 raw | qwen run 1 guarded | qwen run 2 raw | qwen run 2 guarded |
|---|---|---|---|---|---|---|---|
| **overall** | 79 | 37% | 87% | 90% | 92% | **95%** | **95%** |
| messy_speech | 15 | 13% | 100% | 100% | 100% | 100% | 100% |
| asr_errors | 7 | 14% | 86% | 86% | 86% | 86% | 86% |
| multi_step | 12 | 17% | 83% | 83% | 92% | 100% | 100% |
| indirect | 12 | 50% | 92% | 92% | 92% | 92% | 92% |
| references | 10 | 30% | 80% | 80% | 80% | 90% | 90% |
| unsupported_mix | 8 | 88% | 75% | 88% | 100% | 100% | 100% |
| edits_tricky | 10 | 50% | 90% | 100% | 100% | 90% | 90% |
| undo_clear_tricky | 5 | 60% | 80% | 80% | 80% | 100% | 100% |
| strict | 60 | 37% | 87% | 90% | 93% | 97% | 97% |
| inferred | 19 | 37% | 89% | 89% | 89% | 89% | 89% |
| correct refusals | 24 | 23/24 | 18/24 | 20/24 | 22/24 | **24/24** | **24/24** |
| p50 latency (ms) | | 0 | 978 | 939 | 939 | 679 | 679 |

### v1 (50 cases)

| group | n | keyword | gemini | qwen run 1 raw | qwen run 1 guarded | qwen run 2 raw | qwen run 2 guarded |
|---|---|---|---|---|---|---|---|
| **overall** | 50 | 96% | **98%** | 86% | 90% | 94% | 96% |
| add | 12 | 100% | 100% | 100% | 100% | 100% | 100% |
| relation | 10 | 100% | 100% | 70% | 70% | 90% | 90% |
| focus | 5 | 100% | 100% | 80% | 80% | 100% | 100% |
| edit | 13 | 100% | 92% | 85% | 100% | 92% | 100% |
| undo_clear | 4 | 100% | 100% | 100% | 100% | 75% | 75% |
| self_correction | 2 | 100% | 100% | 100% | 100% | 100% | 100% |
| paraphrase_inferred | 2 | 0% | 100% | 50% | 50% | 100% | 100% |
| unsupported | 2 | 100% | 100% | 100% | 100% | 100% | 100% |
| correct refusals | 8 | 8/8 | 7/8 | 6/8 | 8/8 | 6/8 | 7/8 |
| p50 latency (ms) | | 0 | 991 | 993 | 993 | 780 | 780 |

v1 doesn't separate the mappers well: the keyword parser scores 96% on it and 37% on v2.

## Run 1 → run 2

Run 1's failures traced to holes in the data, not model size.

- **Short positive relation adds were scarce.** In run 1's data, short (7 words or fewer) "X on/next to the Y" phrases were 29 positive vs 51 `[]`. The first leakage rule (edit distance ≤ 5 alone) had removed almost every short positive example. After the leakage rule changed to also require the same objects and relation, run 2 had 88 positive vs 43 `[]`.
- **Run 2's data fixes:**
  - sky phrases ("in the sky", "up high") now label `top`; the old labels were a generator bug
  - an unsupported item buried in long commands
  - spatial selectors with ids deliberately out of spatial order
  - delete-then-redraw as a real add
  - moves relative to a missing object (`[]`)
  - focus deciding which object a relation refers to
  - bare "clear and draw" (`[]`)
  - the rough → roof mishear

Run 2 vs run 1, both guarded:
- **v1:** fixed 5, regressed 2.
- **v2:** fixed 4, regressed 2.

The v1 relation and focus cases (013, 014, 015, focus_023) all went from a wrong `[]` to correct. The guard changed one run-2 answer (v1 edit_039, an invalid ref turned into the correct `[]`) and never turned a correct answer wrong.

## Finding: "refuse when X" templates cause over-refusal

The 4 regressions all trace to the new templates:

| case | utterance | label | run 2 | likely cause |
|---|---|---|---|---|
| v1 relation_022 | put a cat on the house (two houses, no focus) | `[]` | adds a cat to **both** houses | many new short positive relation adds, few ambiguous-reference refusals in that frame |
| v1 undo_clear_042 | undo that | undo | `[]` | the leakage rule blocks "undo that" and close phrasings, while 57 "undo with no history → `[]`" examples remain |
| v2 edits_tricky_170 | move the cloud above the tree (both exist) | move | `[]` | the new "move relative to a **missing** object → `[]`" template, with no matching positive version |
| v2 indirect_140 | a gray puffy thing that brings rain | gray cloud | `[]` | vague-description refusals outweigh clear descriptions that name a color |

**Lesson:** every "refuse when X" template needs a matching positive template that differs only in X: the same frame, with the referent present or the reference unambiguous. Without it, the model learns the frame, not the condition. This is deliberately left for a v3 data run driven by real player failures, so the data isn't tuned to these benchmark cases.

Remaining run-2 failures: v2 asr_errors_120 ("on the rough" is still rejected) and references_148 ("the left tree" is still resolved by id order).

## Caveats

- **Small samples.** One v1 case is worth 2 points and one v2 case about 1.3. A seed-variance run (the same config, several seeds) would show which differences are real; it hasn't been done yet. The 96% vs 98% v1 gap to Gemini is one case. Each number is a single run with greedy decoding, with no variance across seeds.
- **Held-out status.** No benchmark utterance is in the training data (leakage check: 0). Run 1's data was written without seeing any model's benchmark failures. Run 2's data was revised after studying run 1's v1 and v2 failures, so run 2's scores are optimistic as a held-out estimate. Run 1 (v2: 90% raw / 92% guarded) is the clean held-out result.
- **Raw vs guarded.** Report both. The guard is a code check, not grammar-constrained decoding. Gemini used a JSON-schema response format but no scene-aware guard.
- **Gemini's setup.** It was prompted, not fine-tuned. Its prompt was written before v2 and not revised for it.
- **Latency.** p50 is measured on a warm container (cold start about 15–23 s). Run 2's lower latency may partly reflect container warmth, so it isn't claimed as a model improvement.

## Cost

Measured from Modal app lifetimes, which include image builds and model downloads, so this is an upper bound:

| | minutes |
|---|---|
| attempt that ran out of memory | about 3 |
| run 1 | 47 |
| stale-data run (stopped) | 4 |
| run 2 | 46 |
| endpoint, two eval sessions (estimated) | about 20 |
| **total** | **about 2 h of A10G** |

The exact figure is on the Modal billing page.

## Reproduce

```sh
node validate.mjs && node validate.mjs yap-eval-v2-hard.jsonl
npm run gen:data -- --n 4000 --seed 42 && npm run check:leakage
modal run train/modal_train.py        # train (A10G)
modal deploy train/modal_train.py     # serve; set QWEN_ENDPOINT_URL, MODAL_KEY, MODAL_SECRET in .env
npm run eval -- --mapper qwen --bench v2          # guarded; QWEN_GUARD=0 for raw
npx tsx eval/compare-runs.ts                      # the tables above
npm run test:eval && npm run test:data
```
