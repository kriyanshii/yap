"""Error breakdown for BFCL runs: per-category accuracy and why cases failed.

    python3 bfcl/analyze.py baseline-Qwen3-0.6B-FC-single_turn                 # one run
    python3 bfcl/analyze.py runA runB runC                                       # side by side
    python3 bfcl/analyze.py runA --examples 5                                    # plus sample failures

Runs are read from bfcl/runs/<run>/; if BFCL's per-case score files are missing there, the full run folder is
downloaded from the "bfcl-runs" Modal volume first (needs the modal CLI). Nothing here uses a GPU.
"""

import argparse
import collections
import json
import re
import shutil
import subprocess
from pathlib import Path

RUNS = Path(__file__).parent / "runs"
MODAL = shutil.which("modal") or str(Path.home() / ".local/bin/modal")
CATEGORIES = ["simple_python", "simple_java", "simple_javascript", "multiple", "parallel", "parallel_multiple",
              "irrelevance", "live_simple", "live_multiple", "live_parallel", "live_parallel_multiple",
              "live_irrelevance", "live_relevance"]
VALUE_RE = re.compile(r"Invalid value for parameter '([^']+)': (.+?)\. Expected one of (\[.*\])\.")
FORMAT_HINT = re.compile(r"format|e\.g\.|such as|for example|example:|in the form|like '|yyyy|iso ?8601", re.I)


def bucket(error_type: str) -> str:
    """Groups BFCL error types into the failure kinds that matter for training data."""
    if error_type.startswith("irrelevance_error"):
        return "called a tool when none fit"
    if error_type.startswith("relevance_error"):
        return "refused when a tool fit"
    if error_type.endswith("wrong_func_name"):
        return "wrong function"
    if error_type.endswith("cannot_find_match"):
        return "parallel calls don't match"
    if error_type.endswith("wrong_count"):
        return "wrong number of calls"
    if error_type.endswith(("missing_required", "missing_optional", "unexpected_param")):
        return "missing or extra argument"
    if error_type.startswith("type_error"):
        return "wrong type"
    if error_type.startswith("value_error"):
        return "wrong value"
    if "decoder" in error_type or error_type.startswith("ast_decoder"):
        return "unparseable or no call"
    return f"other ({error_type})"


def value_kind(f: dict) -> str | None:
    """Splits 'wrong string value' failures: format-only, the 'dontcare' convention, non-English, or semantic."""
    if f.get("error_type") != "value_error:string" or not f.get("error"):
        return None
    m = VALUE_RE.search(f["error"][0])
    if not m:
        return "string: unparsed"
    name, got, expected = m.group(1), m.group(2).strip("'\""), m.group(3)
    try:
        exp = [str(e).lower() for e in json.loads(expected.replace("'", '"'))]
    except json.JSONDecodeError:
        exp = [expected.lower()]
    g = got.lower()
    if any(ord(ch) > 127 for ch in got):
        return "string: non-English"
    if "dontcare" in exp or g == "dontcare":
        return "string: 'dontcare' convention"
    if any(e and (g in e or e in g) for e in exp):
        desc = " ".join(p.get("description", "") for fn in f.get("prompt", {}).get("function", [])
                        for k, p in fn.get("parameters", {}).get("properties", {}).items() if k == name)
        return "string: format only (format in description)" if FORMAT_HINT.search(desc) else "string: format only"
    return "string: different value"


def ensure_local(run: str) -> Path:
    path = RUNS / run
    if not list(path.glob("score/*/*/BFCL_v4_*_score.json")):
        path.mkdir(parents=True, exist_ok=True)
        tmp = RUNS / f".dl-{run}"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        subprocess.run([MODAL, "volume", "get", "bfcl-runs", f"runs/{run}", str(tmp)], check=True, capture_output=True)
        src = tmp / run
        for item in src.iterdir():
            if item.name == ".file_locks":
                continue
            dest = path / item.name
            if dest.exists():
                shutil.rmtree(dest) if dest.is_dir() else dest.unlink()
            shutil.move(str(item), dest)
        shutil.rmtree(tmp)
    return path


def load(run: str) -> dict:
    path = ensure_local(run)
    out = {"categories": {}, "buckets": collections.Counter(), "values": collections.Counter(), "think": 0, "fails": []}
    for cat in CATEGORIES:
        files = list(path.glob(f"score/*/*/BFCL_v4_{cat}_score.json"))
        if not files:
            continue
        lines = [json.loads(l) for l in files[0].read_text().splitlines() if l.strip()]
        head, fails = lines[0], lines[1:]
        out["categories"][cat] = (head["correct_count"], head["total_count"])
        for f in fails:
            f["_category"] = cat
            out["buckets"][(cat, bucket(f.get("error_type", "?")))] += 1
            if (vk := value_kind(f)):
                out["values"][vk] += 1
            if "<think>" in json.dumps(f.get("model_result_raw", f.get("model_result", ""))):
                out["think"] += 1
        out["fails"].extend(fails)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--examples", type=int, default=0, help="print N sample failures per failure kind (first run)")
    args = ap.parse_args()
    data = {r: load(r) for r in args.runs}
    names = list(data)

    print("### Accuracy by category\n")
    print("| category | n | " + " | ".join(names) + " |")
    print("|---|---|" + "---|" * len(names))
    for cat in CATEGORIES:
        row = [data[r]["categories"].get(cat) for r in names]
        if not any(row):
            continue
        n = next(c[1] for c in row if c)
        print(f"| {cat} | {n} | " + " | ".join(f"{100 * c[0] / c[1]:.1f}%" if c else "-" for c in row) + " |")

    print("\n### Failures by kind (all single-turn categories)\n")
    kinds = sorted({k for r in names for (_, k) in data[r]["buckets"]})
    print("| failure kind | " + " | ".join(names) + " |")
    print("|---|" + "---|" * len(names))
    for k in kinds:
        print(f"| {k} | " + " | ".join(str(sum(v for (c, kk), v in data[r]["buckets"].items() if kk == k)) for r in names) + " |")

    print("\n### live_multiple failures by kind\n")
    lm = sorted({k for r in names for (c, k) in data[r]["buckets"] if c == "live_multiple"})
    print("| failure kind | " + " | ".join(names) + " |")
    print("|---|" + "---|" * len(names))
    for k in lm:
        print(f"| {k} | " + " | ".join(str(data[r]["buckets"].get(("live_multiple", k), 0)) for r in names) + " |")

    print("\n### 'Wrong string value' failures split (all categories)\n")
    vks = sorted({k for r in names for k in data[r]["values"]})
    print("| kind | " + " | ".join(names) + " |")
    print("|---|" + "---|" * len(names))
    for k in vks:
        print(f"| {k} | " + " | ".join(str(data[r]["values"].get(k, 0)) for r in names) + " |")
    print("| failures with '<think>' left in the output | " + " | ".join(str(data[r]["think"]) for r in names) + " |")

    if args.examples:
        print(f"\n### Sample failures ({names[0]})\n")
        seen = collections.Counter()
        for f in data[names[0]]["fails"]:
            k = bucket(f.get("error_type", "?"))
            if seen[k] < args.examples:
                seen[k] += 1
                print(f"- [{f['_category']}] {k}: {'; '.join(map(str, f.get('error', [])))[:180]}")


if __name__ == "__main__":
    main()
