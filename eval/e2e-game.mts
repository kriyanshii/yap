// End-to-end check of the game server (locally: run `npm run dev` first): two players over WebSockets, two rounds.
// Usage: npx tsx eval/e2e-game.mts [host] [ws|wss]   (default 127.0.0.1:1999 ws)
// Checks: the secret goes only to the yapper; guessers never receive the transcript; the debug log reaches the host only
// when the host isn't guessing; utterances change the canvas through the scene engine; a correct guess ends the round.
const serverHost = process.argv[2] ?? "127.0.0.1:1999";
const proto = process.argv[3] ?? (serverHost.startsWith("127.") || serverHost.startsWith("localhost") ? "ws" : "wss");
const room = `E2E${Math.floor(Math.random() * 9000 + 1000)}`;
type Msg = { type: string; [k: string]: any };

function player(name: string) {
  const ws = new WebSocket(`${proto}://${serverHost}/parties/main/${room.toLowerCase()}?_pk=${name}-${Date.now()}`);
  const inbox: Msg[] = [];
  ws.addEventListener("message", (e) => inbox.push(JSON.parse(String(e.data))));
  const ready = new Promise<void>((res) => ws.addEventListener("open", () => res()));
  const send = (m: object) => ws.send(JSON.stringify(m));
  const last = (type: string) => [...inbox].reverse().find((m) => m.type === type);
  return { name, ws, inbox, ready, send, last, get state() { return last("state")?.state; } };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(label: string, fn: () => boolean, ms = 30000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error(`timed out waiting for: ${label}`); await sleep(100); }
}
let failures = 0;
const check = (ok: boolean, label: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

const a = player("Ana"), b = player("Ben");
await a.ready; a.send({ type: "join", name: "Ana" });
await until("Ana is host", () => !!a.state?.hostId);
await b.ready; b.send({ type: "join", name: "Ben" });
await until("two players", () => a.state?.players.length === 2);
// Like a host before a demo: wait until the debug log says the lobby warm-up reached Qwen.
await until("Qwen warm-up finished", () => a.inbox.some((m) => m.type === "debug" && m.entries.some((e: any) => e.note === "warm-up" && e.mapper === "qwen")), 150000);
console.log("      " + [...a.inbox].reverse().find((m) => m.type === "debug")!.entries.find((e: any) => e.note === "warm-up").raw);
a.send({ type: "start" });
await until("round started", () => a.state?.phase === "countdown" || a.state?.phase === "playing");

const yapper = a.state.yapperId === a.last("you")!.id ? a : b;
const guesser = yapper === a ? b : a;
const secret = yapper.last("secret") ?? { clue: "" };
check(secret.clue !== "", `yapper (${yapper.name}) received the secret scene: "${secret.clue}"`);
check(!guesser.inbox.some((m) => m.type === "secret"), `guesser (${guesser.name}) never received a secret message`);
await until("playing", () => a.state?.phase === "playing", 10000);

// Describe without banned words; the canvas should change after each drawable utterance.
// The first canvas change is the plumbing check; specific model answers vary by scene and aren't asserted here.
for (const u of ["draw a tall plant with branches", "make it gray", "make it bigger"]) {
  const gen = guesser.state.paintingGeneration;
  yapper.send({ type: "utterance", text: u });
  await until(`canvas updated after "${u}"`, () => guesser.state.paintingGeneration > gen, 20000);
  const ops = guesser.state.drawingOps.map((o: any) => `${o.key}:${o.color}${o.fresh ? "*" : ""}`).join(" ");
  console.log(`      "${u}" -> guesser canvas: ${ops}`);
}
const finalOps = guesser.state.drawingOps;
check(finalOps.length === 1 && finalOps[0].stamp === "tree" && finalOps[0].color === "gray" && finalOps[0].scale > 1, "canvas holds one gray, enlarged tree (add, recolor via focus, scale)");
check(guesser.state.sceneMode === true && guesser.state.prompt !== "draw a tall plant with branches", "guesser state has sceneMode and no transcript in prompt");
const leaked = guesser.inbox.some((m) => JSON.stringify(m).includes("tall plant"));
check(!leaked, "guesser never received the transcript in any message");
check(!guesser.inbox.some((m) => m.type === "secret") && !JSON.stringify(guesser.inbox.filter((m) => m.type === "state")).includes(secret.clue), "guesser never received the secret scene text before the reveal");

const host = a; // Ana created the room
const hostIsYapper = host === yapper;
const debugDuringRound = host.inbox.filter((m) => m.type === "debug" && m.entries.some((e: any) => e.utterance === "make it gray"));
check(hostIsYapper ? debugDuringRound.length > 0 : debugDuringRound.length === 0,
  hostIsYapper ? "host is the yapper: debug log arrived live" : "host is guessing: no utterance debug entries during the round");
check(!b.inbox.some((m) => m.type === "debug"), "non-host never received debug messages");

// Chatter must not touch the canvas.
const before = JSON.stringify(guesser.state.drawingOps);
yapper.send({ type: "utterance", text: "this game is so hard lol" });
await sleep(4000);
check(JSON.stringify(guesser.state.drawingOps) === before, "chatter left the canvas unchanged");

// Hint: only the yapper receives it; it is flagged publicly and costs the yapper's bonus point.
const yapperScoreBefore = guesser.state.players.find((p: any) => p.id === guesser.state.yapperId).score;
yapper.send({ type: "hint" });
await until("hint arrives", () => yapper.inbox.some((m) => m.type === "hint"), 5000);
const hintMsg = yapper.last("hint")!;
check(Array.isArray(hintMsg.hint?.phrases) && hintMsg.hint.phrases.length >= 2, `yapper received a hint: "${hintMsg.hint?.meaning}"`);
await until("hintUsed in state", () => guesser.state.hintUsed === true, 5000);
check(!guesser.inbox.some((m) => m.type === "hint" || JSON.stringify(m).includes(hintMsg.hint.meaning)), "guesser saw that a hint was used, but never the hint itself");

// A correct guess (names every object/color in the scene) ends the round; the reveal carries what was said.
guesser.send({ type: "guess", text: secret.clue });
await until("reveal", () => guesser.state?.phase === "reveal", 10000);
check(guesser.state.reveal?.reason === "guessed", "guessing the scene ended the round");
check((guesser.state.reveal?.said ?? "").includes("tall plant"), "the reveal shows what the yapper said");
const yapperScoreAfter = guesser.state.players.find((p: any) => p.id === guesser.state.yapperId).score;
check(guesser.state.reveal?.hintUsed === true && yapperScoreAfter === yapperScoreBefore, `hint cost the yapper's bonus (score ${yapperScoreBefore} -> ${yapperScoreAfter})`);
await until("host debug log after the round", () => host.inbox.some((m) => m.type === "debug" && m.entries.some((e: any) => e.utterance === "make it gray")), 5000).catch(() => {});
const log = [...host.inbox].reverse().find((m) => m.type === "debug")?.entries ?? [];
check(log.some((e: any) => e.utterance === "make it gray"), "host received the round's debug log after the reveal");
for (const e of log) console.log(`      debug: [${e.mapper ?? "none"} ${e.ms}ms] ${e.utterance} -> ${JSON.stringify(e.ops)}${e.attempts.length > 1 ? `  (${e.attempts.map((x: any) => `${x.mapper}:${x.outcome}`).join(" > ")})` : ""}`);

// Round 2: the other player yaps, so the host is a guesser and must not see the debug log live.
await until("round 2 playing", () => a.state?.round === 2 && a.state?.phase === "playing", 30000);
const yapper2 = a.state.yapperId === a.last("you")!.id ? a : b;
const hostGuessingNow = yapper2 !== host;
const debugCountBefore = host.inbox.filter((m) => m.type === "debug").length;
yapper2.send({ type: "utterance", text: "draw a woody plant that grows tall" });
await sleep(5000);
const liveLeak = host.inbox.slice(0).filter((m) => m.type === "debug").slice(debugCountBefore).some((m) => JSON.stringify(m).includes("woody plant"));
check(hostGuessingNow && !liveLeak, `round 2: host is guessing (yapper is ${yapper2.name}) and got no live debug entry for the yapper's utterance`);

// Skip: once per game, new scene, blank canvas; a second skip is refused.
const guesser2 = yapper2 === a ? b : a;
const oldScene = yapper2.last("secret")!.clue;
await until("round 2 canvas has something", () => guesser2.state.drawingOps.length > 0, 15000).catch(() => {});
yapper2.send({ type: "skip" });
await until("new secret after skip", () => yapper2.last("secret")!.clue !== oldScene, 5000);
await until("canvas cleared", () => guesser2.state.drawingOps.length === 0, 5000);
check(yapper2.last("secret")!.canSkip === false, `skip gave a new scene ("${oldScene}" -> "${yapper2.last("secret")!.clue}") and a blank canvas`);
const sceneAfterSkip = yapper2.last("secret")!.clue;
yapper2.send({ type: "skip" });
await sleep(1500);
check(yapper2.last("secret")!.clue === sceneAfterSkip, "a second skip in the same game is refused");

a.ws.close(); b.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
