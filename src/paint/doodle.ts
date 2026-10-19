import { PALETTE, type RGB } from "./palette";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rgb(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const C = {
  black: PALETTE[0],
  gray: PALETTE[1],
  maroon: PALETTE[2],
  olive: PALETTE[3],
  green: PALETTE[4],
  teal: PALETTE[5],
  navy: PALETTE[6],
  brown: PALETTE[8],
  red: PALETTE[10],
  yellow: PALETTE[11],
  lime: PALETTE[12],
  aqua: PALETTE[13],
  blue: PALETTE[14],
  orange: PALETTE[16],
  silver: PALETTE[17],
  white: PALETTE[24],
  purple: PALETTE[26],
};

const STOP = new Set([
  "a", "an", "the", "of", "on", "in", "with", "and", "to", "for", "from",
  "it", "is", "at", "as", "by", "or", "simple", "scene", "no", "text",
  "image", "letters", "watermark", "ui", "toolbar", "screenshot",
  "computer", "this", "that",
]);

function wobble(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  x: number,
  y: number,
  r: number,
  color: RGB,
) {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  const n = 8 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.75 + rng() * 0.4);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function stampSun(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  wobble(ctx, rng, x, y, 14, C.yellow);
  ctx.strokeStyle = rgb(C.orange);
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
    ctx.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24);
    ctx.stroke();
  }
}

function stampTree(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.brown);
  ctx.fillRect(x - 4, y, 8, 28);
  wobble(ctx, rng, x, y - 4, 18, C.green);
  wobble(ctx, rng, x + 6, y + 4, 12, C.lime);
}

function stampHouse(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.maroon);
  ctx.fillRect(x - 18, y, 36, 28);
  ctx.fillStyle = rgb(C.red);
  ctx.beginPath();
  ctx.moveTo(x - 22, y + rng() * 2);
  ctx.lineTo(x, y - 18);
  ctx.lineTo(x + 22, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(C.yellow);
  ctx.fillRect(x - 6, y + 10, 10, 10);
  ctx.fillStyle = rgb(C.brown);
  ctx.fillRect(x + 8, y + 12, 8, 16);
}

function stampCat(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  wobble(ctx, rng, x, y, 16, C.orange);
  ctx.fillStyle = rgb(C.orange);
  ctx.beginPath();
  ctx.moveTo(x - 12, y - 10);
  ctx.lineTo(x - 6, y - 22);
  ctx.lineTo(x - 2, y - 10);
  ctx.moveTo(x + 2, y - 10);
  ctx.lineTo(x + 8, y - 22);
  ctx.lineTo(x + 12, y - 8);
  ctx.fill();
  ctx.fillStyle = rgb(C.black);
  ctx.fillRect(x - 6, y - 2, 3, 3);
  ctx.fillRect(x + 4, y - 2, 3, 3);
  ctx.strokeStyle = rgb(C.orange);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 14, y + 4);
  ctx.quadraticCurveTo(x + 28, y - 10, x + 22, y + 16);
  ctx.stroke();
}

function stampBoat(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.brown);
  ctx.beginPath();
  ctx.moveTo(x - 24, y);
  ctx.lineTo(x + 24, y);
  ctx.lineTo(x + 14, y + 12 + rng() * 3);
  ctx.lineTo(x - 14, y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(C.white);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 28);
  ctx.lineTo(x + 16, y - 6);
  ctx.closePath();
  ctx.fill();
}

function stampMountain(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.gray);
  ctx.beginPath();
  ctx.moveTo(x - 30, y + 20);
  ctx.lineTo(x - 4 + rng() * 6, y - 28);
  ctx.lineTo(x + 32, y + 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(C.white);
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 16);
  ctx.lineTo(x, y - 28);
  ctx.lineTo(x + 8, y - 14);
  ctx.closePath();
  ctx.fill();
}

function stampCar(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.red);
  ctx.fillRect(x - 22, y, 44, 14);
  ctx.fillRect(x - 10, y - 12, 22, 12);
  ctx.fillStyle = rgb(C.aqua);
  ctx.fillRect(x - 6, y - 10, 8, 8);
  ctx.fillStyle = rgb(C.black);
  ctx.beginPath();
  ctx.arc(x - 12, y + 14, 6 + rng(), 0, Math.PI * 2);
  ctx.arc(x + 14, y + 14, 6, 0, Math.PI * 2);
  ctx.fill();
}

function stampHat(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.navy);
  ctx.fillRect(x - 18, y, 36, 5);
  ctx.fillRect(x - 10, y - 16, 20, 16);
  ctx.fillStyle = rgb(C.red);
  ctx.fillRect(x - 10, y - 2, 20, 3 + rng() * 2);
}

function stampPizza(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  wobble(ctx, rng, x, y, 22, C.orange);
  wobble(ctx, rng, x, y, 14, C.yellow);
  ctx.fillStyle = rgb(C.red);
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x - 8 + rng() * 16, y - 8 + rng() * 16, 4, 4);
  }
}

function stampStatue(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  ctx.fillStyle = rgb(C.silver);
  ctx.fillRect(x - 12, y, 24, 36);
  wobble(ctx, rng, x, y - 8, 12, C.gray);
  ctx.fillStyle = rgb(C.gray);
  ctx.fillRect(x - 20, y + 36, 40, 6);
}

function stampPenguin(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  wobble(ctx, rng, x, y, 16, C.black);
  wobble(ctx, rng, x, y + 4, 10, C.white);
  ctx.fillStyle = rgb(C.orange);
  ctx.fillRect(x - 3, y + 2, 8, 4);
}

function stampPerson(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number) {
  wobble(ctx, rng, x, y - 16, 8, C.orange);
  ctx.fillStyle = rgb(C.blue);
  ctx.fillRect(x - 8, y - 6, 16, 22);
  ctx.strokeStyle = rgb(C.black);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 16);
  ctx.lineTo(x - 12, y + 28);
  ctx.moveTo(x + 8, y + 16);
  ctx.lineTo(x + 12, y + 28);
  ctx.stroke();
}

const STAMPS: { key: string; id: string; fn: typeof stampSun }[] = [
  { key: "sun", id: "sun", fn: stampSun },
  { key: "tree", id: "tree", fn: stampTree },
  { key: "house", id: "house", fn: stampHouse },
  { key: "cat", id: "cat", fn: stampCat },
  { key: "kitten", id: "cat", fn: stampCat },
  { key: "boat", id: "boat", fn: stampBoat },
  { key: "ship", id: "boat", fn: stampBoat },
  { key: "mountain", id: "mountain", fn: stampMountain },
  { key: "car", id: "car", fn: stampCar },
  { key: "taxi", id: "car", fn: stampCar },
  { key: "hat", id: "hat", fn: stampHat },
  { key: "pizza", id: "pizza", fn: stampPizza },
  { key: "statue", id: "statue", fn: stampStatue },
  { key: "penguin", id: "penguin", fn: stampPenguin },
  { key: "person", id: "person", fn: stampPerson },
  { key: "people", id: "person", fn: stampPerson },
  { key: "man", id: "person", fn: stampPerson },
  { key: "woman", id: "person", fn: stampPerson },
];

function stampWordBlob(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  word: string,
  x: number,
  y: number,
) {
  const color = PALETTE[hashString(word) % PALETTE.length];
  const kind = hashString(word + "shape") % 3;
  if (kind === 0) wobble(ctx, rng, x, y, 10 + (word.length % 8) * 2, color);
  else if (kind === 1) {
    ctx.fillStyle = rgb(color);
    ctx.fillRect(x - 10, y - 10, 12 + word.length * 2, 14 + rng() * 10);
  } else {
    ctx.strokeStyle = rgb(color);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.quadraticCurveTo(x, y - 18 - rng() * 8, x + 14, y + 4);
    ctx.stroke();
  }
}

/** Ugly local doodle used when Pollinations is slow or dead. */
export function doodleScene(scene: string, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const rng = mulberry32((seed || 1) ^ hashString(scene));

  const sky = rng() > 0.5 ? C.aqua : C.navy;
  ctx.fillStyle = rgb(sky);
  ctx.fillRect(0, 0, 160, 90);
  ctx.fillStyle = rgb(rng() > 0.5 ? C.lime : C.green);
  ctx.fillRect(0, 90, 160, 70);
  ctx.fillStyle = rgb(C.green);
  ctx.fillRect(0, 88, 160, 6);

  const lower = scene.toLowerCase();
  const used = new Set<string>();
  const jobs: { fn: typeof stampSun; x: number; y: number }[] = [];

  for (const stamp of STAMPS) {
    if (used.has(stamp.id)) continue;
    if (lower.includes(stamp.key)) {
      used.add(stamp.id);
      jobs.push({
        fn: stamp.fn,
        x: 28 + rng() * 104,
        y: 48 + rng() * 64,
      });
    }
  }

  for (const job of jobs) job.fn(ctx, rng, job.x, job.y);

  const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const extras = words.slice(-6);
  for (const word of extras) {
    stampWordBlob(ctx, rng, word, 20 + rng() * 120, 30 + rng() * 100);
  }

  if (jobs.length === 0 && extras.length === 0) {
    stampSun(ctx, rng, 30 + rng() * 20, 28);
    stampHouse(ctx, rng, 70 + rng() * 20, 90);
    stampTree(ctx, rng, 120 + rng() * 10, 88);
  }

  ctx.strokeStyle = rgb(C.black);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(rng() * 160, rng() * 160);
    ctx.lineTo(rng() * 160, rng() * 160);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}
