import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRAWING_PLANNER_TIMEOUT_MS,
  planDrawing,
  validateDrawingOps,
} from "./drawingPlanner";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("drawing planner validation", () => {
  it("accepts known stamps and clamps unsafe values", () => {
    const operations = validateDrawingOps({
      ops: [
        {
          stamp: "cat",
          color: "orange",
          size: "large",
          count: 99,
          x: -100,
          y: 200,
        },
      ],
    });

    expect(operations).toEqual([
      {
        stamp: "cat",
        color: "orange",
        size: "large",
        count: 5,
        x: 5,
        y: 92,
      },
    ]);
  });

  it("rejects invented stamps and malformed operations", () => {
    const operations = validateDrawingOps({
      ops: [
        { stamp: "dragon", color: "green", size: "large", count: 1, x: 50, y: 50 },
        { stamp: "tree", color: "chartreuse", size: "medium", count: 1, x: 50, y: 50 },
        null,
      ],
    });

    expect(operations).toEqual([]);
  });

  it("maps Gemini inventions onto known stamps", () => {
    const operations = validateDrawingOps({
      ops: [
        { stamp: "water", color: "blue", size: "large", count: 1, x: 50, y: 70 },
        { stamp: "vampire", color: "black", size: "medium", count: 1, x: 40, y: 55 },
        { stamp: "sun", color: "yellow", size: "small", count: 1, x: 80, y: 18 },
      ],
    });

    expect(operations.map((op) => op.stamp)).toEqual(["river", "person", "sun"]);
  });

  it("maps wind and dance talk onto new stamps", () => {
    const operations = validateDrawingOps({
      ops: [
        { stamp: "fan", color: "gray", size: "large", count: 1, x: 50, y: 55 },
        { stamp: "furry", color: "brown", size: "medium", count: 1, x: 48, y: 60 },
      ],
    });

    expect(operations.map((op) => op.stamp)).toEqual(["windmill", "bear"]);
  });

  it("falls back without making a Gemini request when no key is configured", async () => {
    await expect(planDrawing("add a cat", "a tree", undefined)).resolves.toEqual([]);
  });

  it("parses Gemini structured output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                ops: [{
                  stamp: "mountain",
                  color: "orange",
                  size: "large",
                  count: 1,
                  x: 50,
                  y: 62,
                }],
              }),
            }],
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await planDrawing(
      "draw a mountain in orange",
      "",
      "test-key",
    );

    expect(result[0]).toMatchObject({ stamp: "mountain", color: "orange" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("gemini-3.5-flash-lite:generateContent"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-goog-api-key": "test-key" }),
      }),
    );
  });

  it("treats malformed Gemini output as a fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "not json" }] } }],
      }),
    }));

    await expect(planDrawing("add a sun", "", "test-key")).resolves.toEqual([]);
    expect(DRAWING_PLANNER_TIMEOUT_MS).toBe(8000);
  });

  it("aborts Gemini and falls back after 1.5 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    ));

    const pending = planDrawing("add a sun", "", "test-key");
    await vi.advanceTimersByTimeAsync(DRAWING_PLANNER_TIMEOUT_MS);
    await expect(pending).resolves.toEqual([]);
  });
});
