import { useEffect, useState, type FormEvent } from "react";
import { PaintWindow } from "../paint/PaintWindow";
import type { PublicState } from "../../party/types";
import { useMic } from "./useMic";
import type { PublicGuess, Secret } from "./useRoom";

type Props = {
  state: PublicState;
  youId: string;
  secret: Secret | null;
  guesses: PublicGuess[];
  send: (body: object) => void;
};

export function Play({ state, youId, secret, guesses, send }: Props) {
  const isYapper = youId === state.yapperId;
  const playing = state.phase === "playing";
  const [typed, setTyped] = useState("");
  const [guess, setGuess] = useState("");
  const [takes, setTakes] = useState<string[]>([]);
  const [heardByIntern, setHeardByIntern] = useState("");

  const { supported, holding, heard, start, stop } = useMic((text) => {
    setTyped(text);
    setTakes((prev) => [...prev, text].slice(-6));
  });

  useEffect(() => {
    setTyped("");
    setTakes([]);
    setHeardByIntern("");
  }, [state.round]);

  useEffect(() => {
    if (holding) setTyped(heard);
  }, [holding, heard]);

  const submitUtterance = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = typed.trim();
    if (!text || !playing) return;
    send({ type: "utterance", text });
    setHeardByIntern((prev) => (prev ? `${prev}, ${text}` : text));
    setTyped("");
  };

  const submitGuess = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = guess.trim();
    if (!text || !playing) return;
    send({ type: "guess", text });
    setGuess("");
  };

  const stickies = guesses
    .filter((g) => !g.correct)
    .slice(-8)
    .map((g) => ({ name: g.name, text: g.text }));

  const yapperName =
    state.players.find((p) => p.id === state.yapperId)?.name ?? "Someone";
  const internHeard = heardByIntern;
  const takeText = holding ? heard : typed;

  return (
    <div className="play">
      {isYapper && secret && (
        <div className="clue-banner">
          <span>Say this. Do not say this.</span>
          <strong>{secret.clue}</strong>
        </div>
      )}
      {!isYapper && (
        <div className="clue-banner guesser">
          <span>{yapperName} is yapping. You only get the picture.</span>
        </div>
      )}

      {state.phase === "countdown" && (
        <div className="countdown" aria-live="assertive">
          {state.timeLeft}
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
        <span className="round-pill">
          Round {state.round}/{state.totalRounds}
        </span>
        <div className="score-pills">
          {state.players.filter((p) => p.connected).map((p) => (
            <span key={p.id} className={p.id === youId ? "you" : ""}>
              {p.name} {p.score}
            </span>
          ))}
        </div>
        <span className={`timer ${state.timeLeft <= 10 && playing ? "panic" : ""}`}>
          {formatTime(state.timeLeft)}
        </span>
      </div>

      {isYapper && (
        <div className="dock yapper-dock">
          <p className="yap-hint">
            One thing at a time. Say what it is or does ("the bright light of daytime"), then change it with "it" ("make it orange").
          </p>
          {supported ? (
            <button
              type="button"
              className={`hold ${holding ? "down" : ""}`}
              disabled={!playing}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                start();
              }}
              onPointerUp={stop}
              onPointerCancel={stop}
            >
              {holding ? "Listening… keep talking, then let go" : "Hold to talk"}
            </button>
          ) : (
            <p className="mic-missing">
              Your browser will not listen. Type like it is 1998.
            </p>
          )}
          <div className={`dictation ${holding ? "live" : ""}`} aria-live="polite">
            <span>{holding ? "Printing:" : "This take:"}</span>
            <p>{takeText || "Hold the button. Words show up here. Delete the junk, then Paint."}</p>
          </div>
          <div className="scene-readout" aria-live="polite">
            <span>Intern heard</span>
            <p>{internHeard || "Nothing painted yet. Leftover words land here after Paint."}</p>
          </div>
          {takes.length > 0 && (
            <ul className="takes">
              {takes.map((take, i) => (
                <li key={`${take}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setTyped(take)}
                    disabled={!playing}
                  >
                    {take}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mic-tip">
            Nothing paints until you hit Paint. Edit the box. Only the leftover words go to the intern.
          </p>
          <form onSubmit={submitUtterance} className="type-row" action="#" method="dialog">
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Only the scene. Cut the ums."
              disabled={!playing}
              rows={2}
              autoCapitalize="off"
            />
            <button type="submit" className="btn" disabled={!playing}>
              Paint
            </button>
          </form>
        </div>
      )}

      {!isYapper && (
        <div className="dock guesser-dock">
          <form onSubmit={submitGuess} className="guess-row" action="#" method="dialog">
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="What is that supposed to be?"
              disabled={!playing}
              autoComplete="off"
              autoCapitalize="off"
            />
            <button type="submit" className="btn primary" disabled={!playing}>
              Guess
            </button>
          </form>
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
