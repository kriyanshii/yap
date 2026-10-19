---
title: "A 1.5B model beat prompted Gemini at turning speech into drawings. Its four regressions taught me more"
authors:
  - user: kriyanshi
---

# A 1.5B model beat prompted Gemini at turning speech into drawings. Its four regressions taught me more

**TL;DR.** I fine-tuned Qwen2.5-1.5B-Instruct with LoRA to turn spoken instructions into JSON draw ops for a party game.

- **On a 79-case hard benchmark:** 95% exact match, against 87% for prompted Gemini 3.5 Flash-Lite. It got all 24 refusal cases right, against Gemini's 18.
- **On the easier v1 benchmark:** Gemini still leads by one case.
- **Cost:** about two hours of a single A10G on Modal.
- **The lesson that stuck:** every time I taught the model to refuse something, it started refusing nearby things that were fine.

Everything is public: the [adapter](https://huggingface.co/kriyanshi/qwen2.5-1.5b-yap-scene-lora), the [synthetic training data](https://huggingface.co/datasets/kriyanshi/yap-scene-sft), and the [eval set](https://huggingface.co/datasets/kriyanshi/yap-scene-eval).

## The task

Yap is a game where you talk and the canvas draws. Under the hood, a **scene mapper** reads one utterance plus the current canvas and emits a batch of ops. A deterministic engine then executes them:

```json
{"utterance": "put a cat on the house",
 "scene": {"objects": [{"id": "house_1", "type": "house", "color": "brown", "x": 0.5, "y": 0.7, "scale": 1}]},
 "focus_id": null, "history_len": 0}
→ [{"op": "add", "type": "cat", "at": {"relation": "on", "ref": "house_1"}}]
```

The vocabulary is small:
- **Ops:** add, recolor, move, scale, delete, undo and clear.
- **Objects:** five types and 11 colors.
- **Positions:** nine named spots, or relations to other objects.

The hard part is everything around it. Real speech-to-text output is lowercase, unpunctuated and messy ("uh draw like a a kitty on the uh roof thing"). It mishears words ("draw a son up in the sky"). And people refer to things in many ways: "the left tree", "the bigger house", "the other cat", "it".

The most important output is often `[]`, meaning "do nothing". An unsupported object, a reference that matches two houses, "it" when nothing is selected, "undo the last two" (which the op format can't express): all of these must be rejected **whole**. Drawing half of a request is worse than drawing none of it.

## Two benchmarks, hand-labeled

- **v1 (50 cases):** basic adds, relations, focus, edits and undo/clear.
- **v2-hard (79 cases):** disfluent speech, mishears, 3–5-op batches, indirect descriptions ("the bright thing that rises every morning"), selector words that look like edit words ("delete the **bigger** house" contains no scale op), unsupported items buried in otherwise valid requests, and tricky undo/clear.

Both come with a dependency-free validator and written labeling rules.

v2 originally had 80 cases. I removed one after realizing two cases had the same input with opposite labels: one under a "strict" policy, one under an "inferred" policy. Since policy isn't part of the model's input, no model could get both right. Auditing your benchmark for unsatisfiable pairs is worth an hour.

## Baselines

A keyword parser is the floor. On v1 it scores 96%, and on v2 it scores 37%. That gap says more about v1 than about the parser: v1 is too easy to separate mappers.

Prompted **Gemini 3.5 Flash-Lite**, using the rules, nine examples and a JSON-schema response format, scores 98% on v1 and 87% on v2. Its main weakness is saying no: it missed 6 of the 24 v2 cases that should return `[]`. It drew the house in "a house with a chimney smoking" and dropped the chimney, instead of rejecting the request.

## Template-first synthetic data

I didn't ask an LLM to write training examples and hope its labels were right. Instead, I chose the label in code first and wrote the sentence second:

1. **Scene sampler:** 0–5 objects, valid colors and positions. Ids are deliberately out of spatial order, so `tree_1` is not a safe guess for "the left tree".
2. **Intent sampler:** picks the op batch, and every example must run on the real scene engine.
   For most `[]` reasons I also check the refusal itself. I build the ops a careless model *would* emit ("delete the cat and put a tree next to the cat" becomes delete, then reference the deleted cat), and require the engine to reject them.
3. **Templates and a rule-based paraphraser:** a check rejects any rewrite that changes an object, color, position, number or reference word.
4. **Noise on about 30% of examples:** fillers, stutters, restarts, self-corrections ("a cat wait no a house"), chatter, and mishears like son/sun, read/red, write/right.
5. **Category mix weighted toward Gemini's weaknesses:** 30% should-return-`[]`, 15% multi-object placement, 15% references, 15% messy speech, 10% indirect descriptions, 15% simple.

The output is 4,000 train and 400 val examples. Generation is byte-reproducible from a seed.

### Leakage, and the rule that backfired

To keep the benchmarks honest, my first leakage rule rejected any training utterance within 5 character edits of a benchmark utterance. That sounds safe, but on short commands it's brutal. "draw a sun" is 3 edits from "draw a cat", and "make it red" is 4 from "make it blue". The rule quietly removed nearly every short positive example.

## Run 1: 90% on v2, and the failures pointed at the data

Training setup:
- **Adapter:** LoRA r=16 on all attention and MLP projections, 3 epochs, effective batch 16, on one A10G.
- **Loss on the assistant turn only:** I split each chat into prompt and completion, and check before training that only the JSON answer counts toward the loss.

Run 1 scored **90% on v2**, already above Gemini. But it scored only **86% on v1**, and its failures had a clear pattern. It rejected short, plain requests like "a cat on the house" and "put a tree next to the house".

Counting the training data explained why. Among short relation phrases, 29 were positive and 51 were `[]`. My refusal templates ("put a cat on the house" when there is no house) had survived the leakage filter. Their positive twins hadn't. So the model learned that short "X on the Y" means *reject*.

I changed the leakage rule. Now an utterance leaks only if it is within 5 edits **and** names the same objects and relations, with mishears mapped to the word they replace, so "rough" can't sneak "roof" back in.

Near-copies of benchmark frames, like "put the cat on the house", stay out. "put a tree next to the cat" is allowed back in. After the change, short relation phrases were 88 positive and 43 `[]`.

### A cheap guard

Unlike Gemini, my model had no schema-constrained decoding. On long requests with an unsupported item, it sometimes invented values: a target called `"dog"`, a type `"bird"`, a relation `"in"`.

So I added a guard in code. If any op uses an unknown type, color, spot or relation, or a target that isn't a real scene id, the whole batch is rejected. That's exactly what the game should do anyway, and it fixed four cases on its own. I report **raw** and **guarded** scores separately. Raw is what the model learned; guarded is what players get.

## A bug that would have quietly invalidated run 2

Partway into training run 2, the loss-mask printout showed the *same first example* as run 1, and the token count matched to the digit. My data had changed, but the job was training on the old copy.

I had pointed the Hugging Face cache at a persistent volume, so the cache of the parsed and tokenized data outlived the data itself. I stopped the run after 4 minutes.

The fix has two parts:
- The dataset cache now lives in temporary storage.
- The job refuses to start unless a SHA-256 of the data inside the container matches the one computed on my machine.

Without that one printed line, I'd have reported run 2 numbers for a model trained on run 1's data.

## Run 2

| | v2-hard (79) | v2 refusals (24) | v1 (50) |
|---|---|---|---|
| keyword parser | 37% | 23/24 | 96% |
| Gemini 3.5 Flash-Lite (prompted) | 87% | 18/24 | **98%** |
| Qwen 1.5B run 1, raw / guarded | 90% / 92% | 20/24 / 22/24 | 86% / 90% |
| **Qwen 1.5B run 2, raw / guarded** | **95% / 95%** | **24/24** | 94% / 96% |

The short relation cases came back. On v2, the guard no longer changes any answer: the model learned to reject the long requests with unsupported items on its own. Median latency on a warm A10G is under a second.

## The interesting part: four regressions

Run 2 fixed nine cases across both benchmarks and broke four. All four trace back to the templates I had just added:

| utterance | should be | run 2 did |
|---|---|---|
| move the cloud above the tree (both exist) | move | `[]` |
| a gray puffy thing that brings rain | gray cloud | `[]` |
| undo that | undo | `[]` |
| put a cat on the house (two houses, no focus) | `[]` | added a cat to **both** houses |

The first three are over-refusals. I had added "move relative to a **missing** object → `[]`", with no template for moving relative to an object that *exists*. I had vague descriptions labeled `[]`, but few clear descriptions that name a color. And the leakage rule blocks "undo that" and every phrasing close to it, while 57 "undo with no history → `[]`" examples remained. The model learned the sentence frame, not the condition.

The fourth is the mirror image. After adding many short positive relation adds, the model became too willing on an ambiguous one.

**Lesson:** every "refuse when X" template needs a matching positive template that differs *only in X*: same frame, referent present, reference unambiguous. Otherwise you're teaching the frame.

I'm deliberately not fixing these four with a third run. Fixing single benchmark cases is how a dataset ends up tuned to its benchmark. They'll go into a v3 data run driven by real player failures.

## Caveats

- **These benchmarks are small.** One v1 case is worth 2 points, and the 96% vs 98% gap to Gemini on v1 is a single case. Each number comes from one run with greedy decoding.
- **Run 2 isn't perfectly held-out.** No benchmark utterance is in the training data (the leakage check finds zero). But I revised run 2's data after studying run 1's benchmark failures, so run 2's scores are somewhat optimistic. Run 1 (90% raw / 92% guarded on v2) is the clean held-out number.
- **Gemini was prompted, not tuned.** Its prompt was written before v2 existed.

## Try it

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

base = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-1.5B-Instruct", torch_dtype="auto", device_map="auto")
model = PeftModel.from_pretrained(base, "kriyanshi/qwen2.5-1.5b-yap-scene-lora")
tok = AutoTokenizer.from_pretrained("kriyanshi/qwen2.5-1.5b-yap-scene-lora")
```

Use the exact system prompt from the [model card](https://huggingface.co/kriyanshi/qwen2.5-1.5b-yap-scene-lora), and guard the output before executing it.

The [eval set](https://huggingface.co/datasets/kriyanshi/yap-scene-eval) is published for evaluation only and carries a canary string. Please don't train on it.
