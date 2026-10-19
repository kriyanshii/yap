// One short sentence for the yapper about what an utterance did to the canvas, e.g. "Drew an orange sun and a cloud".
import type { Op, SceneObject } from "../src/scene/engine.ts";

const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");

export function describeOps(ops: Op[], before: SceneObject[]): string {
  const typeOf = (target: unknown) => (typeof target === "string" ? before.find((o) => o.id === target)?.type : undefined) ?? "thing";
  const adds = ops.filter((o): o is Extract<Op, { op: "add" }> => o.op === "add");
  const parts: string[] = [];
  if (adds.length) {
    const things = adds.map((a) => {
      const words = [a.scale !== undefined ? (a.scale > 1 ? "big" : "small") : "", a.color ?? "", a.type].filter(Boolean).join(" ");
      return `${article(words)} ${words}`;
    });
    parts.push(`drew ${things.length > 1 ? `${things.slice(0, -1).join(", ")} and ${things.at(-1)}` : things[0]}`);
  }
  for (const o of ops) {
    if (o.op === "recolor") parts.push(`made the ${typeOf(o.target)} ${o.color}`);
    if (o.op === "move") parts.push(`moved the ${typeOf(o.target)}`);
    if (o.op === "scale") parts.push(`made the ${typeOf(o.target)} ${o.factor > 1 ? "bigger" : "smaller"}`);
    if (o.op === "delete") parts.push(`removed the ${typeOf(o.target)}`);
    if (o.op === "undo") parts.push("undid the last change");
    if (o.op === "clear") parts.push("cleared the canvas");
  }
  const sentence = parts.join(", ");
  return sentence ? sentence[0].toUpperCase() + sentence.slice(1) : "Nothing changed";
}
