import { useEffect, useState } from "react";
import type { Player } from "../../party/types";

const NAMES = [
  "PaintStain42",
  "UndoMaster",
  "FillBucket7",
  "CtrlZed",
  "Squiggle9",
  "WetPaint",
  "ColorSpill",
  "BrushBeast",
  "CanvasKid",
  "DoodleBug",
  "AirbrushAnn",
  "LassoLarry",
];

export function randomName(): string {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

type Props = {
  name: string;
  onName: (n: string) => void;
  codeInput: string;
  onCodeInput: (c: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  roomCode: string | null;
  players: Player[];
  hostId: string | null;
  isHost: boolean;
  canStart: boolean;
  onStart: () => void;
  connected: boolean;
  onHelp: () => void;
};

export function Lobby({
  name,
  onName,
  codeInput,
  onCodeInput,
  onCreate,
  onJoin,
  roomCode,
  players,
  hostId,
  isHost,
  canStart,
  onStart,
  connected,
  onHelp,
}: Props) {
  const [copied, setCopied] = useState(false);
  const inRoom = Boolean(roomCode);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copyLink = async () => {
    if (!roomCode) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const online = players.filter((p) => p.connected);
  const hostName = players.find((p) => p.id === hostId)?.name ?? "the host";
  const need = Math.max(0, 2 - online.length);

  return (
    <div className="lobby">
      <header className="brand">
        <h1>Yap</h1>
        <p className="tagline">Talk. It paints. They guess.</p>
      </header>

      {!inRoom && (
        <div className="lobby-card">
          <ol className="steps">
            <li><b>1</b><span>One player gets a <b>secret scene</b> and describes it out loud, without saying the object words.</span></li>
            <li><b>2</b><span>An <b>AI artist</b> draws what they say, live.</span></li>
            <li><b>3</b><span>Everyone else <b>guesses</b> the scene from the drawing.</span></li>
          </ol>
          <button type="button" className="help-link block" onClick={onHelp}>How to play (1 min read)</button>

          <label className="field">
            Your name
            <input
              value={name}
              maxLength={18}
              onChange={(e) => onName(e.target.value)}
              autoComplete="nickname"
            />
          </label>
          <button type="button" className="btn primary" onClick={onCreate}>
            Create a room
          </button>
          <div className="or">or join a friend's room</div>
          <div className="join-row">
            <input
              value={codeInput}
              onChange={(e) => onCodeInput(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="CODE"
              className="code-input"
              maxLength={4}
              autoCapitalize="characters"
              spellCheck={false}
              aria-label="Room code"
              onKeyDown={(e) => {
                if (e.key === "Enter" && codeInput.length === 4) onJoin();
              }}
            />
            <button type="button" className="btn" onClick={onJoin} disabled={codeInput.length < 4}>
              Join
            </button>
          </div>
        </div>
      )}

      {inRoom && (
        <div className="lobby-card room">
          <span className="field-label">Room code: share it or the link</span>
          <div className="room-code" aria-label="Room code">
            {roomCode}
          </div>
          <button type="button" className="btn slim" onClick={copyLink}>
            {copied ? "Link copied! Send it to your friends" : "Copy invite link"}
          </button>
          {!connected && <p className="muted">Connecting…</p>}

          <span className="field-label">Players ({online.length})</span>
          <ul className="player-list">
            {players.length === 0 && <li className="empty">Waiting for players…</li>}
            {players.map((p) => (
              <li key={p.id} className={p.connected ? "" : "ghost"}>
                <span>{p.name}</span>
                {p.id === hostId ? <em>host</em> : null}
                {p.connected ? null : <em>left</em>}
              </li>
            ))}
          </ul>

          <p className={`lobby-status ${need === 0 ? "ready" : ""}`}>
            {need > 0
              ? `Need ${need} more player${need > 1 ? "s" : ""} to start. Share the code!`
              : isHost
                ? "Everyone in? Press Start."
                : `Ready! Waiting for ${hostName} to start.`}
          </p>
          {isHost && (
            <button type="button" className="btn primary" onClick={onStart} disabled={!canStart}>
              Start game
            </button>
          )}
          <button type="button" className="help-link block" onClick={onHelp}>How to play</button>
        </div>
      )}
    </div>
  );
}
