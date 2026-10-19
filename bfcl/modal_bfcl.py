"""BFCL (Berkeley Function-Calling Leaderboard) runs on Modal: generate + evaluate in one GPU job.

Phase 0, baselines (no training):
    modal run bfcl/modal_bfcl.py --model Qwen/Qwen3-0.6B-FC --categories simple_python        # smoke test
    modal run bfcl/modal_bfcl.py --model Qwen/Qwen3-1.7B-FC --categories single_turn

Results and scores are saved per run on the "bfcl-runs" volume (runs/<run>/{result,score}) and the score
tables are printed. bfcl-eval is pinned so every score is tied to one BFCL version.
"""

import json
import subprocess
import time
from pathlib import Path

import modal

BFCL_VERSION = "2026.3.23"
VOL = Path("/vol")
GPU = "A10G"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libsndfile1")
    # soundfile: imported by qwen_agent (a bfcl-eval dependency) but declared by neither package.
    # transformers: bfcl-eval pins vllm==0.8.5, which breaks on transformers 5+/6+; 4.51.x is its era and supports Qwen3.
    .pip_install(f"bfcl-eval[oss-eval-vllm]=={BFCL_VERSION}", "soundfile", "transformers==4.51.3")
    .env({"HF_HUB_CACHE": str(VOL / "hf" / "hub"), "TOKENIZERS_PARALLELISM": "false"})
    .add_local_file(Path(__file__).parent / "bfcl_cli.py", "/root/bfcl_cli.py")  # bfcl CLI + "-nothink" model entries
)
BFCL = ["python", "/root/bfcl_cli.py"]
volume = modal.Volume.from_name("bfcl-runs", create_if_missing=True)
app = modal.App("bfcl-small")


# Generation settings that must match between the baseline and the fine-tune for scores to be comparable.
# Thinking mode: BFCL's QwenFCHandler (bfcl_eval/model_handler/local_inference/qwen_fc.py) ends the prompt with an open
# "<|im_start|>assistant\n" (not the empty "<think>\n\n</think>" block that disables thinking), so Qwen3 thinks, and the
# reasoning is stripped before scoring. Temperature is BFCL's default (0.001); max tokens = the context left after the prompt.
GEN_SETTINGS = {
    "backend": "vllm",
    "handler": "QwenFCHandler (BFCL built-in, FC mode)",
    "thinking_mode": "per model: '-FC' = on (BFCL default: prompt ends with an open assistant turn; reasoning stripped before "
                     "scoring); '-FC-nothink' = off (prompt ends with the empty <think></think> block, as Qwen3's "
                     "enable_thinking=False template; see bfcl_cli.py)",
    "temperature": 0.001,
    "max_tokens": "context remaining after the prompt (BFCL default)",
}

ENV_PROBE = (
    "import json, importlib.metadata as m, hashlib, pathlib, bfcl_eval;"
    "pkgs = ['bfcl-eval', 'vllm', 'transformers', 'tokenizers', 'torch', 'qwen-agent'];"
    "v = {};\nfor p in pkgs:\n    try: v[p] = m.version(p)\n    except m.PackageNotFoundError: v[p] = None\n"
    "data = pathlib.Path(bfcl_eval.__file__).parent / 'data';"
    "h = hashlib.sha256(b''.join(f.read_bytes() for f in sorted(data.glob('BFCL_v4_*.json'))));"
    "v['bfcl_data_sha256'] = h.hexdigest();"
    "print(json.dumps(v))"
)


def environment() -> dict:
    """Exact package versions in this container, plus a hash of BFCL's test data files."""
    out = subprocess.run(["python", "-c", ENV_PROBE], capture_output=True, text=True)
    return json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 else {"error": out.stderr[-500:]}


def sh(cmd: list[str], cwd: Path) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


@app.function(image=image, timeout=10 * 60)
def check_install() -> str:
    """CPU-only: confirms bfcl imports and lists its categories, before paying for a GPU."""
    versions = subprocess.run(["python", "-c", "import vllm, transformers, tokenizers, torch; "
                               "print('vllm', vllm.__version__, '| transformers', transformers.__version__, "
                               "'| tokenizers', tokenizers.__version__, '| torch', torch.__version__)"],
                              capture_output=True, text=True)
    out = subprocess.run(["bfcl", "test-categories"], capture_output=True, text=True)
    return versions.stdout + versions.stderr[-1500:] + out.stdout[-300:] + out.stderr[-3000:]


@app.function(image=image, gpu=GPU, volumes={str(VOL): volume}, timeout=4 * 60 * 60)
def run_bfcl(model: str, categories: str, run: str) -> dict:
    """Generates and evaluates `model` on `categories` (comma-separated BFCL categories or groups)."""
    import os

    root = VOL / "runs" / run
    root.mkdir(parents=True, exist_ok=True)
    os.environ["BFCL_PROJECT_ROOT"] = str(root)  # result/ and score/ go here
    cats = [c.strip() for c in categories.split(",") if c.strip()]
    started = time.time()

    sh([*BFCL, "generate", "--model", model, "--test-category", *cats,
        "--backend", "vllm", "--num-gpus", "1", "--gpu-memory-utilization", "0.9"], cwd=root)
    gen_min = (time.time() - started) / 60
    sh([*BFCL, "evaluate", "--model", model, "--test-category", *cats], cwd=root)

    scores = {p.name: p.read_text() for p in sorted((root / "score").glob("*.csv"))}
    info = {"model": model, "categories": cats, "run": run, "bfcl_version": BFCL_VERSION, "gpu": GPU,
            "generation": GEN_SETTINGS, "environment": environment(),
            "generate_minutes": round(gen_min, 1), "total_minutes": round((time.time() - started) / 60, 1)}
    (root / "run_info.json").write_text(json.dumps(info, indent=2))
    volume.commit()
    return {"info": info, "scores": scores}


@app.function(image=image, volumes={str(VOL): volume}, timeout=10 * 60)
def record_environment(runs: list[str]) -> dict:
    """Adds the environment and generation settings to runs that were launched before run_info recorded them.
    Same image as those runs (unchanged since), so the versions are theirs; marked as recorded afterwards."""
    env = environment()
    updated = {}
    for run in runs:
        path = VOL / "runs" / run / "run_info.json"
        if not path.exists():
            continue
        info = json.loads(path.read_text())
        info.update({"generation": GEN_SETTINGS, "environment": env,
                     "environment_note": "recorded after the run, from the same image (image unchanged since the run)"})
        path.write_text(json.dumps(info, indent=2))
        updated[run] = info
    volume.commit()
    return updated


@app.local_entrypoint()
def main(model: str = "Qwen/Qwen3-0.6B-FC", categories: str = "simple_python", run: str = "", check: bool = False,
         record_env: str = ""):
    if check:
        print(check_install.remote())
        return
    if record_env:  # comma-separated run names
        for name, info in record_environment.remote(record_env.split(",")).items():
            local = Path(__file__).parent / "runs" / name
            local.mkdir(parents=True, exist_ok=True)
            (local / "run_info.json").write_text(json.dumps(info, indent=2))
            print(f"{name}: {json.dumps(info['environment'])}")
        return
    run = run or f"{model.split('/')[-1]}-{categories.replace(',', '+')}-{time.strftime('%Y%m%d-%H%M%S')}"
    out = run_bfcl.remote(model, categories, run)
    print(json.dumps(out["info"], indent=2))
    for name, csv in out["scores"].items():
        print(f"\n== {name}\n{csv}")
    local = Path(__file__).parent / "runs" / run
    local.mkdir(parents=True, exist_ok=True)
    (local / "run_info.json").write_text(json.dumps(out["info"], indent=2))
    for name, csv in out["scores"].items():
        (local / name).write_text(csv)
    print(f"saved scores to {local}")
