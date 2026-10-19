import { useEffect, useRef, useState } from "react";
import type { DrawingOp } from "../../party/types";
import { fillEmptyCanvas } from "./crush";
import { PALETTE_CSS } from "./palette";
import {
  createStrokePlan,
  type Point,
  type Stroke,
  type StrokePlan,
} from "./strokes";

const TOOLS = [
  { id: "select-free", label: "Free-Form Select" },
  { id: "select", label: "Select" },
  { id: "eraser", label: "Eraser" },
  { id: "fill", label: "Fill With Color" },
  { id: "dropper", label: "Pick Color" },
  { id: "magnifier", label: "Magnifier" },
  { id: "pencil", label: "Pencil" },
  { id: "brush", label: "Brush" },
  { id: "airbrush", label: "Airbrush" },
  { id: "text", label: "Text" },
  { id: "line", label: "Line" },
  { id: "curve", label: "Curve" },
  { id: "rect", label: "Rectangle" },
  { id: "poly", label: "Polygon" },
  { id: "ellipse", label: "Ellipse" },
  { id: "roundrect", label: "Rounded Rectangle" },
] as const;

export type StickyGuess = { name: string; text: string };

type Props = {
  filename: string;
  prompt: string;
  seed: number;
  generation: number;
  paintStartedAt: number;
  drawingOps: DrawingOp[];
  /** drawingOps is a full scene graph: repaint from blank each update instead of layering over the old canvas. */
  sceneMode?: boolean;
  painting: boolean;
  stickies?: StickyGuess[];
};

export function PaintWindow({
  filename,
  prompt,
  seed,
  generation,
  paintStartedAt,
  drawingOps,
  sceneMode = false,
  painting,
  stickies = [],
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const penRef = useRef<HTMLDivElement>(null);
  const [fg, setFg] = useState(0);
  const [bg, setBg] = useState(24);
  const [tool, setTool] = useState("pencil");
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fillEmptyCanvas(canvas);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!prompt) {
      fillEmptyCanvas(canvas);
      setDrawing(false);
      movePen(penRef.current, null);
      return;
    }

    const plan = createStrokePlan(prompt, seed, generation, drawingOps);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = document.createElement("canvas");
    previous.width = canvas.width;
    previous.height = canvas.height;
    previous.getContext("2d")?.drawImage(canvas, 0, 0);
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    let frame = 0;
    let cancelled = false;

    const update = () => {
      if (cancelled || !canvasRef.current) return;
      const elapsed = reducedMotion
        ? plan.duration
        : Math.max(0, Date.now() - paintStartedAt);
      let active: Point | null;
      if (sceneMode) {
        // Moved or deleted objects must not linger, so draw the whole scene from blank (unchanged stamps are instant).
        active = renderPlan(canvasRef.current, plan, elapsed);
      } else {
        active = renderPlan(scratch, plan, elapsed, true);
        composeFrame(canvasRef.current, previous, scratch);
      }
      movePen(penRef.current, active);
      const activeDrawing = elapsed < plan.duration;
      setDrawing(activeDrawing);
      if (activeDrawing) {
        frame = window.requestAnimationFrame(update);
      } else {
        renderPlan(canvasRef.current, plan, plan.duration);
      }
    };

    update();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      movePen(penRef.current, null);
    };
  }, [prompt, seed, generation, paintStartedAt, drawingOps, sceneMode]);

  return (
    <div className="paint-wrap">
      {stickies.map((s, i) => (
        <div
          key={`${s.name}-${s.text}-${i}`}
          className={`sticky sticky-${i % 6}`}
        >
          <b>{s.name}</b>
          <span>{s.text}</span>
        </div>
      ))}

      <div className="paint-window" role="img" aria-label="Paint">
        <div className="title-bar">
          <span className="title-icon" aria-hidden />
          <span className="title-text">
            {filename} - Paint
          </span>
          <div className="caption-btns">
            <button type="button" tabIndex={-1} aria-hidden>
              _
            </button>
            <button type="button" tabIndex={-1} aria-hidden>
              □
            </button>
            <button type="button" className="close" tabIndex={-1} aria-hidden>
              ×
            </button>
          </div>
        </div>

        <div className="menu-bar">
          {"File Edit View Image Colors Help".split(" ").map((m) => (
            <span key={m}>
              <u>{m[0]}</u>
              {m.slice(1)}
            </span>
          ))}
        </div>

        <div className="workspace">
          <div className="tool-strip" aria-hidden>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tool === t.id ? "on" : ""}
                title={t.label}
                tabIndex={-1}
                onClick={() => setTool(t.id)}
              >
                <ToolIcon id={t.id} />
              </button>
            ))}
          </div>

          <div className="canvas-well">
            <div className="canvas-page">
              <div className="canvas-stage">
                <canvas
                  ref={canvasRef}
                  width={320}
                  height={320}
                  className="paint-canvas"
                />
                <div ref={penRef} className="pen-cursor" aria-hidden>
                  <i />
                </div>
              </div>
              {(drawing || painting) && (
                <div className="painting-overlay">Pencil is drawing your words…</div>
              )}
            </div>
          </div>
        </div>

        <div className="color-bar">
          <div className="color-wells">
            <i style={{ background: PALETTE_CSS[fg] }} />
            <i className="back" style={{ background: PALETTE_CSS[bg] }} />
          </div>
          <div className="swatches">
            {PALETTE_CSS.map((c, i) => (
              <button
                key={c + i}
                type="button"
                style={{ background: c }}
                tabIndex={-1}
                aria-label={`Color ${i + 1}`}
                onClick={() => setFg(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setBg(i);
                }}
              />
            ))}
          </div>
        </div>

        <div className="status-bar">
          <span>
            {drawing ? "Drawing every line…" : prompt ? "Drawing complete." : "Ready for dictation."}
          </span>
          <span>320 x 320</span>
        </div>
      </div>
    </div>
  );
}

function renderPlan(
  canvas: HTMLCanvasElement,
  plan: StrokePlan,
  elapsed: number,
  transparent = false,
): Point | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!transparent) {
    ctx.fillStyle = "#f8f8f8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let remaining = elapsed;
  let active: Point | null = plan.strokes[0]?.points[0] ?? null;
  let animating = true;
  for (const item of plan.strokes) {
    // Zero-duration strokes (unchanged scene objects) are always drawn, even while an earlier stroke is still animating.
    if (item.duration === 0) {
      drawStroke(ctx, item, 1);
      continue;
    }
    if (!animating) continue;
    const progress = Math.max(0, Math.min(1, remaining / item.duration));
    if (progress <= 0) { animating = false; continue; }
    active = drawStroke(ctx, item, progress);
    remaining -= item.duration;
    if (progress < 1) animating = false;
  }
  return elapsed >= plan.duration ? null : active;
}

function composeFrame(
  canvas: HTMLCanvasElement,
  previous: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(previous, 0, 0);
  ctx.drawImage(scratch, 0, 0);
}

function drawStroke(ctx: CanvasRenderingContext2D, item: Stroke, progress: number): Point {
  const points = partialPoints(item.points, progress);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);

  if (progress >= 1 && item.closed && item.fill) {
    ctx.closePath();
    ctx.fillStyle = item.fill;
    ctx.fill();
  }
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.stroke();
  return points[points.length - 1];
}

function partialPoints(points: Point[], progress: number): Point[] {
  if (progress >= 1 || points.length < 2) return points;
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y),
  );
  const target = lengths.reduce((sum, value) => sum + value, 0) * progress;
  const result = [points[0]];
  let walked = 0;

  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (walked + length <= target) {
      result.push(points[i + 1]);
      walked += length;
      continue;
    }
    const ratio = length === 0 ? 0 : (target - walked) / length;
    result.push({
      x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
      y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
    });
    break;
  }
  return result;
}

function movePen(element: HTMLDivElement | null, point: Point | null) {
  if (!element) return;
  element.hidden = !point;
  if (!point) return;
  element.style.left = `${(point.x / 320) * 100}%`;
  element.style.top = `${(point.y / 320) * 100}%`;
}

function ToolIcon({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      {id === "select-free" && (
        <path d="M3 3h2v2H3zM7 3h2v2H7zM11 3h2v2h-2zM3 7h2v2H3zM11 7h2v2h-2zM3 11h2v2H3zM7 11h2v2H7zM11 11h2v2h-2z" fill="#000" />
      )}
      {id === "select" && (
        <rect x="3" y="3" width="10" height="10" fill="none" stroke="#000" strokeDasharray="2 1" />
      )}
      {id === "eraser" && (
        <path d="M4 10 l6-6 3 3-6 6H4z" fill="#fcc" stroke="#000" />
      )}
      {id === "fill" && (
        <>
          <path d="M4 8 l4-5 4 5v5H4z" fill="#08f" stroke="#000" />
          <path d="M10 3 l3 2" stroke="#000" />
        </>
      )}
      {id === "dropper" && (
        <path d="M5 12 l6-6 2 2-6 6zM11 4 l2 2" fill="#c0c" stroke="#000" />
      )}
      {id === "magnifier" && (
        <>
          <circle cx="7" cy="7" r="4" fill="none" stroke="#000" />
          <path d="M10 10 l4 4" stroke="#000" strokeWidth="2" />
        </>
      )}
      {id === "pencil" && (
        <path d="M3 13 l7-7 2 2-7 7H3zM10 6 l2-2 2 2-2 2z" fill="#fc0" stroke="#000" />
      )}
      {id === "brush" && (
        <path d="M8 2 v7 h2 v-7z M6 9 h6 l-1 5H7z" fill="#840" stroke="#000" />
      )}
      {id === "airbrush" && (
        <>
          <path d="M5 3 h6 l-2 7H7z" fill="#888" stroke="#000" />
          <circle cx="5" cy="13" r="1" fill="#000" />
          <circle cx="8" cy="12" r="1" fill="#000" />
          <circle cx="11" cy="13" r="1" fill="#000" />
        </>
      )}
      {id === "text" && (
        <text x="3" y="13" fontSize="12" fontFamily="serif" fill="#000">A</text>
      )}
      {id === "line" && <path d="M3 13 L13 3" stroke="#000" />}
      {id === "curve" && (
        <path d="M3 12 Q8 2 13 12" fill="none" stroke="#000" />
      )}
      {id === "rect" && (
        <rect x="3" y="4" width="10" height="8" fill="none" stroke="#000" />
      )}
      {id === "poly" && (
        <path d="M8 2 l5 5 -3 7H6L3 7z" fill="none" stroke="#000" />
      )}
      {id === "ellipse" && (
        <ellipse cx="8" cy="8" rx="5" ry="4" fill="none" stroke="#000" />
      )}
      {id === "roundrect" && (
        <rect x="3" y="4" width="10" height="8" rx="2" fill="none" stroke="#000" />
      )}
    </svg>
  );
}
