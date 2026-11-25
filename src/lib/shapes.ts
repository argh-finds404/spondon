import { chladniModes, type Modes } from "./chladni";
import type { SpectralPeak } from "@/types/dsp";

/**
 * Multi-geometry standing-wave eigenmode math for SPONDON's 3D & 2D physics stage:
 * 1. Cylindrical Bessel functions J_m(z) and circular membrane / brass disc roots α_{m,n}.
 * 2. Multi-harmonic 2D wave superposition Ψ(x, z) driven by up to 6 live FFT spectral peaks.
 * 3. Smooth spline interpolation of 1D Kelly-Lochbaum vocal-tract cross-sections A(s).
 */

/** Positive zeros α_{m,n} of J_m(z) for azimuthal order m = 0..5 and radial ring n = 1..5. */
export const BESSEL_ROOTS: readonly (readonly number[])[] = [
  [2.4048, 5.5201, 8.6537, 11.7915, 14.9309],
  [3.8317, 7.0156, 10.1735, 13.3237, 16.4706],
  [5.1356, 8.4172, 11.6198, 14.796, 17.9598],
  [6.3802, 9.761, 13.0152, 16.2235, 19.4094],
  [7.5883, 11.0647, 14.3725, 17.616, 20.8269],
  [8.7715, 12.3386, 15.7002, 18.9801, 22.2178],
];

/**
 * Cylindrical Bessel function of the first kind J_m(x) for integer m >= 0 and x >= 0.
 * Uses convergent power series for small/moderate x and Hankel's asymptotic expansion for large x.
 */
export function besselJ(m: number, x: number): number {
  const order = Math.max(0, Math.round(m));
  const ax = Math.abs(x);
  if (ax < 1e-10) return order === 0 ? 1 : 0;

  if (ax > 16 + order * 1.5) {
    const phase = ax - (order * Math.PI) / 2 - Math.PI / 4;
    const inv = 1 / ax;
    const mu = 4 * order * order;
    const p = 1 - ((mu - 1) * (mu - 9) * inv * inv) / 128;
    const q = ((mu - 1) * inv) / 8;
    return Math.sqrt(2 / (Math.PI * ax)) * (p * Math.cos(phase) - q * Math.sin(phase));
  }

  // Power series: J_m(x) = sum_{k=0}^inf (-1)^k (x/2)^(2k + m) / (k! (k + m)!)
  const half = 0.5 * ax;
  let term = 1;
  for (let i = 1; i <= order; i++) term *= half / i;
  let sum = term;
  const negHalfSq = -half * half;
  for (let k = 1; k <= 34; k++) {
    term *= negHalfSq / (k * (k + order));
    sum += term;
    if (Math.abs(term) < 1e-12 * Math.abs(sum)) break;
  }
  return x < 0 && (order & 1) === 1 ? -sum : sum;
}

export interface CircularModes {
  /** Azimuthal diameter lines (continuous 1..5 for smooth morphing). */
  m: number;
  /** Radial nodal rings (continuous 1.2..4.2). */
  n: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Map F1 (200..950 Hz) -> azimuthal m (1..4.5) and F2 (700..2650 Hz) -> radial ring index n (1.2..3.8). */
export function circularModes(
  f1: number,
  f2: number,
  out: CircularModes = { m: 2, n: 2 },
): CircularModes {
  out.m = 1 + 3.5 * clamp01((f1 - 200) / 750);
  out.n = 1.15 + 2.65 * clamp01((f2 - 700) / 1950);
  return out;
}

/**
 * Interpolated Bessel root α(m, n) for continuous (m, n) so morphing between vowels is continuous.
 */
export function besselAlpha(m: number, n: number): number {
  const cm = Math.max(0, Math.min(5, m));
  const cn = Math.max(1, Math.min(5, n)) - 1;
  const m0 = Math.min(4, Math.floor(cm));
  const mf = cm - m0;
  const n0 = Math.min(3, Math.floor(cn));
  const nf = cn - n0;

  const r00 = BESSEL_ROOTS[m0][n0];
  const r01 = BESSEL_ROOTS[m0][n0 + 1];
  const r10 = BESSEL_ROOTS[m0 + 1][n0];
  const r11 = BESSEL_ROOTS[m0 + 1][n0 + 1];
  const a0 = r00 + (r01 - r00) * nf;
  const a1 = r10 + (r11 - r10) * nf;
  return a0 + (a1 - a0) * mf;
}

/**
 * Evaluate circular Bessel standing-wave field u(x, z) on a disc of radius `discRadius`
 * with smooth azimuthal interpolation between floor(m) and ceil(m).
 */
export function evalCircularStandingWave(
  x: number,
  z: number,
  m: number,
  n: number,
  discRadius = 0.94,
): number {
  const r = Math.hypot(x, z) / discRadius;
  const theta = Math.atan2(z, x);
  const m0 = Math.max(0, Math.min(4, Math.floor(m)));
  const m1 = m0 + 1;
  const mf = m - Math.floor(m);
  const alpha0 = besselAlpha(m0, n);
  const alpha1 = besselAlpha(m1, n);
  const u0 = besselJ(m0, alpha0 * r) * Math.cos(m0 * theta);
  const u1 = besselJ(m1, alpha1 * r) * Math.cos(m1 * theta);
  return u0 * (1 - mf) + u1 * mf;
}

const harmonicScratchModes: Modes = { m: 2, n: 5 };

export interface HarmonicTerm {
  m: number;
  n: number;
  weight: number;
}

/**
 * Convert up to 6 live spectral peaks into normalized Chladni eigenmode terms (m_k, n_k, w_k).
 * Works on any acoustic signal (vowels, fricatives, chords, whistles, percussive bursts).
 */
export function buildHarmonicTerms(
  peaks: readonly SpectralPeak[],
  fallbackM: number,
  fallbackN: number,
  out: HarmonicTerm[],
): number {
  let used = 0;
  let totalW = 0;
  for (let i = 0; i < peaks.length && used < out.length; i++) {
    const p = peaks[i];
    if (!(p.freqHz > 60) || !(p.ampLinear > 0.02)) continue;
    // Map peak frequency across 80..5500 Hz onto distinct (m, n) eigenmode coordinates
    const u = clamp01(Math.log2(Math.max(80, p.freqHz) / 80) / Math.log2(5500 / 80));
    const m = 1 + 3.4 * clamp01(u * 1.15);
    const n = 3.8 + 5.2 * clamp01(((i * 0.37 + u * 1.3) % 1));
    out[used].m = m;
    out[used].n = Math.max(m + 0.85, n);
    out[used].weight = p.ampLinear;
    totalW += p.ampLinear;
    used++;
  }
  if (used === 0) {
    out[0].m = fallbackM;
    out[0].n = fallbackN;
    out[0].weight = 1;
    return 1;
  }
  if (totalW > 1e-9) {
    for (let i = 0; i < used; i++) out[i].weight /= totalW;
  }
  return used;
}

/**
 * Evaluate multi-harmonic superposition Ψ(x, z) and its analytical spatial gradient (gx, gz).
 */
export function evalHarmonicSuperposition(
  x: number,
  z: number,
  terms: readonly HarmonicTerm[],
  termCount: number,
  gradOut?: { c: number; gx: number; gz: number },
): number {
  let cSum = 0;
  let gxSum = 0;
  let gzSum = 0;
  for (let k = 0; k < termCount; k++) {
    const { m, n, weight } = terms[k];
    const a = n * Math.PI;
    const b = m * Math.PI;
    const cax = Math.cos(a * x);
    const sax = Math.sin(a * x);
    const cbx = Math.cos(b * x);
    const sbx = Math.sin(b * x);
    const caz = Math.cos(a * z);
    const saz = Math.sin(a * z);
    const cbz = Math.cos(b * z);
    const sbz = Math.sin(b * z);
    cSum += weight * (cax * cbz - cbx * caz);
    if (gradOut) {
      gxSum += weight * (-a * sax * cbz + b * sbx * caz);
      gzSum += weight * (-b * cax * sbz + a * cbx * saz);
    }
  }
  if (gradOut) {
    gradOut.c = cSum;
    gradOut.gx = gxSum;
    gradOut.gz = gzSum;
  }
  return cSum;
}

/**
 * Catmull-Rom / cosine-smoothed interpolation of the normalized 1D vocal-tract area function
 * A[0..M-1] at normalized axial coordinate u in [0, 1] (0 = glottis, 1 = lips), returning radius.
 */
export function sampleVocalTractRadius(area: ArrayLike<number>, u: number): number {
  const n = area.length;
  if (n === 0) return 0.25;
  const pos = clamp01(u) * (n - 1);
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(pos)));
  const i1 = Math.min(n - 1, i0 + 1);
  const im1 = Math.max(0, i0 - 1);
  const i2 = Math.min(n - 1, i0 + 2);
  const t = pos - i0;
  const t2 = t * t;
  const t3 = t2 * t;

  const p0 = Math.sqrt(Math.max(0.04, area[im1]));
  const p1 = Math.sqrt(Math.max(0.04, area[i0]));
  const p2 = Math.sqrt(Math.max(0.04, area[i1]));
  const p3 = Math.sqrt(Math.max(0.04, area[i2]));

  const r =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return Math.max(0.11, Math.min(0.62, r * 0.54));
}

export { chladniModes, harmonicScratchModes };
