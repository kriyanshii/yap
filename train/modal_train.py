"""LoRA SFT of Qwen2.5-1.5B-Instruct (Apache 2.0) on Yap's synthetic scene-mapper data (train/data), on a Modal A10G.

    npm run gen:data -- --n 4000 --seed 42      # writes train/data/train.jsonl + val.jsonl (baked into the training image)
    modal run train/modal_train.py              # trains 3 epochs, saves the adapter to the "yap-qwen-lora" volume
    modal deploy train/modal_train.py           # serves the adapter; prints the URL for QWEN_ENDPOINT_URL

Loss is on the assistant turn only: each chat is split into prompt (system + user) and completion (assistant), and TRL
masks the prompt tokens out of the loss (completion_only_loss). `train` checks the mask before training.
"""

from pathlib import Path

import modal

APP_NAME = "yap-qwen-sft"
BASE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
VOLUME_NAME = "yap-qwen-lora"
VOL = Path("/vol")
ADAPTER_DIR = VOL / "adapters" / "qwen2.5-1.5b-yap-lora"
DATA_DIR = Path(__file__).parent / "data"
GPU = "A10G"

base_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.8.0",
        "transformers==4.55.4",
        "trl==0.21.0",
        "peft==0.17.1",
        "datasets==4.0.0",
        "accelerate==1.10.0",
        "fastapi[standard]",
    )
    # Base weights are cached on the volume; the datasets cache must NOT be (a cached copy of old data was reused once).
    .env({"HF_HUB_CACHE": str(VOL / "hf" / "hub"), "HF_DATASETS_CACHE": "/tmp/hf-datasets"})
)
train_image = base_image.add_local_file(DATA_DIR / "train.jsonl", "/data/train.jsonl").add_local_file(
    DATA_DIR / "val.jsonl", "/data/val.jsonl"
)

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
app = modal.App(APP_NAME)


def sha256(path) -> str:
    import hashlib

    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(text: str):
    """Parsed JSON with sorted keys, or None if it does not parse (exact match ignores key order, like eval/scorer.ts)."""
    import json

    try:
        return json.dumps(json.loads(text), sort_keys=True)
    except ValueError:
        return None


@app.function(image=train_image, gpu=GPU, volumes={str(VOL): volume}, timeout=3 * 60 * 60)
def train(expected_sha: dict, epochs: int = 3, lr: float = 2e-4, lora_r: int = 16, val_check: int = 100) -> dict:
    import json

    # Refuse to train on anything but the files on the caller's disk.
    got_sha = {name: sha256(f"/data/{name}") for name in expected_sha}
    print("data sha256:", got_sha)
    assert got_sha == expected_sha, f"stale data in the container: {got_sha} != local {expected_sha}"

    import torch
    from datasets import load_dataset
    from peft import LoraConfig
    from transformers import AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    def to_prompt_completion(ex):
        return {"prompt": ex["messages"][:-1], "completion": ex["messages"][-1:]}

    ds = load_dataset("json", data_files={"train": "/data/train.jsonl", "validation": "/data/val.jsonl"}, download_mode="force_redownload")
    ds = ds.map(to_prompt_completion, remove_columns=["messages"], load_from_cache_file=False)
    lines = Path("/data/train.jsonl").read_text().splitlines()
    assert len(ds["train"]) == len(lines), f"{len(ds['train'])} rows loaded, file has {len(lines)}"
    assert ds["train"][0]["completion"][0]["content"] == json.loads(lines[0])["messages"][-1]["content"], "first row does not match the file"

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    args = SFTConfig(
        output_dir="/tmp/sft",
        num_train_epochs=epochs,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        # Effective batch 16. Small micro-batches + checkpointing keep the 151,936-way loss over ~500-token
        # sequences inside the A10G's 22 GiB (batch 8 ran out of memory on step 0).
        per_device_train_batch_size=2,
        gradient_accumulation_steps=8,
        per_device_eval_batch_size=2,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},  # needed with LoRA (frozen base weights)
        bf16=True,
        max_length=2048,
        packing=False,
        completion_only_loss=True,  # loss on the assistant turn only
        eval_strategy="epoch",
        save_strategy="no",
        logging_steps=20,
        report_to="none",
        seed=42,
        model_init_kwargs={"torch_dtype": torch.bfloat16},
    )
    peft_config = LoraConfig(
        r=lora_r,
        lora_alpha=2 * lora_r,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    trainer = SFTTrainer(
        model=BASE_MODEL,
        args=args,
        train_dataset=ds["train"],
        eval_dataset=ds["validation"],
        processing_class=tokenizer,
        peft_config=peft_config,
    )

    # Check the loss mask: only the assistant JSON (plus the end-of-turn token) may count toward the loss.
    first = trainer.train_dataset[0]
    mask = first["completion_mask"]
    trained = tokenizer.decode([t for t, m in zip(first["input_ids"], mask) if m])
    print(f"loss on {sum(mask)}/{len(mask)} tokens of example 0: {trained!r}")
    assert 0 < sum(mask) < len(mask) / 2, "completion mask looks wrong"
    assert "utterance" not in trained, "the user turn is in the loss"

    trainer.train()
    metrics = trainer.evaluate()

    # Quick held-out check: greedy exact match on the first `val_check` val examples (the real eval is npm run eval).
    model = trainer.model.eval()
    hits = 0
    rows = ds["validation"].select(range(min(val_check, len(ds["validation"]))))
    for row in rows:
        ids = tokenizer.apply_chat_template(row["prompt"], add_generation_prompt=True, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(ids, max_new_tokens=512, do_sample=False)
        pred = tokenizer.decode(out[0, ids.shape[1] :], skip_special_tokens=True)
        hits += canonical(pred) is not None and canonical(pred) == canonical(row["completion"][0]["content"])
    metrics["val_exact_match"] = hits / len(rows)

    ADAPTER_DIR.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(ADAPTER_DIR))  # PEFT model: saves only the adapter
    tokenizer.save_pretrained(str(ADAPTER_DIR))
    run_info = {"base_model": BASE_MODEL, "epochs": epochs, "lr": lr, "lora_r": lora_r, "train_n": len(ds["train"]), "data_sha256": got_sha, "metrics": metrics}
    (ADAPTER_DIR / "run_info.json").write_text(json.dumps(run_info, indent=2))
    volume.commit()
    print(json.dumps(run_info, indent=2))
    return run_info


@app.cls(image=base_image, gpu=GPU, volumes={str(VOL): volume}, scaledown_window=300)
class QwenMapper:
    @modal.enter()
    def load(self):
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(str(ADAPTER_DIR))
        base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.bfloat16, device_map="cuda")
        self.model = PeftModel.from_pretrained(base, str(ADAPTER_DIR)).merge_and_unload().eval()
        import json

        # Which training data this adapter came from, returned with every response so callers can tell runs apart.
        self.adapter_data_sha = json.loads((ADAPTER_DIR / "run_info.json").read_text()).get("data_sha256", {}).get("train.jsonl")

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def generate(self, body: dict) -> dict:
        """POST {"messages": [system, user]} -> {"text": <model output>}. Called by eval/mappers/qwen.ts."""
        import torch
        from fastapi import HTTPException

        messages = body.get("messages")
        if not isinstance(messages, list) or not all(
            isinstance(m, dict) and m.get("role") in ("system", "user") and isinstance(m.get("content"), str) for m in messages
        ):
            raise HTTPException(status_code=400, detail="expected {messages: [{role: system|user, content: str}, ...]}")
        ids = self.tokenizer.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt").to("cuda")
        with torch.no_grad():
            out = self.model.generate(ids, max_new_tokens=512, do_sample=False)
        return {"text": self.tokenizer.decode(out[0, ids.shape[1] :], skip_special_tokens=True), "adapter_data_sha": self.adapter_data_sha}


@app.local_entrypoint()
def main(epochs: int = 3):
    train.remote({name: sha256(DATA_DIR / name) for name in ("train.jsonl", "val.jsonl")}, epochs=epochs)
