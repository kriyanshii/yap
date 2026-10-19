import { DRAWING_STAMP_ALIASES, type DrawingOp, type DrawingSize } from "../../party/types";

export type Point = { x: number; y: number };

export type Stroke = {
  points: Point[];
  color: string;
  width: number;
  closed?: boolean;
  fill?: string;
  duration: number;
};

export type StrokePlan = {
  strokes: Stroke[];
  duration: number;
};

type Builder = (x: number, y: number, scale: number, color: string, rng: Rng) => Stroke[];
type Rng = () => number;

const INK = "#26324a";
const COLORS: Record<string, string> = {
  black: "#202020",
  blue: "#4777c7",
  brown: "#8b5a35",
  gray: "#8f96a6",
  green: "#55965b",
  orange: "#e89848",
  pink: "#e18aa7",
  purple: "#8665aa",
  red: "#c95757",
  white: "#f7f4e8",
  yellow: "#eacb55",
};

const COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

const STOP = new Set([
  "a", "above", "add", "an", "and", "are", "at", "behind", "below", "beside", "big",
  "bottom", "draw", "drawing", "from", "front", "have", "in", "is", "it", "large",
  "left", "little", "make", "middle", "near", "next", "of", "on", "over", "place",
  "put", "right", "scene", "show", "small", "the", "there", "to", "top", "under",
  "using", "which", "doing", "with", ...Object.keys(COLORS), ...Object.keys(COUNTS),
]);

const aliases: { keys: string[]; id: string; builder: Builder; defaultColor: string; layer: number }[] = [
  { keys: ["mountains", "mountain", "hills", "hill"], id: "mountain", builder: mountain, defaultColor: "#65739b", layer: 0 },
  { keys: ["river", "stream", "road"], id: "river", builder: river, defaultColor: "#58a6c7", layer: 0 },
  { keys: ["clouds", "cloud"], id: "cloud", builder: cloud, defaultColor: "#f7f4e8", layer: 1 },
  { keys: ["sun"], id: "sun", builder: sun, defaultColor: COLORS.yellow, layer: 1 },
  { keys: ["moon"], id: "moon", builder: moon, defaultColor: "#e7df9b", layer: 1 },
  { keys: ["trees", "tree"], id: "tree", builder: tree, defaultColor: COLORS.green, layer: 2 },
  { keys: ["houses", "house", "home"], id: "house", builder: house, defaultColor: COLORS.red, layer: 2 },
  { keys: ["people", "person", "woman", "man", "girl", "boy"], id: "person", builder: person, defaultColor: COLORS.blue, layer: 3 },
  { keys: ["cats", "cat", "kitten"], id: "cat", builder: cat, defaultColor: COLORS.orange, layer: 3 },
  { keys: ["dogs", "dog", "puppy"], id: "dog", builder: dog, defaultColor: COLORS.brown, layer: 3 },
  { keys: ["birds", "bird"], id: "bird", builder: bird, defaultColor: INK, layer: 3 },
  { keys: ["fish"], id: "fish", builder: fish, defaultColor: COLORS.orange, layer: 3 },
  { keys: ["boats", "boat", "ship"], id: "boat", builder: boat, defaultColor: COLORS.brown, layer: 3 },
  { keys: ["cars", "car", "taxi", "truck"], id: "car", builder: car, defaultColor: COLORS.red, layer: 3 },
  { keys: ["windmills", "windmill", "turbine", "turbines"], id: "windmill", builder: windmill, defaultColor: "#8f96a6", layer: 2 },
  { keys: ["bears", "bear", "teddy"], id: "bear", builder: bear, defaultColor: COLORS.brown, layer: 3 },
];

type Job = {
  id: string;
  builder: Builder;
  color: string;
  count: number;
  index: number;
  layer: number;
  location?: "left" | "right" | "top" | "bottom";
  x?: number;
  y?: number;
  size?: DrawingSize;
};

export function createStrokePlan(
  scene: string,
  seed: number,
  generation = 0,
  operations: DrawingOp[] = [],
): StrokePlan {
  const lower = scene.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const rng = mulberry32((seed || 1) ^ hashString(lower) ^ Math.imul(generation + 1, 10007));
  const jobs: Job[] = [];
  const dancing = isBalletTalk(lower);

  if (operations.length > 0) {
    for (const [index, operation] of operations.entries()) {
      const stamp = rewriteStamp(operation.stamp, lower);
      const item = aliases.find((candidate) => candidate.id === stamp);
      if (!item) continue;
      jobs.push({
        id: item.id,
        builder: item.id === "bear" ? bearBuilder(dancing) : item.builder,
        color: COLORS[operation.color] ?? item.defaultColor,
        count: operation.count,
        index,
        layer: item.layer,
        x: operation.x,
        y: operation.y,
        size: operation.size,
      });
    }
  } else {
    addFallbackJobs(lower, jobs);
  }

  if (jobs.length === 0) {
    jobs.push({ id: "doodle", builder: genericObject("doodle"), color: COLORS.blue, count: 1, index: 0, layer: 3 });
  }

  jobs.sort((a, b) => a.layer - b.layer || a.index - b.index);
  const strokes: Stroke[] = [];
  const foreground = jobs.filter((job) => job.layer >= 2).reduce((sum, job) => sum + job.count, 0);
  let foregroundIndex = 0;

  for (const job of jobs) {
    for (let i = 0; i < job.count; i++) {
      const position = positionFor(job, i, job.count, foregroundIndex, foreground, rng);
      const baseScale = job.id === "mountain" ? 1.25 : Math.max(0.72, 1.05 - job.count * 0.07);
      const sizeScale = job.size === "small" ? 0.65 : job.size === "large" ? 1.3 : 1;
      const scale = baseScale * sizeScale;
      strokes.push(...job.builder(position.x, position.y, scale, job.color, rng));
      if (job.layer >= 2) foregroundIndex += 1;
    }
  }

  const duration = strokes.reduce((sum, item) => sum + item.duration, 0);
  return { strokes, duration };
}

function positionFor(
  job: Job,
  itemIndex: number,
  count: number,
  foregroundIndex: number,
  foregroundCount: number,
  rng: Rng,
): Point {
  if (job.x !== undefined && job.y !== undefined) {
    const spacing = job.size === "small" ? 24 : job.size === "large" ? 52 : 38;
    return {
      x: (job.x / 100) * 320 + (itemIndex - (count - 1) / 2) * spacing,
      y: (job.y / 100) * 320,
    };
  }
  if (job.id === "mountain") return { x: 88 + itemIndex * 140, y: 135 };
  if (job.id === "river") return { x: 160, y: 225 };
  if (job.id === "cloud") return { x: 70 + itemIndex * 105, y: 55 + rng() * 22 };
  if (job.id === "sun" || job.id === "moon") return { x: job.location === "left" ? 55 : 264, y: 52 };
  if (job.id === "bird") return { x: 72 + itemIndex * 75, y: 80 + rng() * 35 };

  const slots = Math.max(1, foregroundCount);
  let x = 42 + ((foregroundIndex + 0.5) / slots) * 236;
  let y = 214 + (foregroundIndex % 2) * 36;
  if (count > 1) x += (itemIndex - (count - 1) / 2) * 6;
  if (job.location === "left") x = 58 + itemIndex * 52;
  if (job.location === "right") x = 260 - itemIndex * 52;
  if (job.location === "top") y = 105;
  if (job.location === "bottom") y = 270;
  return { x, y };
}

function addFallbackJobs(lower: string, jobs: Job[]) {
  for (const item of aliases) {
    const match = earliestMatch(lower, item.keys);
    if (!match) continue;
    const context = lower.slice(Math.max(0, match.index - 30), match.index);
    const colors = Object.keys(COLORS).join("|");
    const countWord = context.match(
      new RegExp(`\\b(one|two|three|four|five|\\d)\\s+(?:(?:${colors})\\s+)?$`),
    )?.[1];
    const count = Math.min(5, countWord ? COUNTS[countWord] ?? Number(countWord) : 1);
    const color = colorForMatch(lower, match.index, match.key);
    const location = (["left", "right", "top", "bottom"] as const).find((name) =>
      new RegExp(`\\b${name}\\b`).test(context),
    );
    jobs.push({
      id: item.id,
      builder: item.id === "bear" ? bearBuilder(isBalletTalk(lower)) : item.builder,
      color: COLORS[color] ?? item.defaultColor,
      count,
      index: match.index,
      layer: item.layer,
      location,
    });
  }

  addPhraseJobs(lower, jobs);

  const recognized = new Set(aliases.flatMap((item) => item.keys));
  const unknown = lower
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word) && !recognized.has(word) && !FILLER.has(word))
    .filter((word, index, words) => words.indexOf(word) === index)
    .slice(0, jobs.length ? 2 : 5);

  for (const word of unknown) {
    const aliased = DRAWING_STAMP_ALIASES[word];
    const item = aliased ? aliases.find((candidate) => candidate.id === aliased) : undefined;
    if (item) {
      if (jobs.some((job) => job.id === item.id)) continue;
      jobs.push({
        id: item.id,
        builder: item.id === "bear" ? bearBuilder(isBalletTalk(lower)) : item.builder,
        color: item.defaultColor,
        count: 1,
        index: lower.indexOf(word),
        layer: item.layer,
      });
      continue;
    }
    if (jobs.length > 0) continue;
    jobs.push({
      id: word,
      builder: genericObject(word),
      color: paletteFor(word),
      count: 1,
      index: lower.indexOf(word),
      layer: 3,
    });
  }
}

const FILLER = new Set([
  "ballet", "dance", "dancing", "electricity", "generates", "horizontally", "horizontaly",
  "leg", "machine", "requires", "skirt", "standing", "tutu", "wearing",
]);

function isWindmillTalk(text: string) {
  return /\b(wind|electricity|turbine|mill)\b/.test(text) && /\b(pole|fan|blades?|machine|windmill)\b/.test(text);
}

function isBalletTalk(text: string) {
  return /\b(dance|dancing|ballet|tutu|skirt)\b/.test(text);
}

function isBalletBearTalk(text: string) {
  return isBalletTalk(text) && /\b(bear|furry|animal|teddy)\b/.test(text);
}

function rewriteStamp(stamp: DrawingOp["stamp"], text: string): DrawingOp["stamp"] {
  if (isWindmillTalk(text) && (stamp === "tree" || stamp === "house")) return "windmill";
  if (isBalletBearTalk(text) && (stamp === "dog" || stamp === "cat" || stamp === "person")) return "bear";
  return stamp;
}

function addPhraseJobs(lower: string, jobs: Job[]) {
  if (isWindmillTalk(lower) && !jobs.some((job) => job.id === "windmill")) {
    jobs.push({
      id: "windmill",
      builder: windmill,
      color: "#8f96a6",
      count: 1,
      index: 0,
      layer: 2,
    });
  }
  if (isBalletBearTalk(lower) && !jobs.some((job) => job.id === "bear")) {
    jobs.push({
      id: "bear",
      builder: bearBuilder(true),
      color: COLORS.brown,
      count: 1,
      index: 1,
      layer: 3,
    });
  }
}

function bearBuilder(dancing: boolean): Builder {
  return (x, y, scale, color, rng) => bear(x, y, scale, color, rng, dancing);
}

function colorForMatch(text: string, index: number, key: string) {
  const colors = Object.keys(COLORS).join("|");
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + key.length, index + key.length + 24);
  const leading = before.match(new RegExp(`\\b(${colors})\\s*$`))?.[1];
  if (leading) return leading;
  return after.match(
    new RegExp(`^\\s*(?:(?:in|colored|coloured)\\s+)?(${colors})\\b`),
  )?.[1] ?? "";
}

function earliestMatch(text: string, keys: string[]) {
  let best: { index: number; key: string } | null = null;
  for (const key of keys) {
    const match = new RegExp(`\\b${key}\\b`).exec(text);
    if (match && (!best || match.index < best.index)) best = { index: match.index, key };
  }
  return best;
}

function stroke(points: Point[], color = INK, width = 3, fill?: string, closed = false): Stroke {
  const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
  return {
    points,
    color,
    width,
    fill,
    closed,
    duration: Math.round(Math.max(110, Math.min(720, length * 3.4))),
  };
}

function polygon(points: Point[], fill: string, color = INK, width = 3) {
  return stroke([...points, points[0]], color, width, fill, true);
}

function ellipse(cx: number, cy: number, rx: number, ry: number, fill?: string, color = INK, width = 3) {
  const points = Array.from({ length: 25 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
  return stroke(points, color, width, fill, true);
}

function line(points: Point[], color = INK, width = 3) {
  return stroke(points, color, width);
}

function sun(x: number, y: number, scale: number, color: string) {
  const result = [ellipse(x, y, 18 * scale, 18 * scale, color, "#c78a32", 3)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    result.push(line([
      { x: x + Math.cos(a) * 23 * scale, y: y + Math.sin(a) * 23 * scale },
      { x: x + Math.cos(a) * 33 * scale, y: y + Math.sin(a) * 33 * scale },
    ], "#c78a32", 3));
  }
  return result;
}

function moon(x: number, y: number, scale: number, color: string) {
  return [
    ellipse(x, y, 22 * scale, 22 * scale, color),
    ellipse(x + 10 * scale, y - 7 * scale, 20 * scale, 20 * scale, "#f8f8f8", "#f8f8f8", 2),
  ];
}

function cloud(x: number, y: number, scale: number, color: string) {
  return [
    ellipse(x - 20 * scale, y + 5 * scale, 21 * scale, 13 * scale, color, "#7c8392", 2),
    ellipse(x, y - 3 * scale, 25 * scale, 18 * scale, color, "#7c8392", 2),
    ellipse(x + 23 * scale, y + 5 * scale, 20 * scale, 13 * scale, color, "#7c8392", 2),
    line([{ x: x - 39 * scale, y: y + 10 * scale }, { x: x + 42 * scale, y: y + 10 * scale }], "#7c8392", 2),
  ];
}

function mountain(x: number, y: number, scale: number, color: string) {
  return [
    polygon([
      { x: x - 78 * scale, y: y + 50 * scale },
      { x, y: y - 50 * scale },
      { x: x + 82 * scale, y: y + 50 * scale },
    ], color),
    polygon([
      { x: x - 18 * scale, y: y - 27 * scale },
      { x, y: y - 50 * scale },
      { x: x + 20 * scale, y: y - 25 * scale },
      { x: x + 8 * scale, y: y - 31 * scale },
      { x: x - 3 * scale, y: y - 20 * scale },
    ], "#e8e8df", "#657080", 2),
  ];
}

function river(x: number, y: number, scale: number, color: string) {
  return [
    polygon([
      { x: x - 30 * scale, y: y - 66 * scale },
      { x: x + 20 * scale, y: y - 66 * scale },
      { x: x + 80 * scale, y: y + 85 * scale },
      { x: x - 92 * scale, y: y + 85 * scale },
    ], color, "#397f9f", 2),
    line([
      { x: x - 3 * scale, y: y - 43 * scale },
      { x: x + 14 * scale, y: y - 10 * scale },
      { x: x - 15 * scale, y: y + 30 * scale },
      { x: x + 22 * scale, y: y + 65 * scale },
    ], "#9bd4df", 3),
  ];
}

function tree(x: number, y: number, scale: number, color: string) {
  return [
    polygon([
      { x: x - 6 * scale, y: y - 10 * scale },
      { x: x + 7 * scale, y: y - 10 * scale },
      { x: x + 9 * scale, y: y + 40 * scale },
      { x: x - 8 * scale, y: y + 40 * scale },
    ], COLORS.brown),
    ellipse(x, y - 26 * scale, 25 * scale, 27 * scale, color),
    ellipse(x - 16 * scale, y - 12 * scale, 18 * scale, 20 * scale, color),
    ellipse(x + 17 * scale, y - 10 * scale, 18 * scale, 21 * scale, color),
  ];
}

function house(x: number, y: number, scale: number, color: string) {
  return [
    polygon([
      { x: x - 36 * scale, y: y - 18 * scale },
      { x: x + 36 * scale, y: y - 18 * scale },
      { x: x + 36 * scale, y: y + 40 * scale },
      { x: x - 36 * scale, y: y + 40 * scale },
    ], "#e7c98c"),
    polygon([
      { x: x - 44 * scale, y: y - 17 * scale },
      { x, y: y - 58 * scale },
      { x: x + 44 * scale, y: y - 17 * scale },
    ], color),
    polygon([
      { x: x + 8 * scale, y: y + 7 * scale },
      { x: x + 25 * scale, y: y + 7 * scale },
      { x: x + 25 * scale, y: y + 40 * scale },
      { x: x + 8 * scale, y: y + 40 * scale },
    ], COLORS.brown),
    polygon([
      { x: x - 27 * scale, y: y - 4 * scale },
      { x: x - 8 * scale, y: y - 4 * scale },
      { x: x - 8 * scale, y: y + 14 * scale },
      { x: x - 27 * scale, y: y + 14 * scale },
    ], "#8dc7d4"),
  ];
}

function person(x: number, y: number, scale: number, color: string) {
  return [
    ellipse(x, y - 34 * scale, 11 * scale, 12 * scale, "#d7a06e"),
    polygon([
      { x: x - 15 * scale, y: y - 20 * scale },
      { x: x + 15 * scale, y: y - 20 * scale },
      { x: x + 11 * scale, y: y + 17 * scale },
      { x: x - 11 * scale, y: y + 17 * scale },
    ], color),
    line([{ x: x - 13 * scale, y: y - 13 * scale }, { x: x - 27 * scale, y: y + 4 * scale }]),
    line([{ x: x + 13 * scale, y: y - 13 * scale }, { x: x + 27 * scale, y: y + 4 * scale }]),
    line([{ x: x - 7 * scale, y: y + 17 * scale }, { x: x - 12 * scale, y: y + 43 * scale }]),
    line([{ x: x + 7 * scale, y: y + 17 * scale }, { x: x + 12 * scale, y: y + 43 * scale }]),
  ];
}

function cat(x: number, y: number, scale: number, color: string) {
  return animal(x, y, scale, color, true);
}

function dog(x: number, y: number, scale: number, color: string) {
  return animal(x, y, scale, color, false);
}

function animal(x: number, y: number, scale: number, color: string, pointy: boolean) {
  const ears = pointy
    ? [
        polygon([{ x: x - 24 * scale, y: y - 28 * scale }, { x: x - 16 * scale, y: y - 50 * scale }, { x: x - 5 * scale, y: y - 26 * scale }], color),
        polygon([{ x: x + 5 * scale, y: y - 26 * scale }, { x: x + 17 * scale, y: y - 50 * scale }, { x: x + 25 * scale, y: y - 26 * scale }], color),
      ]
    : [
        ellipse(x - 24 * scale, y - 27 * scale, 9 * scale, 18 * scale, color),
        ellipse(x + 24 * scale, y - 27 * scale, 9 * scale, 18 * scale, color),
      ];
  return [
    ...ears,
    ellipse(x, y - 20 * scale, 27 * scale, 23 * scale, color),
    ellipse(x, y + 16 * scale, 24 * scale, 28 * scale, color),
    ellipse(x - 9 * scale, y - 23 * scale, 2.5 * scale, 3 * scale, INK),
    ellipse(x + 9 * scale, y - 23 * scale, 2.5 * scale, 3 * scale, INK),
    line([{ x, y: y - 14 * scale }, { x: x - 5 * scale, y: y - 8 * scale }, { x: x + 5 * scale, y: y - 8 * scale }], INK, 2),
    line([{ x: x + 22 * scale, y: y + 15 * scale }, { x: x + 38 * scale, y: y - 2 * scale }, { x: x + 43 * scale, y: y + 12 * scale }], color, 4),
  ];
}

function bird(x: number, y: number, scale: number, color: string) {
  return [
    line([
      { x: x - 26 * scale, y: y + 7 * scale },
      { x: x - 13 * scale, y: y - 5 * scale },
      { x, y: y + 7 * scale },
      { x: x + 13 * scale, y: y - 5 * scale },
      { x: x + 26 * scale, y: y + 7 * scale },
    ], color, 4),
  ];
}

function fish(x: number, y: number, scale: number, color: string) {
  return [
    ellipse(x, y, 28 * scale, 15 * scale, color),
    polygon([
      { x: x - 26 * scale, y },
      { x: x - 47 * scale, y: y - 17 * scale },
      { x: x - 47 * scale, y: y + 17 * scale },
    ], color),
    ellipse(x + 14 * scale, y - 4 * scale, 2.5 * scale, 2.5 * scale, INK),
  ];
}

function boat(x: number, y: number, scale: number, color: string) {
  return [
    polygon([
      { x: x - 42 * scale, y },
      { x: x + 42 * scale, y },
      { x: x + 27 * scale, y: y + 23 * scale },
      { x: x - 27 * scale, y: y + 23 * scale },
    ], color),
    line([{ x, y }, { x, y: y - 61 * scale }], INK, 3),
    polygon([
      { x: x + 2 * scale, y: y - 57 * scale },
      { x: x + 2 * scale, y: y - 5 * scale },
      { x: x + 37 * scale, y: y - 5 * scale },
    ], "#eee8d8"),
  ];
}

function car(x: number, y: number, scale: number, color: string) {
  return [
    polygon([
      { x: x - 45 * scale, y: y - 7 * scale },
      { x: x - 28 * scale, y: y - 28 * scale },
      { x: x + 19 * scale, y: y - 28 * scale },
      { x: x + 37 * scale, y: y - 7 * scale },
      { x: x + 46 * scale, y: y - 7 * scale },
      { x: x + 46 * scale, y: y + 17 * scale },
      { x: x - 45 * scale, y: y + 17 * scale },
    ], color),
    polygon([
      { x: x - 22 * scale, y: y - 24 * scale },
      { x: x - 8 * scale, y: y - 24 * scale },
      { x: x - 8 * scale, y: y - 8 * scale },
      { x: x - 31 * scale, y: y - 8 * scale },
    ], "#8dc7d4", INK, 2),
    polygon([
      { x: x - 3 * scale, y: y - 24 * scale },
      { x: x + 16 * scale, y: y - 24 * scale },
      { x: x + 30 * scale, y: y - 8 * scale },
      { x: x - 3 * scale, y: y - 8 * scale },
    ], "#8dc7d4", INK, 2),
    ellipse(x - 27 * scale, y + 18 * scale, 9 * scale, 9 * scale, INK),
    ellipse(x + 28 * scale, y + 18 * scale, 9 * scale, 9 * scale, INK),
  ];
}

function windmill(x: number, y: number, scale: number, color: string) {
  const blades = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 5;
    return polygon([
      { x: x + Math.cos(a) * 8 * scale, y: y - 38 * scale + Math.sin(a) * 8 * scale },
      { x: x + Math.cos(a - 0.28) * 52 * scale, y: y - 38 * scale + Math.sin(a - 0.28) * 52 * scale },
      { x: x + Math.cos(a + 0.28) * 52 * scale, y: y - 38 * scale + Math.sin(a + 0.28) * 52 * scale },
    ], "#d8d2c4", INK, 2);
  });
  return [
    polygon([
      { x: x - 16 * scale, y: y + 48 * scale },
      { x: x + 16 * scale, y: y + 48 * scale },
      { x: x + 11 * scale, y: y - 18 * scale },
      { x: x - 11 * scale, y: y - 18 * scale },
    ], color),
    polygon([
      { x: x - 14 * scale, y: y - 18 * scale },
      { x: x + 14 * scale, y: y - 18 * scale },
      { x: x + 10 * scale, y: y - 38 * scale },
      { x: x - 10 * scale, y: y - 38 * scale },
    ], "#c4b49a"),
    ...blades,
    ellipse(x, y - 38 * scale, 7 * scale, 7 * scale, COLORS.brown),
  ];
}

function bear(x: number, y: number, scale: number, color: string, _rng: Rng, dancing = false) {
  const headY = dancing ? y - 28 * scale : y - 22 * scale;
  const bodyY = dancing ? y + 8 * scale : y + 16 * scale;
  const result = [
    ellipse(x - 20 * scale, headY - 16 * scale, 9 * scale, 9 * scale, color),
    ellipse(x + 20 * scale, headY - 16 * scale, 9 * scale, 9 * scale, color),
    ellipse(x, bodyY, 26 * scale, dancing ? 22 * scale : 28 * scale, color),
    ellipse(x, headY, 22 * scale, 19 * scale, color),
    ellipse(x, headY + 8 * scale, 10 * scale, 7 * scale, "#c48a55"),
    ellipse(x - 7 * scale, headY - 4 * scale, 2.4 * scale, 2.8 * scale, INK),
    ellipse(x + 7 * scale, headY - 4 * scale, 2.4 * scale, 2.8 * scale, INK),
    ellipse(x, headY + 6 * scale, 2.2 * scale, 2 * scale, INK),
  ];
  if (dancing) {
    result.push(
      polygon([
        { x: x - 28 * scale, y: y + 6 * scale },
        { x: x + 28 * scale, y: y + 6 * scale },
        { x: x + 34 * scale, y: y + 26 * scale },
        { x: x - 34 * scale, y: y + 26 * scale },
      ], COLORS.pink),
      line([{ x: x - 8 * scale, y: y + 26 * scale }, { x: x - 14 * scale, y: y + 46 * scale }], color, 5),
      line([{ x: x + 8 * scale, y: y + 24 * scale }, { x: x + 28 * scale, y: y + 8 * scale }], color, 5),
      line([{ x: x - 16 * scale, y: y - 4 * scale }, { x: x - 32 * scale, y: y - 22 * scale }], color, 4),
      line([{ x: x + 16 * scale, y: y - 4 * scale }, { x: x + 34 * scale, y: y - 18 * scale }], color, 4),
    );
  } else {
    result.push(
      line([{ x: x - 12 * scale, y: y + 38 * scale }, { x: x - 16 * scale, y: y + 50 * scale }], color, 5),
      line([{ x: x + 12 * scale, y: y + 38 * scale }, { x: x + 16 * scale, y: y + 50 * scale }], color, 5),
    );
  }
  return result;
}

function genericObject(word: string): Builder {
  return (x, y, scale, color, rng) => {
    const sides = 5 + (hashString(word) % 4);
    const points = Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const radius = (28 + rng() * 8) * scale;
      return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    });
    const result = [polygon(points, color)];
    const marks = 2 + (hashString(word + "marks") % 3);
    for (let i = 0; i < marks; i++) {
      const offset = (i - (marks - 1) / 2) * 12 * scale;
      result.push(line([
        { x: x + offset, y: y - 10 * scale },
        { x: x + offset + (rng() - 0.5) * 8, y: y + 12 * scale },
      ], INK, 2));
    }
    return result;
  };
}

function paletteFor(word: string) {
  const palette = [COLORS.blue, COLORS.green, COLORS.orange, COLORS.pink, COLORS.purple, COLORS.red, COLORS.yellow];
  return palette[hashString(word) % palette.length];
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
