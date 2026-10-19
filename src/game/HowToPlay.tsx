import { useEffect } from "react";

/** The in-game guide: a Paint-style dialog. Opened from the "How to play" / "?" buttons on every screen. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="paint-window help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <span className="title-icon" aria-hidden />
          <span className="title-text" id="help-title">How to play Yap</span>
          <div className="caption-btns">
            <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="help-body">
          <p className="help-lede">
            One player, the <b>Yapper</b>, gets a secret scene like <i>"a blue cat under a tree"</i> and describes it out loud.
            An AI artist draws what they say. Everyone else guesses the scene from the drawing.
          </p>

          <h3>🗣️ If you're the Yapper</h3>
          <ol>
            <li><b>Don't say the words shown in red.</b> They're the objects in the scene. Say one and the round ends.</li>
            <li><b>Describe one thing at a time</b> by what it is or does: <q>the animal that purrs</q>, <q>the bright light of daytime</q>, <q>a fluffy patch in the sky</q>.</li>
            <li><b>Then change it with "it":</b> <q>make it blue</q>, <q>make it bigger</q>, <q>move it to the left</q>. Add the next thing relative to it: <q>put the animal that purrs under it</q>. Say <q>undo</q> to take back the last change.</li>
            <li>Colours, sizes and positions are always allowed.</li>
            <li><b>Hold the mic button and talk</b> (or type), check the words, then press <b>Draw</b>. A line under the box tells you what the artist did.</li>
          </ol>

          <h3>💡 Stuck?</h3>
          <ul>
            <li><b>Hint:</b> shows what the scene is and phrases the artist understands. Tap a phrase to use it. It costs your +1 for that round.</li>
            <li><b>Skip scene:</b> once per game, swap to a new scene with a fresh canvas. The timer keeps running.</li>
          </ul>

          <h3>🔎 If you're guessing</h3>
          <ol>
            <li>Watch the picture build up.</li>
            <li>Type a guess that names <b>every object and colour</b> you see: <q>a blue cat under a tree</q>. Order doesn't matter.</li>
            <li>Wrong guesses show up as sticky notes, so guess as often as you like.</li>
          </ol>

          <h3>🏆 Scoring</h3>
          <ul>
            <li>First correct guess: <b>+2</b> for the guesser, <b>+1</b> for the Yapper (0 if they used a hint).</li>
            <li>Yapper says a red word: <b>+1</b> for everyone else.</li>
            <li>5 rounds of 75 seconds. The Yapper changes every round.</li>
          </ul>

          <h3>🎮 Getting started</h3>
          <ul>
            <li>Create a room and share the link or 4-letter code. You need at least 2 players; 3–6 is the most fun.</li>
            <li>The artist knows five things: <b>cat, tree, house, sun, cloud</b>, in 11 colours.</li>
          </ul>

          <button type="button" className="btn primary help-ok" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
