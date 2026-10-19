"""Builds the function-calling training mix from Salesforce xLAM-60k (CC-BY-4.0; gated: accept its terms first).

    python3 bfcl/make_data.py --n 20000 --refusal-share 0.15 --seed 0

Writes bfcl/data/mix/{train,dev}.jsonl (gitignored) and stats.json. Each line is neutral, not a prompt:
    {"id", "kind", "pair", "query", "tools" (BFCL function-doc format), "calls" ([{name: {args}}] or [] for "no tool fits"),
     "format_described"}
The training job turns these into prompts with BFCL's own Qwen formatter, so training and evaluation prompts match.

The mix:
- Positives from xLAM, converted to BFCL's function-doc format. Examples where an argument's parameter description
  states a value format ("e.g. 'City, ST'", "YYYY-MM-DD", ...) are tagged and kept preferentially: following the
  described format is the top fixable failure in the baseline (live_multiple "wrong value").
- Refusals ("no tool fits"), each with a MATCHING POSITIVE: the same query with the needed tool removed (target: no
  call) next to the original (target: the call). One-sided refusal data made Yap over-refuse; pairs prevent that.
- Leakage check: xLAM queries sharing an 8-word shingle (or an exact normalized match) with any BFCL test question are
  dropped. The dev split is held out from xLAM; its positives double as the in-house relevance check (over-refusal).
Java, JavaScript and BFCL's 'dontcare' convention are deliberately not targeted (benchmark quirks, not skills).
"""

import argparse
import glob
import json
import random
import re
from pathlib import Path

HERE = Path(__file__).parent
XLAM = HERE / "data" / "xlam" / "xlam_function_calling_60k.json"
OUT = HERE / "data" / "mix"
FORMAT_HINT = re.compile(r"format|e\.g\.|such as|for example|example:|in the form|like '|yyyy|iso ?8601", re.I)
REFUSALS = [
    "None of the available functions can do that.",
    "I can't help with that using the tools I have.",
    "The provided functions don't cover this request.",
    "There is no suitable function for this request.",
    "None of these tools can answer that.",
]
TYPE_MAP = {"str": "string", "string": "string", "int": "integer", "integer": "integer", "float": "float",
            "number": "float", "bool": "boolean", "boolean": "boolean", "dict": "dict", "list": "array",
            "tuple": "tuple", "set": "array", "any": "any", "callable": "any", "object": "dict"}


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", text.lower())).strip()


def shingles(text: str, k: int = 8) -> set[str]:
    w = norm(text).split()
    return {" ".join(w[i:i + k]) for i in range(max(0, len(w) - k + 1))}


def bfcl_type(xtype: str) -> tuple[str, bool]:
    """xLAM types like 'str', 'List[int]', 'str, optional' -> (BFCL type, optional)."""
    t = xtype.strip()
    optional = ", optional" in t.lower()
    base = t.split(",")[0].strip().lower()
    base = re.sub(r"^(typing\.)?optional\[(.*)\]$", r"\2", base)
    head = re.split(r"[\[\s]", base)[0]
    return TYPE_MAP.get(head, "string"), optional


def to_bfcl_tool(tool: dict) -> dict:
    props, required = {}, []
    for name, p in (tool.get("parameters") or {}).items():
        btype, optional = bfcl_type(str(p.get("type", "str")))
        prop = {"type": btype, "description": str(p.get("description", ""))}
        if not optional:
            required.append(name)
        elif p.get("default") not in (None, ""):
            prop["default"] = p["default"]
        props[name] = prop
    return {"name": tool["name"], "description": tool.get("description", ""),
            "parameters": {"type": "dict", "properties": props, "required": required}}


def format_described(tools: list[dict], calls: list[dict]) -> bool:
    """True if some argument the answer uses has a parameter description that states a value format."""
    by_name = {t["name"]: t for t in tools}
    for call in calls:
        (fname, args), = call.items()
        props = by_name.get(fname, {}).get("parameters", {}).get("properties", {})
        if any(FORMAT_HINT.search(props.get(a, {}).get("description", "")) for a in args):
            return True
    return False


def bfcl_questions() -> list[str]:
    """All BFCL v4 single-turn test questions, from the installed bfcl-eval package or a local copy of its data."""
    roots = glob.glob(str(HERE / "data" / "bfcl_eval_data")) + glob.glob("/tmp/bfcl-pkg/bfcl_eval/data")
    if not roots:
        raise SystemExit("BFCL test data not found: copy bfcl_eval/data to bfcl/data/bfcl_eval_data (see --help)")
    qs = []
    for f in glob.glob(f"{roots[0]}/BFCL_v4_*.json"):
        if any(k in f for k in ("multi_turn", "memory", "web_search", "format_sensitivity")):
            continue
        for line in open(f):
            if line.strip():
                for turn in json.loads(line).get("question", []):
                    qs += [m["content"] for m in turn if m.get("role") == "user" and isinstance(m.get("content"), str)]
    return qs


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=20000, help="training examples (positives + refusals)")
    ap.add_argument("--dev", type=int, default=1000, help="held-out dev examples (half refusal pairs)")
    ap.add_argument("--refusal-share", type=float, default=0.15, help="share of training examples that are refusals")
    ap.add_argument("--format-share", type=float, default=0.4, help="target share of positives with a described format")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    raw = json.loads(XLAM.read_text())
    bench = bfcl_questions()
    bench_norm = {norm(q) for q in bench}
    bench_sh = set().union(*(shingles(q) for q in bench))

    pool, leaked = [], 0
    for ex in raw:
        q = ex["query"]
        if norm(q) in bench_norm or shingles(q) & bench_sh:
            leaked += 1
            continue
        tools = [to_bfcl_tool(t) for t in json.loads(ex["tools"])]
        calls = [{a["name"]: a.get("arguments", {})} for a in json.loads(ex["answers"])]
        pool.append({"id": f"xlam-{ex['id']}", "query": q, "tools": tools, "calls": calls,
                     "format_described": format_described(tools, calls)})
    rng.shuffle(pool)

    def refusal_of(ex: dict) -> dict | None:
        """The same query with every tool its answer uses removed; padded with distractors from other examples."""
        used = {next(iter(c)) for c in ex["calls"]}
        rest = [t for t in ex["tools"] if t["name"] not in used]
        while len(rest) < 2:
            other = rng.choice(pool)
            cand = [t for t in other["tools"] if t["name"] not in used and t["name"] not in {r["name"] for r in rest}]
            if cand:
                rest.append(rng.choice(cand))
        rng.shuffle(rest)
        return {"id": ex["id"] + "-refusal", "query": ex["query"], "tools": rest, "calls": [],
                "refusal_text": rng.choice(REFUSALS), "format_described": False}

    def take(n: int, refusal_share: float, start: int) -> tuple[list[dict], int]:
        """n examples: refusal pairs (refusal + its positive) plus extra positives, format-described preferred."""
        n_ref = round(n * refusal_share)
        n_pos = n - n_ref
        i, out = start, []
        for k in range(n_ref):  # each refusal brings its matching positive (counted among the positives)
            ex = pool[i]; i += 1
            out += [{**ex, "kind": "positive", "pair": f"p{start}-{k}"},
                    {**refusal_of(ex), "kind": "refusal", "pair": f"p{start}-{k}"}]
        want_fmt = round((n_pos - n_ref) * args.format_share)
        fmt, other = [], []
        while len(fmt) + len(other) < n_pos - n_ref and i < len(pool):
            ex = pool[i]; i += 1
            if ex["format_described"] and len(fmt) < want_fmt:
                fmt.append({**ex, "kind": "positive", "pair": None})
            elif not ex["format_described"] and len(other) < (n_pos - n_ref) - want_fmt:
                other.append({**ex, "kind": "positive", "pair": None})
        out += fmt + other
        rng.shuffle(out)
        return out, i

    dev, nxt = take(args.dev, 0.5, 0)
    train, _ = take(args.n, args.refusal_share, nxt)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train", train), ("dev", dev)):
        with open(OUT / f"{name}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    def summary(rows):
        pos = [r for r in rows if r["kind"] == "positive"]
        return {"examples": len(rows), "positives": len(pos), "refusals": len(rows) - len(pos),
                "paired_positives": sum(1 for r in pos if r["pair"]),
                "format_described_positives": sum(r["format_described"] for r in pos),
                "parallel_same_fn": sum(1 for r in pos if len(r["calls"]) > 1 and len({next(iter(c)) for c in r["calls"]}) == 1),
                "multiple_fns": sum(1 for r in pos if len({next(iter(c)) for c in r["calls"]}) > 1)}
    stats = {"args": vars(args), "xlam_examples": len(raw), "dropped_for_leakage": leaked, "bfcl_questions": len(bench),
             "train": summary(train), "dev": summary(dev)}
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
