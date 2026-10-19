"""Summarise BFCL single-turn runs saved under bfcl/runs/ as a markdown table.

BFCL's "Overall Acc" counts categories that weren't run as 0, so it is meaningless for single-turn-only runs. This
reports BFCL's own Non-Live and Live sub-scores (complete when all single-turn categories ran), each category, and
"single-turn avg" = the mean of those two official numbers.

    python3 bfcl/summarize.py            # all runs
    python3 bfcl/summarize.py baseline   # runs whose name contains "baseline"
"""

import csv
import json
import sys
from pathlib import Path

RUNS = Path(__file__).parent / "runs"
COLUMNS = [  # (label, csv file, column)
    ("Non-Live", "data_non_live.csv", "Non-Live Overall Acc"),
    ("Live", "data_live.csv", "Live Overall Acc"),
    ("simple (py)", "data_non_live.csv", "Python Simple AST"),
    ("simple (java)", "data_non_live.csv", "Java Simple AST"),
    ("simple (js)", "data_non_live.csv", "JavaScript Simple AST"),
    ("multiple", "data_non_live.csv", "Multiple AST"),
    ("parallel", "data_non_live.csv", "Parallel AST"),
    ("parallel multiple", "data_non_live.csv", "Parallel Multiple AST"),
    ("irrelevance", "data_non_live.csv", "Irrelevance Detection"),
    ("live simple", "data_live.csv", "Python Simple AST"),
    ("live multiple", "data_live.csv", "Python Multiple AST"),
    ("live parallel", "data_live.csv", "Python Parallel AST"),
    ("live parallel multiple", "data_live.csv", "Python Parallel Multiple AST"),
    ("live irrelevance", "data_live.csv", "Irrelevance Detection"),
    ("live relevance", "data_live.csv", "Relevance Detection"),
]


def read_row(path: Path) -> dict:
    """First data row. BFCL writes CSVs unquoted, so a model name containing a comma spills into extra fields;
    those are folded back into the Model column."""
    with path.open() as f:
        rows = list(csv.reader(f))
    if len(rows) < 2:
        return {}
    header, row = rows[0], rows[1]
    extra = len(row) - len(header)
    if extra > 0:
        i = header.index("Model")
        row = row[:i] + [",".join(row[i:i + extra + 1])] + row[i + extra + 1:]
    return dict(zip(header, row))


def pct(v: str) -> float | None:
    return float(v.rstrip("%")) if v and v != "N/A" else None


def main(filter_: str = "") -> None:
    runs = sorted(p for p in RUNS.iterdir() if p.is_dir() and filter_ in p.name)
    header = ["run", "model", "single-turn avg"] + [c[0] for c in COLUMNS] + ["minutes"]
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for run in runs:
        csv_dir = run if (run / "data_non_live.csv").exists() else run / "score"  # full downloads keep CSVs in score/
        if not (csv_dir / "data_non_live.csv").exists():
            continue
        info = json.loads((run / "run_info.json").read_text())
        files = {f: read_row(csv_dir / f) for f in {c[1] for c in COLUMNS}}
        vals = [files[f].get(col, "N/A") for _, f, col in COLUMNS]
        nl, live = pct(vals[0]), pct(vals[1])
        avg = f"{(nl + live) / 2:.2f}%" if nl is not None and live is not None and "single_turn" in info["categories"] else "n/a"
        print("| " + " | ".join([run.name, info["model"], avg, *vals, str(info.get("total_minutes", ""))]) + " |")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
