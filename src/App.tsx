import { useMemo, useState } from "react";
import { Lobby, randomName } from "./game/Lobby";
import { Play } from "./game/Play";
import { Reveal } from "./game/Reveal";
import { useRoom } from "./game/useRoom";
import { DebugPanel } from "./game/DebugPanel";
import { HowToPlay } from "./game/HowToPlay";

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)];
  return s;
}

function roomFromUrl(): string {
  const raw = new URLSearchParams(window.location.search).get("room") ?? "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

export function App() {
  const [name, setName] = useState(() => {
    try {
      return sessionStorage.getItem("yap-name") || randomName();
    } catch {
      return randomName();
    }
  });
  const [codeInput, setCodeInput] = useState(roomFromUrl);
  const initialRoom = roomFromUrl();
  const [room, setRoom] = useState<string | null>(
    initialRoom.length === 4 ? initialRoom : null,
  );
  const { state, youId, secret, guesses, debug, yapResult, toasts, connected, send } = useRoom(room, name);
  const [helpOpen, setHelpOpen] = useState(false);

  const enterRoom = (code: string) => {
    const next = code.toUpperCase();
    setRoom(next);
    try {
      sessionStorage.setItem("yap-name", name);
    } catch {
      /* ignore */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("room", next);
    window.history.replaceState(null, "", url);
  };

  const players = state?.players ?? [];
  const connectedCount = players.filter((p) => p.connected).length;
  const isHost = Boolean(youId && state && youId === state.hostId);
  // The debug log contains utterances, so it is hidden whenever the host is a guesser in the current round.
  const hostGuessing = Boolean(state && (state.phase === "countdown" || state.phase === "playing") && youId !== state.yapperId);
  const showDebug = isHost && !hostGuessing && Boolean(room);
  const phase = !room ? "entry" : (state?.phase ?? "lobby");

  const screen = useMemo(() => {
    if (!room || phase === "entry" || phase === "lobby" || !state) return "lobby";
    if (phase === "countdown" || phase === "playing") return "play";
    return "reveal";
  }, [room, phase, state]);

  return (
    <div className={`desktop screen-${screen}`}>
      <div className="sky" />
      <div className="hill" />

      <main className="stage">
        {screen === "lobby" && (
          <Lobby
            name={name}
            onName={setName}
            codeInput={codeInput}
            onCodeInput={setCodeInput}
            onCreate={() => enterRoom(generateCode())}
            onJoin={() => {
              if (codeInput.length === 4) enterRoom(codeInput);
            }}
            roomCode={room}
            players={players}
            hostId={state?.hostId ?? null}
            isHost={isHost}
            canStart={isHost && connectedCount >= 2}
            onStart={() => send({ type: "start" })}
            connected={connected}
            onHelp={() => setHelpOpen(true)}
          />
        )}

        {screen === "play" && state && youId && (
          <Play
            state={state}
            youId={youId}
            secret={secret}
            guesses={guesses}
            yapResult={yapResult}
            send={send}
            onHelp={() => setHelpOpen(true)}
          />
        )}

        {screen === "reveal" && state && youId && (
          <Reveal
            state={state}
            youId={youId}
            guesses={guesses}
            isHost={isHost}
            onAgain={() => send({ type: "start" })}
          />
        )}
      </main>

      {showDebug && <DebugPanel entries={debug} />}
      {helpOpen && <HowToPlay onClose={() => setHelpOpen(false)} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t} className="toast">
            {t}
          </div>
        ))}
      </div>

      <footer className="taskbar">
        <button type="button" className="start-btn" tabIndex={-1}>
          <span className="start-logo" />
          Yap
        </button>
        <span className="task-chip">
          {room ? `${room} - Paint` : "untitled.bmp - Paint"}
        </span>
        <span className="tray">{clock()}</span>
      </footer>
    </div>
  );
}

function clock() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
