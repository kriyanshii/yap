# Yap: player and host guide

**Play:** https://yap.kriyanshishah06.workers.dev

Yap is a party guessing game. One player, the **Yapper**, gets a secret scene like *"a blue cat under a tree"* and describes it out loud. An AI artist draws what they say, live. Everyone else guesses the scene from the drawing.

The same guide is in the game: press **How to play** on any screen.

## Starting a game

1. Open the link, type your name, and press **Create a room**. You're the host.
2. Press **Copy invite link** and send it to your friends. They can also type the 4-letter code on the start screen.
3. When at least 2 people are in, press **Start game**. 3–6 players is the most fun.

The game runs 5 rounds of 75 seconds, with a new Yapper each round.

## If you're the Yapper

Your secret scene appears at the top. The words in red under **Don't say** are the objects in the scene. If you say one, the round ends.

1. **Describe one thing at a time, by what it is or does.**
   - "the animal that purrs" → cat
   - "the bright light of daytime" → sun
   - "a fluffy patch of mist in the sky" → cloud
   - "the place where people live" → house
   - "a tall plant with branches" → tree
2. **Change the last thing with "it".**
   - "make it blue"
   - "make it bigger" / "make it smaller"
   - "move it to the left"
   - "undo" (takes back the last change)
3. **Add the next thing relative to it**, e.g. "put the animal that purrs under it".
4. Colours, sizes and positions are always allowed.

**To send:** hold the 🎤 button and talk, let go, check the words in the box, then press **Draw** (or Enter). You can also just type. The line under the box tells you what happened:

| line | meaning |
|---|---|
| ✅ Drew a sun | The artist understood. |
| 🎲 Best guess: drew an orange sun | Your description was loose (a shape or colour), so the artist took its best guess. |
| 🤔 Nothing drawn: too vague | Try saying what the thing *is* or *does*, one thing at a time. |
| ⚠️ Couldn't reach the artist | A network hiccup. Say it again; nothing on the canvas changed. |

The artist knows five things: **cat, tree, house, sun, cloud**, in 11 colours (red, orange, yellow, green, blue, purple, pink, brown, black, white, gray).

## If you're guessing

Watch the picture build, then type a guess that names **every object and colour** you see, for example "a blue cat under a tree". Order doesn't matter, and plurals are fine. Wrong guesses appear as sticky notes on the canvas, so guess as often as you like.

## Scoring

| what happens | points |
|---|---|
| First correct guess | guesser +2, Yapper +1 |
| Yapper says a red word | everyone else +1 |
| Time runs out | nobody scores |

## Hosting a demo

The host sees a **mapper.log** panel, but only while they're not guessing, so it never spoils a round. Each line shows which AI handled an utterance, how long it took, and what it drew:

| label | what it means |
|---|---|
| **Qwen 1.5B** | The fine-tuned model answered (the normal case). |
| **Gemini** | Qwen timed out (over 3 s) or errored, so Gemini answered instead. |
| **best guess (Gemini)** | Qwen refused a loose description, so Gemini picked the closest object. Best guesses can only add things; they never edit or remove anything. |
| **keyword** | Both AIs failed, so a simple word parser answered. |
| **warm-up** | The server woke the GPU when the lobby opened. |

**Before recording, wait for "Qwen ready in … ms"** in the panel, then press Start. If the GPU was asleep, waking it takes about 15–25 s. Until then, utterances fall back to Gemini.

## Troubleshooting

- **The 🎤 button is missing.** Your browser has no speech recognition (Firefox, for example). Type instead, or use Chrome, Edge or Safari.
- **Nothing gets drawn.** Describe one thing at a time by what it does, not how it looks. Check the line under the box.
- **The first few utterances are slow or come from Gemini.** The GPU is waking up. Wait for "Qwen ready" in the host panel.
- **"Need 1 more player to start".** Share the invite link; a game needs at least 2 players.

## Running it yourself

```sh
npm install
npm run dev            # frontend on http://localhost:5173, game server (wrangler dev) on :1999
npm run deploy         # build + deploy to Cloudflare Workers
npm run e2e:live       # two-player check against the live site
```

The game server reads four secrets: `QWEN_ENDPOINT_URL`, `MODAL_KEY`, `MODAL_SECRET` and `GEMINI_API_KEY`. Locally they come from `.env`. In production, set each one with `npx wrangler secret put <NAME>`.

**Cost:** while a room is open, the server pings the Qwen GPU every 4 minutes to keep it warm, which keeps one A10G running on Modal. When the last player leaves, the GPU shuts down after 5 minutes idle.

For the model, benchmarks and results behind the AI artist, see [RESULTS.md](RESULTS.md).
