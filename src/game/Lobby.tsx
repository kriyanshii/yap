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

  return (
    <div className="lobby">
      <header className="brand">
        <h1>Yap</h1>
        <p className="tagline">Talk. It paints. They guess.</p>
      </header>

      {!inRoom && (
        <div className="lobby-card">
          <label>
            You are
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
          <div className="or">or crawl into someone else's</div>
          <div className="join-row">
            <input
              value={codeInput}
              onChange={(e) => onCodeInput(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="CODE"
              className="code-input"
              maxLength={4}
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button type="button" className="btn" onClick={onJoin} disabled={codeInput.length < 4}>
              Join
            </button>
          </div>
        </div>
      )}

      {inRoom && (
        <div className="lobby-card room">
          <div className="room-code" aria-label="Room code">
            {roomCode}
          </div>
          <button type="button" className="btn slim" onClick={copyLink}>
            {copied ? "Stolen. Now recruit." : "Copy link"}
          </button>
          {!connected && <p className="muted">Finding the sofa…</p>}
          <ul className="player-list">
            {players.length === 0 && <li className="empty">Waiting for victims.</li>}
            {players.map((p) => (
              <li key={p.id} className={p.connected ? "" : "ghost"}>
                <span>{p.name}</span>
                {p.id === hostId ? <em>host</em> : null}
                {p.connected ? null : <em>rage-quit</em>}
              </li>
            ))}
          </ul>
          {players.length === 1 && <p className="muted">Waiting for victims.</p>}
          {isHost ? (
            <button
              type="button"
              className="btn primary"
              onClick={onStart}
              disabled={!canStart}
            >
              {canStart ? "Start the disaster" : "Need at least two"}
            </button>
          ) : (
            <p className="muted">Host is stalling. Sit tight.</p>
          )}
        </div>
      )}
    </div>
  );
}
