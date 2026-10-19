import { useEffect, useRef, useState, type FormEvent } from "react";
import { PaintWindow } from "../paint/PaintWindow";
import type { PublicState } from "../../party/types";
import { useMic } from "./useMic";
import type { PublicGuess, Secret, YapResult } from "./useRoom";

type Props = {
  state: PublicState;
  youId: string;
  secret: Secret | null;
  guesses: PublicGuess[];
  yapResult: YapResult | null;
  send: (body: object) => void;
  onHelp: () => void;
};

const EXAMPLES = ["the animal that purrs", "the bright light of daytime", "make it blue", "make it bigger", "move it to the left", "undo"];
const STATUS_ICON: Record<string, string> = { drew: "✅", guess: "🎲", nothing: "🤔", failed: "⚠️" };

export function Play({ state, youId, secret, guesses, yapResult, send, onHelp }: Props) {
  const isYapper = youId === state.yapperId;
  const playing = state.phase === "playing";
  const me = state.players.find((p) => p.id === youId);
  const yapperName = state.players.find((p) => p.id === state.yapperId)?.name ?? "Someone";

  const [typed, setTyped] = useState("");
  const [guess, setGuess] = useState("");
  const [said, setSaid] = useState<string[]>([]);
  const [pendingAt, setPendingAt] = useState<number | null>(null);
  const [lastGuess, setLastGuess] = useState<string | null>(null);
  const resultCount = useRef(0);

  const { supported, holding, heard, start, stop } = useMic((text) => setTyped(text));

  useEffect(() => {
    setTyped("");
    setSaid([]);
    setPendingAt(null);
    setLastGuess(null);
  }, [state.round]);

  useEffect(() => {
    if (holding) setTyped(heard);
  }, [holding, heard]);

  // A new result from the server ends the "Drawing…" state.
  useEffect(() => {
    if (yapResult && yapResult.n !== resultCount.current) {
      resultCount.current = yapResult.n;
      setPendingAt(null);
    }
  }, [yapResult]);

  const submitUtterance = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || !playing) return;
    send({ type: "utterance", text });
    setSaid((prev) => [...prev, text]);
    setPendingAt(Date.now());
    setTyped("");
  };

  const submitGuess = (e: FormEvent) => {
    e.preventDefault();
    const text = guess.trim();
    if (!text || !playing) return;
    send({ type: "guess", text });
    setLastGuess(text);
    setGuess("");
  };

  const myLastGuess = lastGuess ? [...guesses].reverse().find((g) => g.name === me?.name && g.text === lastGuess) : undefined;
  const stickies = guesses.filter((g) => !g.correct).slice(-8).map((g) => ({ name: g.name, text: g.text }));

  return (
    <div className="play">
      {isYapper && secret ? (
        <section className="secret-card" aria-label="Your secret scene">
          <div className="secret-head">
            <span className="role-tag yapper">You're the Yapper</span>
            <button type="button" className="help-link" onClick={onHelp}>How to play</button>
          </div>
          <span className="secret-label">Describe this scene</span>
          <strong className="secret-scene" data-secret>{secret.clue}</strong>
          <div className="banned-row">
            <span>Don't say:</span>
            {secret.banned.map((w) => (
              <b key={w} className="banned-chip">{w}</b>
            ))}
          </div>
        </section>
      ) : (
        <section className="secret-card guesser" aria-label="Your role">
          <div className="secret-head">
            <span className="role-tag guesser">You're guessing</span>
            <button type="button" className="help-link" onClick={onHelp}>How to play</button>
          </div>
          <p className="guesser-line">
            <b>{yapperName}</b> is describing a secret scene. Guess <b>every object and colour</b> in the picture.
          </p>
        </section>
      )}

      {state.phase === "countdown" && (
        <div className="countdown" aria-live="assertive">
          <span>{isYapper ? "You're up! Get ready to describe…" : `${yapperName} is about to describe…`}</span>
          <b>{state.timeLeft}</b>
        </div>
      )}

      <PaintWindow
        filename="untitled.bmp"
        prompt={state.prompt}
        seed={state.seed}
        generation={state.paintingGeneration}
        paintStartedAt={state.paintStartedAt}
        drawingOps={state.drawingOps ?? []}
        sceneMode={state.sceneMode}
        painting={false}
        stickies={stickies}
      />

      <div className="timer-row">
        <span className="round-pill">Round {state.round}/{state.totalRounds}</span>
        <div className="score-pills">
          {state.players.filter((p) => p.connected).map((p) => (
            <span key={p.id} className={p.id === youId ? "you" : ""}>
              {p.name} {p.score}
            </span>
          ))}
        </div>
        <span className={`timer ${state.timeLeft <= 10 && playing ? "panic" : ""}`} aria-label="Time left">
          {formatTime(state.timeLeft)}
        </span>
      </div>

      {isYapper && (
        <div className="dock yapper-dock">
          <form onSubmit={submitUtterance} className="yap-row" data-role="yap">
            {supported && (
              <button
                type="button"
                className={`mic ${holding ? "down" : ""}`}
                disabled={!playing}
                aria-label={holding ? "Listening, release to stop" : "Hold to talk"}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  start();
                }}
                onPointerUp={stop}
                onPointerCancel={stop}
              >
                <span aria-hidden>🎤</span>
                <small>{holding ? "Listening…" : "Hold"}</small>
              </button>
            )}
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={supported ? "Hold 🎤 and talk, or type here…" : "Type what to draw…"}
              disabled={!playing}
              rows={2}
              autoCapitalize="off"
              aria-label="What to draw"
            />
            <button type="submit" className="btn primary draw-btn" disabled={!playing || !typed.trim()}>
              Draw
            </button>
          </form>

          <p className={`yap-status ${pendingAt ? "pending" : yapResult ? `is-${yapResult.status}` : ""}`} aria-live="polite">
            {pendingAt
              ? "🖌️ Drawing…"
              : yapResult
                ? `${STATUS_ICON[yapResult.status]} ${yapResult.text}`
                : "Tip: one thing at a time. Say what it is or does, then change it with \"it\"."}
          </p>

          {said.length > 0 && (
            <div className="said-list">
              <span>You said:</span>
              {said.slice(-6).map((t, i) => (
                <q key={`${t}-${i}`}>{t}</q>
              ))}
            </div>
          )}

          <details className="examples">
            <summary>Example phrases</summary>
            <div className="example-chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setTyped(ex)} disabled={!playing}>
                  {ex}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}

      {!isYapper && (
        <div className="dock guesser-dock">
          <form onSubmit={submitGuess} className="guess-row" data-role="guess">
            <input
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder='e.g. "a blue cat under a tree"'
              disabled={!playing}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="Your guess"
            />
            <button type="submit" className="btn primary" disabled={!playing || !guess.trim()}>
              Guess
            </button>
          </form>
          <p className="yap-status" aria-live="polite">
            {myLastGuess && !myLastGuess.correct
              ? `❌ "${myLastGuess.text}" isn't it. Name every object and colour you see.`
              : "Name everything in the picture, with colours. Guess as often as you like."}
          </p>
        </div>
      )}
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
