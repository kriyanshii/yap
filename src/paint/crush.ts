import { nearestPalette } from "./palette";

const SMALL = 160;
const CONTRAST = 1.28;

function contrast(v: number): number {
  return Math.max(0, Math.min(255, (v - 128) * CONTRAST + 128));
}

function palettize(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = nearestPalette(
      contrast(d[i]),
      contrast(d[i + 1]),
      contrast(d[i + 2]),
    );
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Crush any image into a chunky 160×160 palettized bitmap, then scale up. */
export function crushToCanvas(
  source: CanvasImageSource,
  dest: HTMLCanvasElement,
) {
  const small = document.createElement("canvas");
  small.width = SMALL;
  small.height = SMALL;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) return;
  sctx.imageSmoothingEnabled = false;
  sctx.fillStyle = "#F8F8F8";
  sctx.fillRect(0, 0, SMALL, SMALL);
  sctx.drawImage(source, 0, 0, SMALL, SMALL);
  palettize(sctx, SMALL, SMALL);

  const dctx = dest.getContext("2d");
  if (!dctx) return;
  dctx.imageSmoothingEnabled = false;
  dctx.drawImage(small, 0, 0, dest.width, dest.height);
}

export function fillEmptyCanvas(dest: HTMLCanvasElement) {
  const ctx = dest.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#F8F8F8";
  ctx.fillRect(0, 0, dest.width, dest.height);
}
