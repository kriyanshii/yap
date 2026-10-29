import { Server, type Connection, type WSMessage } from "partyserver";
import { SceneEngine, type Snapshot } from "../src/scene/engine.ts";
import { DEMO_SCENES } from "./demoScenes";
import { describeOps } from "./describe";
import { sceneToDrawingOps } from "./sceneOps";
import { fuzzyMatch, hitsBanned, sceneGuessMatches } from "./match";
import { bestGuessStep, defaultChain, mapUtterance, readMapperEnv, warmUpQwen } from "./sceneMapper";
import type {
  Clue,
  ClientMessage,
  DebugEntry,
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
const MAX_DEBUG = 200;
const WARMUP_MIN_GAP_MS = 60_000;
/** Inside Modal's 5-minute idle window, so the GPU stays up while a room is open (costs GPU time while players idle). */
const KEEP_WARM_MS = 4 * 60_000;

// Demo build: scenes drawable by the scene engine (cat, tree, house, sun, cloud). The classic clue list is src/clues.json.
const CLUES: Clue[] = DEMO_SCENES;

/** The scene's objects, so back-to-back rounds don't repeat the same combination. */
function objectPair(clue: Clue): string {
  return [...clue.banned].sort().join("+");
}

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

// A room is a Durable Object (PartyServer). Hibernation stays off: game state and timers live in memory.
export class YapServer extends Server<Env> {
  static options = { hibernate: false };

  players = new Map<string, InternalPlayer>();
  joinOrder: string[] = [];
  hostId: string | null = null;
  phase: PublicState["phase"] = "lobby";
  round = 0;
  timeLeft = 0;
  yapperId: string | null = null;
  seed = 0;
  prompt = "";
  paintingGeneration = 0;
  paintStartedAt = 0;
  drawingOps: DrawingOp[] = [];
  usedClueIds = new Set<string>();
  clue: Clue | null = null;
  roundClosed = false;
  reveal: PublicState["reveal"];
  /** The round's canvas. The app owns ids and focus; one utterance is one undoable action. */
  engine = new SceneEngine();
  /** The yapper's utterances this round. Kept on the server until the reveal. */
  roundUtterances: string[] = [];
  /** The yapper opened this round's hint, which costs their bonus point. */
  hintUsed = false;
  /** Players who already used their one skip this game. */
  skipsUsed = new Set<string>();
  debugLog: DebugEntry[] = [];

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private paintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Utterances run one at a time, so each one sees the scene the previous one produced. */
  private utteranceQueue: Promise<void> = Promise.resolve();
  private lastWarmAt = 0;
  private keepWarmTimer: ReturnType<typeof setInterval> | null = null;

  onConnect(connection: Connection) {
    const existing = this.players.get(connection.id);
    if (existing) {
      existing.connected = true;
      this.send(
        connection,
        { type: "you", id: connection.id, isHost: this.hostId === connection.id },
      );
      this.send(connection, { type: "state", state: this.publicState() });
      this.sendSecretIfYapper(connection);
      this.sendDebugToHost();
      this.broadcastState();
    }
  }

  onMessage(sender: Connection, raw: WSMessage) {
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
      case "hint":
        this.handleHint(sender);
        break;
      case "skip":
        this.handleSkip(sender);
        break;
      default:
        break;
    }
  }

  onClose(connection: Connection) {
    this.handleDisconnect(connection.id);
  }

  onError(connection: Connection) {
    this.handleDisconnect(connection.id);
  }

  private handleJoin(sender: Connection, rawName: string) {
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
    this.broadcastMsg({ type: "toast", text: `${name} crawled in.` });
    this.broadcastState();
    // The lobby just opened: wake the GPU now so the first real utterance doesn't wait for a cold start.
    if (this.players.size === 1) {
      void this.warmUp("lobby opened");
      if (!this.keepWarmTimer) this.keepWarmTimer = setInterval(() => void this.warmUp("keep warm"), KEEP_WARM_MS);
    }
  }

  private handleStart(sender: Connection) {
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
    this.skipsUsed.clear();
    this.round = 0;
    this.yapperId = null;
    void this.warmUp("game started");
    this.beginRound();
  }

  private handleUtterance(sender: Connection, raw: string) {
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

    const round = this.round;
    const engine = this.engine;
    this.roundUtterances.push(text);
    this.utteranceQueue = this.utteranceQueue
      .then(() => this.applyUtterance(text, round, engine))
      .catch(() => {});
  }

  /** Maps one utterance to ops (Qwen -> Gemini -> keyword) and applies them. On failure the canvas is left as it was. */
  private async applyUtterance(text: string, round: number, engine: SceneEngine) {
    if (round !== this.round || engine !== this.engine) return;
    const before = engine.snapshot();
    // Only the utterance and the scene graph go to the models. The secret scene never leaves the server.
    const input = { utterance: text, scene: { objects: before.objects }, focus_id: before.focus_id, history_len: engine.state.history.length };
    const env = readMapperEnv(this.secrets);
    const result = await mapUtterance(input, (ops) => engine.execute(ops), defaultChain(env), bestGuessStep(env));
    if (round !== this.round || engine !== this.engine) return;

    const winner = result.attempts[result.attempts.length - 1];
    this.logDebug({
      round,
      utterance: text,
      mapper: result.mapper,
      ms: result.ms,
      attempts: result.attempts.map(({ mapper, outcome, ms }) => ({ mapper, outcome, ms })),
      raw: result.mapper ? winner.raw : result.attempts.map((a) => `${a.mapper}: ${a.raw || a.outcome}`).join(" | "),
      ops: result.ops,
    });

    // Tell the yapper (only) what happened, right under their input.
    const yapper = this.connectionFor(this.yapperId);
    const tell = (status: "drew" | "guess" | "nothing" | "failed", text: string) => {
      if (yapper) this.send(yapper, { type: "yapResult", status, text });
    };
    if (!result.mapper) {
      tell("failed", "Couldn't reach the artist. Nothing changed, say it again.");
      return;
    }
    if (result.ops.length === 0) {
      tell("nothing", "Nothing drawn: too vague. Say what it is or does, one thing at a time.");
      return;
    }
    const summary = describeOps(result.ops, before.objects);
    tell(result.mapper === "best_guess" ? "guess" : "drew", result.mapper === "best_guess" ? `Best guess: ${summary[0].toLowerCase()}${summary.slice(1)}` : summary);
    this.repaint(before);
  }

  /** Publishes the engine's scene graph as stamps; objects changed since `before` animate, the rest appear instantly. */
  private repaint(before: Snapshot) {
    this.drawingOps = sceneToDrawingOps(this.engine.state.objects, before.objects);
    this.paintingGeneration += 1;
    this.paintStartedAt = Date.now() + PAINT_LEAD_MS;
    // A neutral placeholder, never the transcript: guessers must not receive what the yapper said.
    this.prompt = this.drawingOps.length ? "scene" : "";
    this.broadcastState();
  }

  private async warmUp(reason: string) {
    const env = readMapperEnv(this.secrets);
    if (!env.QWEN_ENDPOINT_URL || Date.now() - this.lastWarmAt < WARMUP_MIN_GAP_MS) return;
    this.lastWarmAt = Date.now();
    const ms = await warmUpQwen(env);
    this.logDebug({
      round: this.round,
      utterance: `(warm-up: ${reason})`,
      mapper: ms === null ? null : "qwen",
      ms: ms ?? 0,
      attempts: [],
      raw: ms === null ? "warm-up failed; the game will fall back to Gemini/keyword until Qwen answers" : `Qwen ready in ${ms} ms`,
      ops: [],
      note: "warm-up",
    });
  }

  private logDebug(entry: DebugEntry) {
    this.debugLog.push(entry);
    if (this.debugLog.length > MAX_DEBUG) this.debugLog.splice(0, this.debugLog.length - MAX_DEBUG);
    this.sendDebugToHost();
  }

  /** The debug log shows utterances, so the host only sees it while not guessing: as the yapper, or between rounds. */
  private sendDebugToHost() {
    const host = this.connectionFor(this.hostId);
    if (!host) return;
    const guessing = (this.phase === "countdown" || this.phase === "playing") && this.hostId !== this.yapperId;
    if (!guessing) this.send(host, { type: "debug", entries: this.debugLog });
  }

  /** Secrets set with `wrangler secret put` (or .env in local dev); not part of the generated Env type. */
  private get secrets(): Record<string, unknown> {
    return this.env as unknown as Record<string, unknown>;
  }

  private connectionFor(id: string | null): Connection | undefined {
    return id ? [...this.getConnections()].find((c) => c.id === id) : undefined;
  }

  /** Yapper-only: sends the scene's hint to the yapper (and nobody else). The first request costs the bonus point. */
  private handleHint(sender: Connection) {
    if ((this.phase !== "countdown" && this.phase !== "playing") || this.roundClosed) return;
    if (sender.id !== this.yapperId) {
      this.send(sender, { type: "toast", text: "Only the Yapper gets hints." });
      return;
    }
    if (!this.clue?.hint) {
      this.send(sender, { type: "toast", text: "No hint for this scene." });
      return;
    }
    const first = !this.hintUsed;
    this.hintUsed = true;
    this.send(sender, { type: "hint", hint: this.clue.hint });
    if (first) this.broadcastState();
  }

  /** Yapper-only, once per player per game: a new scene and a fresh canvas. The timer keeps running. */
  private handleSkip(sender: Connection) {
    if ((this.phase !== "countdown" && this.phase !== "playing") || this.roundClosed) return;
    if (sender.id !== this.yapperId) return;
    if (this.skipsUsed.has(sender.id)) {
      this.send(sender, { type: "toast", text: "You already used your skip this game." });
      return;
    }
    this.skipsUsed.add(sender.id);
    this.clue = this.pickClue();
    this.engine = new SceneEngine();
    this.utteranceQueue = Promise.resolve();
    this.roundUtterances = [];
    this.hintUsed = false;
    this.drawingOps = [];
    this.prompt = "";
    this.paintingGeneration += 1;
    this.paintStartedAt = Date.now();
    const yapper = this.players.get(sender.id);
    this.broadcastMsg({ type: "toast", text: `${yapper?.name ?? "The Yapper"} skipped the scene. Fresh canvas!` });
    this.broadcastState();
    this.sendSecretToYapper();
  }

  private handleGuess(sender: Connection, raw: string) {
    if (this.phase !== "playing" || this.roundClosed) return;
    const player = this.players.get(sender.id);
    if (!player) return;
    if (sender.id === this.yapperId) {
      this.send(sender, { type: "toast", text: "You already know. Be quiet." });
      return;
    }
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) return;

    const correct = !this.clue ? false
      : this.clue.required ? sceneGuessMatches(text, this.clue.required)
      : fuzzyMatch(text, this.clue.text);
    this.broadcastMsg({ type: "guess", name: player.name, text, correct });

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
      this.broadcastMsg({ type: "toast", text: "Everyone left. Cowards." });
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
    this.prompt = "";
    this.seed = Math.floor(Math.random() * 1_000_000_000);
    this.paintingGeneration = 0;
    this.paintStartedAt = 0;
    this.drawingOps = [];
    this.engine = new SceneEngine();
    this.utteranceQueue = Promise.resolve();
    this.roundUtterances = [];
    this.hintUsed = false;
    this.roundClosed = false;
    this.reveal = undefined;
    this.phase = "countdown";
    this.timeLeft = COUNTDOWN_S;
    this.startTick();
    this.broadcastState();
    this.sendSecretToYapper();
    const yapper = this.yapperId ? this.players.get(this.yapperId) : null;
    this.broadcastMsg({
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
    const previous = this.clue ? objectPair(this.clue) : null;
    const varied = previous ? pool.filter((c) => objectPair(c) !== previous) : pool;
    const choices = varied.length ? varied : pool;
    const clue = choices[Math.floor(Math.random() * choices.length)];
    this.usedClueIds.add(clue.id);
    return clue;
  }

  private endRound(reason: RevealReason, winnerId: string | null) {
    if (this.roundClosed) return;
    this.roundClosed = true;
    this.clearPaintTimer();

    const winner = winnerId ? this.players.get(winnerId) : null;
    if (reason === "guessed" && winner) {
      winner.score += 2;
      const yapper = this.yapperId ? this.players.get(this.yapperId) : null;
      // A hint costs the yapper their bonus point.
      if (yapper && !this.hintUsed) yapper.score += 1;
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
      said: this.roundUtterances.join(", "),
      hintUsed: this.hintUsed,
    };
    this.phase = "reveal";
    this.timeLeft = REVEAL_S;
    this.broadcastState();
    this.sendDebugToHost();
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
      this.broadcastMsg({ type: "toast", text: "Not enough people. Back to the sofa." });
    }

    this.broadcastState();
  }

  private resetEmptyRoom() {
    this.stopTick();
    if (this.keepWarmTimer) {
      clearInterval(this.keepWarmTimer);
      this.keepWarmTimer = null;
    }
    this.clearPaintTimer();
    this.players.clear();
    this.joinOrder = [];
    this.hostId = null;
    this.phase = "lobby";
    this.round = 0;
    this.timeLeft = 0;
    this.yapperId = null;
    this.seed = 0;
    this.prompt = "";
    this.paintingGeneration = 0;
    this.paintStartedAt = 0;
    this.drawingOps = [];
    this.engine = new SceneEngine();
    this.utteranceQueue = Promise.resolve();
    this.debugLog = [];
    this.lastWarmAt = 0;
    this.hintUsed = false;
    this.skipsUsed.clear();
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
      code: this.name.toUpperCase(),
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
      sceneMode: true,
      hintUsed: this.hintUsed,
      reveal: this.phase === "reveal" || this.phase === "gameover" ? this.reveal : undefined,
    };
  }

  private broadcastState() {
    this.broadcastMsg({ type: "state", state: this.publicState() });
  }

  private sendSecretToYapper() {
    if (!this.yapperId || !this.clue) return;
    const conn = [...this.getConnections()].find((c) => c.id === this.yapperId);
    if (conn) this.sendSecretIfYapper(conn);
  }

  private sendSecretIfYapper(connection: Connection) {
    if (connection.id !== this.yapperId || !this.clue) return;
    if (this.phase !== "countdown" && this.phase !== "playing") return;
    this.send(connection, {
      type: "secret",
      clue: this.clue.text,
      banned: this.clue.banned,
      canSkip: !this.skipsUsed.has(connection.id),
    });
    // A reconnecting yapper gets back the hint they already paid for.
    if (this.hintUsed && this.clue.hint) this.send(connection, { type: "hint", hint: this.clue.hint });
  }

  private send(connection: Connection, msg: ServerMessage) {
    connection.send(JSON.stringify(msg));
  }

  private broadcastMsg(msg: ServerMessage) {
    this.broadcast(JSON.stringify(msg));
  }
}


function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 18);
  return cleaned || "WetPaint";
}
