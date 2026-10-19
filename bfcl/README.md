# Small-model function calling on BFCL

Teach a small open model to pick the right tool, fill in its arguments, and **say no when no tool fits**, measured on the public [Berkeley Function-Calling Leaderboard](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard) (BFCL). This is the follow-up to Yap (see ../RESULTS.md): the same skill (structured output, schema, refusals), but on a benchmark someone else wrote.

## Scope
- **Benchmark:** BFCL v4, pinned to `bfcl-eval==2026.3.23`. We run the **13 single-turn categories** (about 3,600 cases):
  - non-live simple (Python, Java, JavaScript), multiple, parallel, parallel multiple, irrelevance
  - live simple, multiple, parallel, parallel multiple, irrelevance, relevance

  Multi-turn is a stretch goal. Agentic (web search, memory) is out of scope.
- **Reporting:** BFCL's "Overall Acc" counts categories that weren't run as 0, so we never quote it. We report BFCL's own **Non-Live** and **Live** sub-scores (complete when all single-turn categories run), every category, and the **single-turn average** (the mean of the two).
- **Base model:** Qwen3-1.7B in native tool-calling ("FC") mode, with Qwen3-0.6B for comparison. BFCL has built-in handlers for both. Qwen2.5 has none, and a custom handler is a silent-bug risk.

## Plan
| phase | what | status |
|---|---|---|
| 0 | Baselines: both base models on all single-turn categories, thinking on and off, inside Modal | done (see below) |
| 1 | Data: an xLAM-60k subset (CC-BY-4.0, gated) in Qwen's tool format, plus synthetic "no tool fits" cases with matching positives, plus a leakage check against BFCL | |
| 2 | First LoRA fine-tune, evaluated with BFCL's vLLM LoRA support | |
| 3 | Error analysis by failure type, then data fixes and 2–3 more runs | |
| 4 | The key experiment: refusal-data share (0/10/20/30%) vs irrelevance and relevance scores | |
| 5 | Optional: model size, multi-turn | |

## Phase 0 results (baselines, no training)

| model | thinking | single-turn avg | Non-Live | Live | minutes (A10G) |
|---|---|---|---|---|---|
| **Qwen3-1.7B (FC)** | **off** | **73.97%** | 81.69% | 66.25% | 5.7 |
| Qwen3-1.7B (FC) | on | 78.47% | 82.25% | 74.69% | 17.1 |
| Qwen3-0.6B (FC) | off | 59.73% | 69.73% | 49.74% | 5.6 |
| Qwen3-0.6B (FC) | on | 65.41% | 72.19% | 58.62% | 11.9 |

- **The comparison baseline is Qwen3-1.7B with thinking off.** The fine-tune is trained in Qwen3's no-think format and compared only against this row. Thinking-on is kept as a reference.
- **Thinking helps calling and hurts refusing.** With thinking on, the 1.7B makes fewer structural mistakes: "wrong number of calls" drops from 137 to 64, "wrong function" from 48 to 29. But it calls a tool when none fits more often: 282 vs 217 failures, with irrelevance at 81.7% vs 86.2% and live irrelevance at 73.1% vs 79.2%.
- **Main failure kinds for 1.7B with thinking off:** wrong value (313; 76 of them format-only where the description states the format), called a tool when none fit (217), wrong number of calls (137).
- **Live relevance is 16 cases** (13/16 for every model), so it's noise. Over-refusal is checked on the in-house dev set instead.
- **Unclosed `<think>` tags cause a negligible 0–6 failures.**
- **Environment, identical for all four:** bfcl-eval 2026.3.23, vLLM 0.8.5, transformers 4.51.3, torch 2.6.0, BFCL data sha256 `fdf6eee576bc…`. The two thinking-on runs had their environment recorded afterwards from the same image; see their `run_info.json`.

Per-category numbers: `python3 bfcl/analyze.py <runs…>`. Raw outputs and BFCL's per-case score files are in `bfcl/runs/<run>/`.

## Running
```sh
modal run bfcl/modal_bfcl.py --check                                                       # CPU-only install check
modal run bfcl/modal_bfcl.py --model Qwen/Qwen3-1.7B-FC --categories single_turn --run <name>
python3 bfcl/summarize.py                                                                  # table of all runs
```
Runs are saved on the `bfcl-runs` Modal volume and copied to `bfcl/runs/<run>/`.

## Environment notes
`bfcl-eval` pins `vllm==0.8.5`. We also pin `transformers==4.51.3`, because newer transformers breaks that vllm, and add `soundfile`, which `qwen_agent` imports but nobody declares.
