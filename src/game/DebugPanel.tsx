import { useState } from "react";
import type { DebugEntry } from "../../party/types";

const MAPPER_LABEL: Record<string, string> = { qwen: "Qwen 1.5B", gemini: "Gemini", keyword: "keyword" };

/** Host-only: which mapper answered each utterance, how fast, and the ops it produced. Rendered only when the host isn't guessing. */
export function DebugPanel({ entries }: { entries: DebugEntry[] }) {
  const [open, setOpen] = useState(true);
  const recent = [...entries].reverse().slice(0, 30);

  return (
    <aside className={`debug-panel paint-window ${open ? "" : "collapsed"}`} aria-label="Mapper debug log">
      <div className="title-bar">
        <span className="title-icon" aria-hidden />
        <span className="title-text">mapper.log (host only)</span>
        <div className="caption-btns">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"}>
            {open ? "_" : "□"}
          </button>
        </div>
      </div>
      {open && (
        <ol className="debug-list">
          {recent.length === 0 && <li className="debug-empty">No utterances yet.</li>}
          {recent.map((e, i) => (
            <li key={`${e.round}-${entries.length - i}`} className={e.mapper ? `debug-${e.mapper}` : "debug-failed"}>
              <div className="debug-head">
                <span className="debug-mapper">{e.mapper ? MAPPER_LABEL[e.mapper] : e.note === "warm-up" ? "warm-up" : "all failed"}</span>
                <span className="debug-ms">{e.ms} ms</span>
                <span className="debug-round">R{e.round}</span>
              </div>
              <div className="debug-utt">{e.utterance}</div>
              {e.attempts.length > 1 && (
                <div className="debug-chain">
                  {e.attempts.map((a) => `${a.mapper} ${a.outcome.replace("_", " ")}${a.ms ? ` ${a.ms}ms` : ""}`).join(" → ")}
                </div>
              )}
              {e.note !== "warm-up" && <code className="debug-ops">{JSON.stringify(e.ops)}</code>}
              {e.note === "warm-up" && <div className="debug-chain">{e.raw}</div>}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
