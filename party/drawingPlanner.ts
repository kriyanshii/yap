import {
  DRAWING_COLORS,
  DRAWING_STAMP_ALIASES,
  DRAWING_STAMPS,
  type DrawingColor,
  type DrawingOp,
  type DrawingSize,
  type DrawingStamp,
} from "./types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const MAX_OPS = 14;
export const DRAWING_PLANNER_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You are the scene planner for a simple children's drawing game.
Convert the user's utterance and current scene into JSON draw operations for the complete picture.
You never draw pixels.

Return exactly one JSON object: {"ops":[...]}.
Each op must contain:
- stamp: one of ${DRAWING_STAMPS.join(", ")}
- color: one of ${DRAWING_COLORS.join(", ")}
- size: small, medium, or large
- count: integer 1 to 5
- x: horizontal center from 5 (left) to 95 (right)
- y: vertical center from 8 (top) to 92 (bottom)

Compose the whole scene on a 100 by 100 canvas. Resolve relationships into placement:
- above means a smaller y; below means a larger y
- left/right change x
- near objects use nearby coordinates
- between places an object between the referenced objects
- sky objects belong near the top; ground objects near the bottom
- background objects should not hide foreground subjects
Use only stamps that help represent the description. Do not invent stamp names.
Map circumlocutions onto those stamps. A pole with a fan that makes electricity from wind is windmill. A furry animal dancing in a pink skirt is bear. Do not substitute a tree for a windmill or a dog for a dancing bear.
The picture must match the utterance and current scene. Never add decorative or unrelated objects.
Prefer several well-placed operations over unrelated filler. Maximum ${MAX_OPS} operations.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      maxItems: MAX_OPS,
      items: {
        type: "object",
        properties: {
          stamp: { type: "string", enum: DRAWING_STAMPS },
          color: { type: "string", enum: DRAWING_COLORS },
          size: { type: "string", enum: ["small", "medium", "large"] },
          count: { type: "integer", minimum: 1, maximum: 5 },
          x: { type: "number", minimum: 5, maximum: 95 },
          y: { type: "number", minimum: 8, maximum: 92 },
        },
        required: ["stamp", "color", "size", "count", "x", "y"],
      },
    },
  },
  required: ["ops"],
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export async function planDrawing(
  utterance: string,
  currentScene: string,
  apiKey: string | undefined,
  model = DEFAULT_GEMINI_MODEL,
): Promise<DrawingOp[]> {
  if (!apiKey) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAWING_PLANNER_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
      {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [{
          role: "user",
          parts: [{
            text: JSON.stringify({
              utterance: utterance.slice(0, 700),
              currentScene: currentScene.slice(0, 700),
            }),
          }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        },
      }),
      signal: controller.signal,
      },
    );

    if (!response.ok) return [];
    const data = (await response.json()) as GeminiResponse;
    const content = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    if (!content) return [];
    const parsed = JSON.parse(stripCodeFence(content)) as unknown;
    return validateDrawingOps(parsed);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function validateDrawingOps(value: unknown): DrawingOp[] {
  if (!isRecord(value) || !Array.isArray(value.ops)) return [];
  const result: DrawingOp[] = [];

  for (const candidate of value.ops.slice(0, MAX_OPS)) {
    if (!isRecord(candidate)) continue;
    const stamp = normalizeStamp(candidate.stamp);
    if (!stamp || !isDrawingColor(candidate.color)) continue;
    const size = isDrawingSize(candidate.size) ? candidate.size : "medium";
    const count = clampInteger(candidate.count, 1, 5, 1);
    const x = clampNumber(candidate.x, 5, 95, 50);
    const y = clampNumber(candidate.y, 8, 92, 55);
    result.push({ stamp, color: candidate.color, size, count, x, y });
  }

  return result;
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStamp(value: unknown): DrawingStamp | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  if ((DRAWING_STAMPS as readonly string[]).includes(key)) return key as DrawingStamp;
  return DRAWING_STAMP_ALIASES[key] ?? null;
}

function isDrawingColor(value: unknown): value is DrawingColor {
  return typeof value === "string" && (DRAWING_COLORS as readonly string[]).includes(value);
}

function isDrawingSize(value: unknown): value is DrawingSize {
  return value === "small" || value === "medium" || value === "large";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
