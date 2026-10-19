import type * as Party from "partykit/server";
import clues from "../src/clues.json";
import { planDrawing } from "./drawingPlanner";
import { fuzzyMatch, hitsBanned } from "./match";
import type {
  Clue,
  ClientMessage,
  DrawingOp,
  Player,
  PublicState,
  RevealReason,
  ServerMessage,
} from "./types";

type InternalPlayer = Player & { joinedAt: number };

const TOTAL_ROUNDS = 5;
const COUNTDOWN_S = 3;
const PLAYING_S = 75;
const REVEAL_S = 8;
const PAINT_LEAD_MS = 400;
const MAX_PLAYERS = 8;
const MAX_SCENE = 700;

const CLUES = clues as Clue[];

const GUESSED_ROASTS = [
  (n: string) => `${n} ruined the mystery. Thanks.`,
  (n: string) => `${n} has eyes. Suspicious.`,
  (n: string) => `Fine. ${n} was paying attention.`,
  (n: string) => `${n} guessed it. The rest of you were furniture.`,
];

function roastFor(
  reason: RevealReason,
  winnerName: string | null,
): string {
  if (reason === "said_secret") return "YOU SAID IT. Go sit in the corner.";
  if (reason === "timeout") return "Nobody got it. The painting is evidence.";
  const name = winnerName ?? "Someone";
  const pick = GUESSED_ROASTS[Math.floor(Math.random() * GUESSED_ROASTS.length)];
  return pick(name);
}

export default class YapServer implements Party.Server {
  static options: Party.ServerOptions = { hibernate: false };

  players = new Map<string, InternalPlayer>();
  joinOrder: string[] = [];
  hostId: string | null = null;
  phase: PublicState["phase"] = "lobby";
  round = 0;
  timeLeft = 0;
  yapperId: string | null = null;
  seed = 0;
  scene = "";
  prompt = "";
  paintingGeneration = 0;
  paintStartedAt = 0;
  drawingOps: DrawingOp[] = [];
  usedClueIds = new Set<string>();
  clue: Clue | null = null;
  roundClosed = false;
  reveal: PublicState["reveal"];

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private paintTimer: ReturnType<typeof setTimeout> | null = null;
  private paintRequestId = 0;

  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection) {
    const existing = this.players.get(connection.id);
    if (existing) {
      existing.connected = true;
      this.send(
        connection,
        { type: "you", id: connection.id, isHost: this.hostId === connection.id },
      );
      this.send(connection, { type: "state", state: this.publicState() });
      this.sendSecretIfYapper(connection);
      this.broadcastState();
    }
  }

  onMessage(raw: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "join":
        this.handleJoin(sender, msg.name);
        break;
      case "start":
        this.handleStart(sender);
        break;
      case "utterance":
        this.handleUtterance(sender, msg.text);
        break;
      case "guess":
        this.handleGuess(sender, msg.text);
        break;
      default:
        break;
    }
  }

  onClose(connection: Party.Connection) {
    this.handleDisconnect(connection.id);
  }

  onError(connection: Party.Connection) {
    this.handleDisconnect(connection.id);
  }

  private handleJoin(sender: Party.Connection, rawName: string) {
    if (this.players.has(sender.id)) {
      this.send(sender, { type: "you", id: sender.id, isHost: this.hostId === sender.id });
      this.send(sender, { type: "state", state: this.publicState() });
      this.sendSecretIfYapper(sender);
      return;
    }

    const connected = [...this.players.values()].filter((p) => p.connected).length;
    if (connected >= MAX_PLAYERS) {
      this.send(sender, { type: "toast", text: "Sofa is full. Eight is already too many." });
      return;
    }

    const name = sanitizeName(rawName);
    const player: InternalPlayer = {
      id: sender.id,
      name,
      score: 0,
      connected: true,
      joinedAt: Date.now(),
    };

    this.players.set(sender.id, player);
    if (!this.joinOrder.includes(sender.id)) this.joinOrder.push(sender.id);
    if (!this.hostId || !this.players.get(this.hostId)?.connected) {
      this.hostId = sender.id;
    }

    this.send(sender, { type: "you", id: sender.id, isHost: this.hostId === sender.id });
    this.broadcast({ type: "toast", text: `${name} crawled in.` });
    this.broadcastState();
  }

  private handleStart(sender: Party.Connection) {
    if (sender.id !== this.hostId) {
      this.send(sender, { type: "toast", text: "That button is not for you." });
      return;
    }
    if (this.phase !== "lobby" && this.phase !== "gameover") {
      this.send(sender, { type: "toast", text: "We are already suffering." });
      return;
    }
    const connected = [...this.players.values()].filter((p) => p.connected);
    if (connected.length < 2) {
      this.send(sender, { type: "toast", text: "Need at least two victims." });
      return;
    }

    for (const p of this.players.values()) p.score = 0;
    this.usedClueIds.clear();
    this.round = 0;
    this.yapperId = null;
    this.beginRound();
  }

  private handleUtterance(sender: Party.Connection, raw: string) {
    if (this.phase !== "playing" || this.roundClosed) return;
    if (sender.id !== this.yapperId) {
      this.send(sender, { type: "toast", text: "Mouths are for guessing." });
      return;
    }
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) return;

    if (this.clue && hitsBanned(text, this.clue.banned)) {
      this.endRound("said_secret", null);
      return;
    }

    const previousScene = this.scene;
    this.scene = this.scene ? `${this.scene}, ${text}` : text;
    if (this.scene.length > MAX_SCENE) {
      this.scene = this.scene.slice(this.scene.length - MAX_SCENE);
    }

    this.clearPaintTimer();
    void this.broadcastPaint(text, previousScene);
  }

  private handleGuess(sender: Party.Connection, raw: string) {
    if (this.phase !== "playing" || this.roundClosed) return;
    const player = this.players.get(sender.id);
    if (!player) return;
    if (sender.id === this.yapperId) {
      this.send(sender, { type: "toast", text: "You already know. Be quiet." });
      return;
    }
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) return;

    const correct = this.clue ? fuzzyMatch(text, this.clue.text) : false;
    this.broadcast({ type: "guess", name: player.name, text, correct });

    if (correct) {
      this.endRound("guessed", player.id);
    }
  }

  private beginRound() {
    this.clearPaintTimer();
    const connectedIds = this.joinOrder.filter((id) => this.players.get(id)?.connected);
    if (connectedIds.length < 2) {
      this.phase = "lobby";
      this.stopTick();
      this.broadcast({ type: "toast", text: "Everyone left. Cowards." });
      this.broadcastState();
      return;
    }

    this.round += 1;
    if (this.round > TOTAL_ROUNDS) {
      this.phase = "gameover";
      this.stopTick();
      this.broadcastState();
      return;
    }

    this.yapperId = this.nextYapper();
    this.clue = this.pickClue();
    this.scene = "";
    this.prompt = "";
    this.seed = Math.floor(Math.random() * 1_000_000_000);
    this.paintingGeneration = 0;
    this.paintStartedAt = 0;
    this.drawingOps = [];
    this.paintRequestId += 1;
    this.roundClosed = false;
    this.reveal = undefined;
    this.phase = "countdown";
    this.timeLeft = COUNTDOWN_S;
    this.startTick();
    this.broadcastState();
    this.sendSecretToYapper();
    const yapper = this.yapperId ? this.players.get(this.yapperId) : null;
    this.broadcast({
      type: "toast",
      text: `Round ${this.round}. ${yapper?.name ?? "Someone"} has the secret.`,
    });
  }

  private nextYapper(): string {
    const connected = this.joinOrder.filter((id) => this.players.get(id)?.connected);
    const start = this.yapperId ? this.joinOrder.indexOf(this.yapperId) : -1;
    for (let i = 1; i <= this.joinOrder.length; i++) {
      const id = this.joinOrder[(start + i) % this.joinOrder.length];
      if (this.players.get(id)?.connected) return id;
    }
    return connected[0];
  }

  private pickClue(): Clue {
    const unused = CLUES.filter((c) => !this.usedClueIds.has(c.id));
    const pool = unused.length ? unused : CLUES;
    const clue = pool[Math.floor(Math.random() * pool.length)];
    this.usedClueIds.add(clue.id);
    return clue;
  }

  private endRound(reason: RevealReason, winnerId: string | null) {
    if (this.roundClosed) return;
    this.roundClosed = true;
    this.clearPaintTimer();
    if (this.scene && this.prompt === "") void this.broadcastPaint(this.scene, "");

    const winner = winnerId ? this.players.get(winnerId) : null;
    if (reason === "guessed" && winner) {
      winner.score += 2;
      const yapper = this.yapperId ? this.players.get(this.yapperId) : null;
      if (yapper) yapper.score += 1;
    } else if (reason === "said_secret") {
      for (const p of this.players.values()) {
        if (p.id !== this.yapperId && p.connected) p.score += 1;
      }
    }

    const winnerName = winner?.name ?? null;
    this.reveal = {
      clue: this.clue?.text ?? "",
      reason,
      winnerName,
      roast: roastFor(reason, winnerName),
    };
    this.phase = "reveal";
    this.timeLeft = REVEAL_S;
    this.broadcastState();
  }

  private tick() {
    if (
      this.phase !== "countdown" &&
      this.phase !== "playing" &&
      this.phase !== "reveal"
    ) {
      return;
    }
    this.timeLeft -= 1;
    if (this.timeLeft <= 0) {
      if (this.phase === "countdown") {
        this.phase = "playing";
        this.timeLeft = PLAYING_S;
      } else if (this.phase === "playing") {
        this.endRound("timeout", null);
        return;
      } else if (this.phase === "reveal") {
        if (this.round >= TOTAL_ROUNDS) {
          this.phase = "gameover";
          this.stopTick();
        } else {
          this.beginRound();
          return;
        }
      }
    }
    this.broadcastState();
  }

  private async broadcastPaint(utterance: string, currentScene: string) {
    const requestId = ++this.paintRequestId;
    const requestedRound = this.round;
    const requestedScene = this.scene;
    const rawKey = this.room.env.GEMINI_API_KEY;
    const rawModel = this.room.env.GEMINI_MODEL;
    const apiKey = typeof rawKey === "string" ? rawKey : undefined;
    const model = typeof rawModel === "string" ? rawModel : undefined;
    const operations = await planDrawing(utterance, currentScene, apiKey, model);
    if (requestId !== this.paintRequestId || requestedRound !== this.round) return;

    this.paintingGeneration += 1;
    this.prompt = requestedScene;
    this.drawingOps = operations;
    this.paintStartedAt = Date.now() + PAINT_LEAD_MS;
    if (operations.length === 0) {
      this.broadcast({
        type: "toast",
        text: apiKey
          ? "Intern blanked. Using the cheap crayons."
          : "No Gemini key. Cheap crayons only.",
      });
    }
    this.broadcastState();
  }

  private startTick() {
    this.stopTick();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  private stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private clearPaintTimer() {
    if (this.paintTimer) {
      clearTimeout(this.paintTimer);
      this.paintTimer = null;
    }
  }

  private handleDisconnect(id: string) {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;

    const connected = [...this.players.values()].filter((p) => p.connected);
    if (connected.length === 0) {
      this.resetEmptyRoom();
      return;
    }

    if (this.phase === "lobby" || this.phase === "gameover") {
      this.players.delete(id);
      this.joinOrder = this.joinOrder.filter((x) => x !== id);
    }

    if (this.hostId === id || !this.players.get(this.hostId ?? "")?.connected) {
      this.hostId = connected[0]?.id ?? null;
    }

    if (this.phase !== "lobby" && this.phase !== "gameover" && connected.length < 2) {
      this.phase = "lobby";
      this.roundClosed = true;
      this.stopTick();
      this.clearPaintTimer();
      this.broadcast({ type: "toast", text: "Not enough people. Back to the sofa." });
    }

    this.broadcastState();
  }

  private resetEmptyRoom() {
    this.stopTick();
    this.clearPaintTimer();
    this.players.clear();
    this.joinOrder = [];
    this.hostId = null;
    this.phase = "lobby";
    this.round = 0;
    this.timeLeft = 0;
    this.yapperId = null;
    this.seed = 0;
    this.scene = "";
    this.prompt = "";
    this.paintingGeneration = 0;
    this.paintStartedAt = 0;
    this.drawingOps = [];
    this.paintRequestId += 1;
    this.usedClueIds.clear();
    this.clue = null;
    this.reveal = undefined;
  }

  private publicState(): PublicState {
    const players: Player[] = this.joinOrder
      .map((id) => this.players.get(id))
      .filter((p): p is InternalPlayer => Boolean(p))
      .map(({ id, name, score, connected }) => ({ id, name, score, connected }));

    return {
      phase: this.phase,
      code: this.room.id.toUpperCase(),
      round: this.round,
      totalRounds: TOTAL_ROUNDS,
      timeLeft: this.timeLeft,
      players,
      yapperId: this.yapperId,
      hostId: this.hostId,
      seed: this.seed,
      prompt: this.prompt,
      paintingGeneration: this.paintingGeneration,
      paintStartedAt: this.paintStartedAt,
      drawingOps: this.drawingOps,
      reveal: this.phase === "reveal" || this.phase === "gameover" ? this.reveal : undefined,
    };
  }

  private broadcastState() {
    this.broadcast({ type: "state", state: this.publicState() });
  }

  private sendSecretToYapper() {
    if (!this.yapperId || !this.clue) return;
    const conn = [...this.room.getConnections()].find((c) => c.id === this.yapperId);
    if (conn) this.sendSecretIfYapper(conn);
  }

  private sendSecretIfYapper(connection: Party.Connection) {
    if (connection.id !== this.yapperId || !this.clue) return;
    if (this.phase !== "countdown" && this.phase !== "playing") return;
    this.send(connection, {
      type: "secret",
      clue: this.clue.text,
      banned: this.clue.banned,
    });
  }

  private send(connection: Party.Connection, msg: ServerMessage) {
    connection.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }
}

YapServer satisfies Party.Worker;

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 18);
  return cleaned || "WetPaint";
}
