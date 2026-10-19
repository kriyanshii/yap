import { sillyFilename } from "../../party/match";
import { PaintWindow } from "../paint/PaintWindow";
import type { PublicState } from "../../party/types";
import type { PublicGuess } from "./useRoom";

type Props = {
  state: PublicState;
  youId: string;
  guesses: PublicGuess[];
  isHost: boolean;
  onAgain: () => void;
};

export function Reveal({ state, youId, guesses, isHost, onAgain }: Props) {
  const reveal = state.reveal;
  const filename = sillyFilename(reveal?.clue ?? "untitled");
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  const winners = sorted.filter((p) => p.score === top && top > 0);
  const tied = winners.length > 1;
  const gameover = state.phase === "gameover";
  const you = state.players.find((p) => p.id === youId);

  return (
    <div className={`reveal ${gameover ? "gameover" : ""}`}>
      {gameover ? (
        <header className="brand compact">
          <h1>Game over</h1>
          {tied || winners.length === 0 ? (
            <p className="roast">Paint chaos. You all lose-win.</p>
          ) : (
            <p className="roast">
              {winners[0].name} wins. The rest of you were decorative.
            </p>
          )}
        </header>
      ) : (
        <header className="brand compact">
          <p className="reason">{reasonLabel(reveal?.reason)}</p>
          <h2 className="clue-reveal">{reveal?.clue ?? "???"}</h2>
          <p className="roast">{reveal?.roast}</p>
          {state.prompt ? (
            <p className="said-line">They told the intern: {state.prompt}</p>
          ) : null}
        </header>
      )}

      <PaintWindow
        filename={filename}
        prompt={state.prompt}
        seed={state.seed}
        generation={state.paintingGeneration}
        paintStartedAt={state.paintStartedAt}
        drawingOps={state.drawingOps ?? []}
        painting={false}
        stickies={guesses
          .filter((g) => !g.correct)
          .slice(-6)
          .map((g) => ({ name: g.name, text: g.text }))}
      />

      <ol className="scores">
        {sorted.map((p) => (
          <li key={p.id} className={p.id === youId ? "you" : ""}>
            <span>
              {p.name}
              {p.id === youId ? " (you)" : ""}
              {gameover && winners.some((w) => w.id === p.id) ? " ★" : ""}
            </span>
            <b>{p.score}</b>
          </li>
        ))}
      </ol>

      {gameover && you && (
        <p className="muted center">
          You scored {you.score}. Do not put that on a resume.
        </p>
      )}

      {gameover && isHost && (
        <button type="button" className="btn primary" onClick={onAgain}>
          One more disaster
        </button>
      )}
      {gameover && !isHost && (
        <p className="muted center">Host is deciding whether to hurt you again.</p>
      )}

      {!gameover && (
        <p className="muted center">Next round in {state.timeLeft}s</p>
      )}
    </div>
  );
}

function reasonLabel(reason: string | undefined) {
  if (reason === "said_secret") return "YOU SAID IT.";
  if (reason === "timeout") return "Times up.";
  if (reason === "guessed") return "Someone had a brain.";
  return "Reveal";
}
