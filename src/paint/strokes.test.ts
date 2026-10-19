import { describe, expect, it } from "vitest";
import { createStrokePlan } from "./strokes";

describe("createStrokePlan", () => {
  it("is deterministic for every participant", () => {
    const first = createStrokePlan("two clouds above a house and a river", 4821, 2);
    const second = createStrokePlan("two clouds above a house and a river", 4821, 2);

    expect(second).toEqual(first);
    expect(first.duration).toBeGreaterThan(0);
  });

  it("honors counts and colors", () => {
    const oneCar = createStrokePlan("one car", 12);
    const threeCars = createStrokePlan("three red cars", 12);

    expect(threeCars.strokes.length).toBe(oneCar.strokes.length * 3);
    expect(threeCars.strokes.some((stroke) => stroke.fill === "#c95757")).toBe(true);
  });

  it("understands colors stated after an object", () => {
    const plan = createStrokePlan(
      "draw a mountain in orange, have a sun over it",
      12,
    );

    expect(plan.strokes.some((stroke) => stroke.fill === "#e89848")).toBe(true);
    expect(plan.strokes.some((stroke) => stroke.fill === "#eacb55")).toBe(true);
    expect(plan.strokes).toHaveLength(11);
  });

  it("draws background subjects before foreground subjects", () => {
    const plan = createStrokePlan("a car in front of blue mountains", 91);
    const mountainIndex = plan.strokes.findIndex((stroke) => stroke.fill === "#4777c7");
    const carIndex = plan.strokes.findIndex((stroke) => stroke.fill === "#c95757");

    expect(mountainIndex).toBeGreaterThanOrEqual(0);
    expect(carIndex).toBeGreaterThan(mountainIndex);
  });

  it("creates a stable fallback for unsupported subjects", () => {
    const first = createStrokePlan("a telescope beside a castle", 77);
    const second = createStrokePlan("a telescope beside a castle", 77);

    expect(first.strokes.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });

  it("draws a windmill from a spoken circumlocution", () => {
    const spoken = "a machine that generates electricity using wind, a pole and fan over it horizontaly";
    const planned = createStrokePlan(spoken, 4);
    const stamped = createStrokePlan(spoken, 4, 0, [
      { stamp: "tree", color: "brown", size: "large", count: 1, x: 50, y: 58 },
    ]);

    expect(planned.strokes.length).toBeGreaterThan(6);
    expect(stamped.strokes.length).toBe(planned.strokes.length);
  });

  it("draws a dancing bear from a spoken circumlocution", () => {
    const spoken = "a furry animal doing dance which requires standing on one leg and wearing a pink skirt";
    const plan = createStrokePlan(spoken, 8);

    expect(plan.strokes.some((stroke) => stroke.fill === "#e18aa7")).toBe(true);
    expect(plan.strokes.some((stroke) => stroke.fill === "#8b5a35")).toBe(true);
  });

  it("maps unknown scene words onto known stamps", () => {
    const plan = createStrokePlan("a vampire at the beach", 11);
    const vampireOnly = createStrokePlan("a person", 11);
    const beachOnly = createStrokePlan("a river", 11);

    expect(plan.strokes.length).toBeGreaterThan(vampireOnly.strokes.length);
    expect(plan.strokes.length).toBeGreaterThan(beachOnly.strokes.length);
  });

  it("uses model-selected stamp positions instead of keyword layout", () => {
    const plan = createStrokePlan("a cat below a tree", 44, 1, [
      { stamp: "tree", color: "green", size: "medium", count: 1, x: 25, y: 35 },
      { stamp: "cat", color: "orange", size: "small", count: 1, x: 25, y: 78 },
    ]);
    const allPoints = plan.strokes.flatMap((stroke) => stroke.points);

    expect(allPoints.some((point) => point.x < 100 && point.y < 150)).toBe(true);
    expect(allPoints.some((point) => point.x < 100 && point.y > 220)).toBe(true);
  });
});
