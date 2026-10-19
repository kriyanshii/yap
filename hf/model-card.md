---
base_model: Qwen/Qwen2.5-1.5B-Instruct
library_name: peft
license: apache-2.0
language: en
pipeline_tag: text-generation
tags: [lora, peft, structured-output, json, semantic-parsing, game]
datasets: [{{HF_USER}}/yap-scene-sft]
---

# Qwen2.5-1.5B Yap scene mapper (LoRA)

A LoRA adapter for [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct). It turns one spoken drawing instruction, plus the current canvas, into a JSON array of draw ops for **Yap**, a party game where speech becomes drawings.

- **Adversarial benchmark (v2, 79 cases):** 95% exact match vs 87% for prompted Gemini 3.5 Flash-Lite, with 24/24 correct refusals. Median latency is under 1 s on a warm A10G.
- **Easier benchmark (v1, 50 cases):** 94% raw, 96% with the output guard, against 98% for Gemini (a one-case gap).
- **Held-out caveat:** the earlier run (run 1), whose data never depended on benchmark failures, scored 90% raw / 92% guarded on v2. See the limitations.
- **In production:** it powers a live multiplayer game, [Yap](https://yap.kriyanshishah06.workers.dev), behind a schema guard with Gemini and rule-based fallbacks. All 18 game scenes draw correctly from their hint phrases.
- **Compute:** this adapter trained in about 46 minutes on one A10G (about 2 A10G-hours across the whole project).

## Input and output

The **user** message is JSON: `{"utterance", "scene", "focus_id", "history_len"}`. The utterance is lowercase speech-to-text without punctuation. Each scene object has `id`, `type`, `color`, `x`, `y` and `scale`.

The **assistant** reply is a JSON array of ops, or `[]` to reject.

```json
{"utterance":"put a cat on the house","scene":{"objects":[{"id":"house_1","type":"house","color":"brown","x":0.5,"y":0.7,"scale":1}]},"focus_id":null,"history_len":0}
→ [{"op":"add","type":"cat","at":{"relation":"on","ref":"house_1"}}]
```

Use **exactly** this system prompt; the model was trained with it:

```text
{{SYSTEM_PROMPT}}
```

## Usage

```python
import json, torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

tok = AutoTokenizer.from_pretrained("{{HF_USER}}/{{MODEL_REPO}}")
base = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-1.5B-Instruct", torch_dtype=torch.bfloat16, device_map="auto")
model = PeftModel.from_pretrained(base, "{{HF_USER}}/{{MODEL_REPO}}").merge_and_unload().eval()

messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": json.dumps(mapper_input)}]
ids = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt").to(model.device)
out = model.generate(ids, max_new_tokens=512, do_sample=False)
ops = json.loads(tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True))
```

**Guard the output before executing it.** Reject the whole batch if any op uses a type, color, spot or relation outside the schema, or a target or ref that isn't a scene id. The reference implementation is `guardOps` in the project's `eval/mappers/qwen.ts`. The guarded scores below assume it.

## Results

Exact match means the op array equals the label, with key order ignored. All runs use greedy decoding, one run each. The eval set is [{{HF_USER}}/yap-scene-eval](https://huggingface.co/datasets/{{HF_USER}}/yap-scene-eval).

| benchmark | keyword parser | Gemini 3.5 Flash-Lite (prompted) | this model, raw | this model, guarded |
|---|---|---|---|---|
| v2-hard (79) | 37% | 87% | **95%** | **95%** |
| v2 correct refusals (24) | 23/24 | 18/24 | 24/24 | 24/24 |
| v1 (50) | 96% | **98%** | 94% | 96% |
| v1 correct refusals (8) | 8/8 | 7/8 | 6/8 | 7/8 |

Median latency on an A10G, warm container: about 0.7–0.8 s per request.

## In the live game

In Yap's demo build, the Yapper describes a secret scene (e.g. *"a blue cat under a tree"*) without saying the object words. Each utterance goes to this adapter first, with a 3 s timeout and the schema guard. Gemini is the fallback, and a keyword parser is the last resort. After a refusal, a Gemini "best guess" may add the closest object from a loose description, but it can never edit or remove anything.

A **canvas check** plays a rule-following Yapper script for each of the 18 game scenes and checks the final canvas for objects, colours, counts, sizes and relations:

| | scenes correct | lines answered by this model | median latency |
|---|---|---|---|
| first scripted pass | 13/18 | 49/49 | 0.76 s |
| the game's hint phrases | **18/18** | 50/50 | 0.78 s |

The first-pass failures are listed under Limitations.

## Training

- **Data:** [{{HF_USER}}/yap-scene-sft](https://huggingface.co/datasets/{{HF_USER}}/yap-scene-sft), 4,000 train and 400 val synthetic examples.
  - Template-first: each label is chosen in code and checked against the scene engine.
  - Noise and mishears on about 30% of examples.
  - Leakage-checked against both benchmarks.
- **LoRA:** r=16, alpha=32, dropout 0.05, on q/k/v/o/gate/up/down.
- **Schedule:** 3 epochs, lr 2e-4 with cosine decay, effective batch 16, bf16, gradient checkpointing.
- **Loss on the assistant turn only:** prompt/completion split in TRL 0.21.
- **Hardware:** one Modal A10G, about 46 minutes. Final eval loss 0.0099.

## Limitations

- **Narrow domain.** It knows 5 object types (cat, tree, house, sun, cloud) and 11 colors. Anything else should come back `[]`.
- **Over-refusal from "refuse when X" training templates.** Known misses:
  - "move the cloud above the tree" when both objects exist (returns `[]`)
  - "a gray puffy thing that brings rain" (returns `[]`)
  - "undo that" (returns `[]`)
  - "put a cat on the house" with two houses and no focus: should be `[]`, but it adds a cat to both
- **A description plus a relation or size.** "put the animal that purrs **on it**" or "a **small** place where people live" can lose the relation or size, because the training templates never combined descriptions with relations or sizes. Workarounds: "on top of it", or "make it small" as a separate edit.
- **Spatial selectors.** It can still resolve "the left tree" by id order instead of position.
- **Policy is not an input.** It always repairs obvious mishears (the "inferred" reading).
- **How held-out the scores are.** No benchmark utterance is in the training data. But this adapter's data (run 2) was revised after looking at an earlier run's benchmark failures, so its scores are somewhat optimistic. The earlier run scored 90% raw / 92% guarded on v2.
- **Small benchmarks.** One case is worth 1.3 points on v2 and 2 points on v1.
