/**
 * The figure. This is a visual mapping, not a measurement: the first two resonances of the
 * voice choose the mode numbers (m, n) of a standing wave on a plate,
 *   C(x, y) = cos(nπx) cos(mπy) − cos(mπx) cos(nπy),
 * and sand gathers where C = 0. Different vowels land on visibly different figures.
 */

export interface Modes {
  m: number;
  n: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** F1 200..950 Hz → m 1..4; F2 700..2600 Hz → n 4.5..9. n stays above m so the figure never vanishes. */
export function chladniModes(f1: number, f2: number, out: Modes = { m: 0, n: 0 }): Modes {
  out.m = 1 + 3 * clamp01((f1 - 200) / 750);
  out.n = 4.5 + 4.5 * clamp01((f2 - 700) / 1900);
  return out;
}

export function chladni(x: number, y: number, m: number, n: number): number {
  const a = n * Math.PI;
  const b = m * Math.PI;
  return Math.cos(a * x) * Math.cos(b * y) - Math.cos(b * x) * Math.cos(a * y);
}

/** Paint the nodal lines of a figure into a small canvas: the still picture of a vowel. */
export function paintFigure(canvas: HTMLCanvasElement, m: number, n: number, color: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const aspect = width / height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  // |C| below a threshold scaled by the local slope draws lines of even width.
  const eps = 2 / height;
  for (let py = 0; py < height; py++) {
    const y = (py / (height - 1)) * 2 - 1;
    for (let px = 0; px < width; px++) {
      const x = ((px / (width - 1)) * 2 - 1) * aspect;
      const c = chladni(x, y, m, n);
      const gx = (chladni(x + eps, y, m, n) - c) / eps;
      const gy = (chladni(x, y + eps, m, n) - c) / eps;
      if (Math.abs(c) < 1.6 * eps * Math.hypot(gx, gy) + 1e-4) ctx.fillRect(px, py, 1, 1);
    }
  }
}
