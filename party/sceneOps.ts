// The scene engine's objects as Paint stamps. Shared by the game server and eval/canvas-check.mts, so the report
// draws exactly what players see.
import type { SceneObject } from "../src/scene/engine.ts";
import type { DrawingOp } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `before` (optional) marks objects changed since then as fresh (animated); the rest appear instantly. */
export function sceneToDrawingOps(objects: SceneObject[], before?: SceneObject[]): DrawingOp[] {
  const previous = new Map((before ?? []).map((o) => [o.id, JSON.stringify(o)]));
  return objects.map((o) => ({
    stamp: o.type,
    color: o.color,
    size: "medium",
    count: 1,
    x: clamp(o.x * 100, 5, 95),
    y: clamp(o.y * 100, 8, 92),
    scale: o.scale,
    key: o.id,
    fresh: previous.get(o.id) !== JSON.stringify(o),
  }));
}
