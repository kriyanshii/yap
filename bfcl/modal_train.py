"""Fine-tune Qwen3-1.7B for function calling (thinking off), then evaluate in-house and on BFCL. One command:

    python3 bfcl/make_data.py --n 20000 --refusal-share 0.15            # builds bfcl/data/mix/{train,dev}.jsonl
    modal run bfcl/modal_train.py::finetune --run ft1 --smoke           # ~20 steps + tiny evals: tests the whole chain
    modal run bfcl/modal_train.py::finetune --run ft1                   # the real run
("::finetune" is needed because this file also imports modal_bfcl's entrypoint.)

Steps: upload the mix to the "bfcl-runs" volume (SHA-256 checked in the container) -> LoRA training -> merge the
adapter into the weights -> in-house dev check (base vs fine-tune) -> BFCL single-turn on the merged model.

Prompts come from BFCL itself, so training matches evaluation exactly: each tool list goes through BFCL's Python
function-doc preprocessing, then QwenFCNoThinkHandler._format_prompt (BFCL's Qwen FC prompt + Qwen3's no-think ending,
see bfcl_cli.py). Targets are BFCL's Qwen tool-call format (<tool_call>{json}</tool_call>, one per call), or a short
plain-text refusal when no tool fits. Loss is on the target only; a mask check runs before training.
Evaluation uses BFCL's normal handler on the merged weights (--local-model-path), the same inference path as the
baselines, rather than BFCL's LoRA plumbing.
"""

import hashlib
import json
import time
from pathlib import Path

import modal

from modal_bfcl import BFCL_VERSION, GPU, VOL, app, base_image, image, run_bfcl, volume, with_sources

BASE = "Qwen/Qwen3-1.7B"
BFCL_MODEL = "Qwen/Qwen3-1.7B-FC-nothink"
MIX = Path(__file__).parent / "data" / "mix"

# No `datasets`: it pulls a pyarrow that needs NumPy 2, while vllm 0.8.5 pins NumPy 1.26. The Trainer takes a plain list.
train_image = with_sources(base_image.pip_install("peft==0.15.2", "accelerate==1.6.0"))


def sha256(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build_examples(rows: list[dict]) -> list[dict]:
    """Neutral mix rows -> {prompt, completion}, using BFCL's own preprocessing and Qwen no-think prompt."""
    import copy
    import sys

    sys.path.insert(0, "/root")
    from bfcl_cli import QwenFCNoThinkHandler  # registers the -nothink entries too
    from bfcl_eval.utils import _func_doc_language_specific_pre_processing

    handler = QwenFCNoThinkHandler(BASE, 0.001, BFCL_MODEL, True)
    out = []
    for r in rows:
        tools = _func_doc_language_specific_pre_processing(copy.deepcopy(r["tools"]), "simple_python")
        prompt = handler._format_prompt([{"role": "user", "content": r["query"]}], tools)
        if r["calls"]:
            body = "\n".join("<tool_call>\n" + json.dumps({"name": n, "arguments": a}) + "\n</tool_call>"
                             for c in r["calls"] for n, a in c.items())
        else:
            body = r["refusal_text"]
        out.append({"prompt": prompt, "completion": body + "<|im_end|>", "kind": r["kind"], "calls": r["calls"]})
    return out


@app.function(image=train_image, gpu=GPU, volumes={str(VOL): volume}, timeout=8 * 60 * 60)
def train(run: str, expected_sha: dict, epochs: float = 1.0, lr: float = 2e-4, lora_r: int = 16,
          max_len: int = 4096, max_steps: int = -1) -> dict:
    import torch
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer, DataCollatorForSeq2Seq, Trainer, TrainingArguments

    data_dir = VOL / "mix" / run
    got = {n: sha256(data_dir / n) for n in expected_sha}
    assert got == expected_sha, f"stale data on the volume: {got} != local {expected_sha}"

    rows = [json.loads(l) for l in (data_dir / "train.jsonl").read_text().splitlines() if l.strip()]
    examples = build_examples(rows)
    tok = AutoTokenizer.from_pretrained(BASE)

    def encode(ex):
        p = tok(ex["prompt"], add_special_tokens=False)["input_ids"]
        c = tok(ex["completion"], add_special_tokens=False)["input_ids"]
        return {"input_ids": p + c, "attention_mask": [1] * (len(p) + len(c)), "labels": [-100] * len(p) + c}

    encoded = [encode(e) for e in examples]
    kept = [e for e in encoded if len(e["input_ids"]) <= max_len]
    print(f"examples: {len(encoded)}, kept <= {max_len} tokens: {len(kept)}, "
          f"mean tokens: {sum(len(e['input_ids']) for e in kept) / len(kept):.0f}")

    # Loss-mask check: only the target (tool calls or refusal, then <|im_end|>) may count.
    first = kept[0]
    trained = tok.decode([t for t, l in zip(first["input_ids"], first["labels"]) if l != -100])
    print(f"loss on {sum(l != -100 for l in first['labels'])}/{len(first['labels'])} tokens: {trained!r}")
    assert trained == examples[0]["completion"], "loss mask does not match the target"
    assert "<tools>" not in trained and "<|im_start|>user" not in trained, "prompt tokens are in the loss"
    print("prompt ending:", repr(examples[0]["prompt"][-60:]))

    model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16)
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=lora_r, lora_alpha=2 * lora_r, lora_dropout=0.05, task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()

    args = TrainingArguments(
        output_dir="/tmp/out", num_train_epochs=epochs, max_steps=max_steps, learning_rate=lr,
        lr_scheduler_type="cosine", warmup_ratio=0.03, per_device_train_batch_size=2, gradient_accumulation_steps=8,
        bf16=True, logging_steps=20, save_strategy="no", report_to="none", seed=42, group_by_length=True,
        remove_unused_columns=False)
    started = time.time()
    trainer = Trainer(model=model, args=args, train_dataset=kept,
                      data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100))
    result = trainer.train()

    # Merge the adapter into the weights so BFCL runs its normal handler on them.
    adapter_dir = VOL / "adapters" / run
    merged_dir = VOL / "models" / run
    model.save_pretrained(adapter_dir)
    merged = model.merge_and_unload()
    merged.save_pretrained(merged_dir, safe_serialization=True)
    tok.save_pretrained(merged_dir)
    info = {"run": run, "base": BASE, "epochs": epochs, "lr": lr, "lora_r": lora_r, "max_len": max_len,
            "max_steps": max_steps, "examples": len(kept), "dropped_too_long": len(encoded) - len(kept),
            "train_loss": result.training_loss, "train_minutes": round((time.time() - started) / 60, 1),
            "data_sha256": got, "bfcl_version": BFCL_VERSION, "gpu": GPU}
    (merged_dir / "train_info.json").write_text(json.dumps(info, indent=2))
    volume.commit()
    return info


@app.function(image=train_image, timeout=10 * 60)
def check_train_install() -> str:
    """CPU-only: the training imports work in train_image, before paying for a GPU."""
    import subprocess
    out = subprocess.run(["python", "-c", "import transformers.trainer, peft, accelerate, numpy, torch; "
                          "print('ok | transformers', transformers.__version__, '| peft', peft.__version__, "
                          "'| accelerate', accelerate.__version__, '| numpy', numpy.__version__, '| torch', torch.__version__)"],
                         capture_output=True, text=True)
    return out.stdout + out.stderr[-2000:]


@app.function(image=image, gpu=GPU, volumes={str(VOL): volume}, timeout=2 * 60 * 60)
def dev_check(model_path: str, run: str, limit: int = 0) -> dict:
    """In-house check on the held-out dev pairs: exact calls on positives, refusals on their twins, over-refusal."""
    import re

    from vllm import LLM, SamplingParams

    rows = [json.loads(l) for l in (VOL / "mix" / run / "dev.jsonl").read_text().splitlines() if l.strip()]
    rows = rows[:limit] if limit else rows
    examples = build_examples(rows)
    llm = LLM(model=model_path, dtype="bfloat16", max_model_len=8192, gpu_memory_utilization=0.85, seed=0)
    outs = llm.generate([e["prompt"] for e in examples], SamplingParams(temperature=0, max_tokens=512, stop=["<|im_end|>"]))

    def calls_of(text: str):
        found = []
        for m in re.findall(r"<tool_call>\n(.*?)\n</tool_call>", text, re.S):
            try:
                c = json.loads(m)
                found.append(json.dumps({c["name"]: c.get("arguments", {})}, sort_keys=True))
            except (json.JSONDecodeError, KeyError, TypeError):
                found.append("<bad>")
        return sorted(found)

    pos = ref = pos_exact = pos_called = ref_ok = 0
    for e, o in zip(examples, outs):
        pred = calls_of(o.outputs[0].text)
        if e["kind"] == "positive":
            pos += 1
            pos_called += bool(pred)
            pos_exact += pred == sorted(json.dumps(c, sort_keys=True) for c in e["calls"])
        else:
            ref += 1
            ref_ok += not pred
    res = {"model": model_path, "positives": pos, "refusals": ref,
           "positive_exact": round(pos_exact / max(pos, 1), 4),
           "over_refusal": round(1 - pos_called / max(pos, 1), 4),
           "refusal_correct": round(ref_ok / max(ref, 1), 4)}
    print(json.dumps(res))
    return res


@app.local_entrypoint()
def finetune(run: str = "ft1", smoke: bool = False, epochs: float = 1.0, lr: float = 2e-4, lora_r: int = 16):
    check = check_train_install.remote()
    print("train image:", check.strip().splitlines()[-1] if check.strip() else check)
    assert check.lstrip().startswith("ok"), f"training image is broken:\n{check}"
    files = {n: MIX / n for n in ("train.jsonl", "dev.jsonl")}
    expected = {n: sha256(p) for n, p in files.items()}
    with volume.batch_upload(force=True) as up:
        for n, p in files.items():
            up.put_file(str(p), f"/mix/{run}/{n}")
    print("uploaded mix:", {n: h[:12] for n, h in expected.items()}, json.loads((MIX / "stats.json").read_text())["train"])

    info = train.remote(run, expected, epochs=epochs, lr=lr, lora_r=lora_r, max_steps=20 if smoke else -1)
    print("train:", json.dumps(info, indent=2))

    merged = str(VOL / "models" / run)
    limit = 40 if smoke else 0
    base_dev, ft_dev = dev_check.remote(BASE, run, limit), dev_check.remote(merged, run, limit)
    print("dev check  base:", base_dev, "\n           fine-tune:", ft_dev)

    cats = "simple_python" if smoke else "single_turn"
    out = run_bfcl.remote(BFCL_MODEL, cats, f"{run}-bfcl-{cats}", merged)
    local = Path(__file__).parent / "runs" / f"{run}-bfcl-{cats}"
    local.mkdir(parents=True, exist_ok=True)
    (local / "run_info.json").write_text(json.dumps({**out["info"], "train": info, "dev_check": {"base": base_dev, "fine_tune": ft_dev}}, indent=2))
    for name, csv in out["scores"].items():
        (local / name).write_text(csv)
    print(f"BFCL scores saved to {local}; run python3 bfcl/analyze.py {run}-bfcl-{cats} for the breakdown")
