export type RGB = readonly [number, number, number];

/** Classic 28-color Paint palette. */
export const PALETTE: RGB[] = [
  [0, 0, 0],
  [128, 128, 128],
  [128, 0, 0],
  [128, 128, 0],
  [0, 128, 0],
  [0, 128, 128],
  [0, 0, 128],
  [128, 0, 128],
  [128, 64, 0],
  [64, 64, 64],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 128, 64],
  [192, 192, 192],
  [255, 128, 128],
  [255, 255, 128],
  [128, 255, 128],
  [128, 255, 255],
  [128, 128, 255],
  [255, 128, 255],
  [255, 255, 255],
  [192, 192, 0],
  [64, 0, 64],
  [0, 64, 128],
];

export const PALETTE_CSS = PALETTE.map(
  ([r, g, b]) => `rgb(${r}, ${g}, ${b})`,
);

export function nearestPalette(r: number, g: number, b: number): RGB {
  let best: RGB = PALETTE[0];
  let bestD = Infinity;
  for (const c of PALETTE) {
    const d =
      (r - c[0]) * (r - c[0]) +
      (g - c[1]) * (g - c[1]) +
      (b - c[2]) * (b - c[2]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
