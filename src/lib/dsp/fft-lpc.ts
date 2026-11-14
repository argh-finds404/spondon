import type { ComplexPoint, FormantPeak } from "@/types/dsp";

interface FFTTables {
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}
const fftTables = new Map<number, FFTTables>();

function tablesFor(n: number): FFTTables {
  let t = fftTables.get(n);
  if (t) return t;
  const bits = Math.log2(n);
  const cos = new Float64Array(n >> 1);
  const sin = new Float64Array(n >> 1);
  for (let i = 0; i < n >> 1; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r >>> 0;
  }
  t = { cos, sin, rev };
  fftTables.set(n, t);
  return t;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. Length must be a power of two. */
export function computeRadix2FFT(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) {
    throw new Error("FFT needs two arrays of the same power-of-two length");
  }
  const { cos, sin, rev } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = start + j;
        const b = a + half;
        const wr = cos[k];
        const wi = -sin[k];
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** R[k] = sum x[n] x[n+k] for k = 0..order. */
export function computeAutocorrelation(
  signal: Float32Array,
  order: number,
  out: Float64Array = new Float64Array(order + 1),
): Float64Array {
  const n = signal.length;
  for (let k = 0; k <= order; k++) {
    let acc = 0;
    for (let i = 0; i < n - k; i++) acc += signal[i] * signal[i + k];
    out[k] = acc;
  }
  return out;
}

export interface LPCResult {
  /** Predictor coefficients a_1..a_p, stored at a[0..p-1]. A(z) = 1 - sum a_k z^-k. */
  a: Float64Array;
  /** sqrt of the residual energy; the G in H(z) = G / A(z). */
  gain: number;
  /** Reflection (PARCOR) coefficients; all inside (-1, 1) for a stable model. */
  reflectionK: Float64Array;
}

export function createLPCResult(order: number): LPCResult {
  return { a: new Float64Array(order), gain: 0, reflectionK: new Float64Array(order) };
}

const levinsonScratch = new Map<number, Float64Array>();

/** Levinson-Durbin recursion on the Yule-Walker equations. */
export function solveLevinsonDurbin(
  R: Float64Array,
  order: number,
  out: LPCResult = createLPCResult(order),
): LPCResult {
  const { a, reflectionK } = out;
  let tmp = levinsonScratch.get(order);
  if (!tmp) levinsonScratch.set(order, (tmp = new Float64Array(order)));
  a.fill(0);
  reflectionK.fill(0);
  let err = R[0];
  if (!(err > 0)) {
    out.gain = 0;
    return out;
  }
  for (let i = 0; i < order; i++) {
    let acc = R[i + 1];
    for (let j = 0; j < i; j++) acc -= a[j] * R[i - j];
    const k = acc / err;
    reflectionK[i] = k;
    for (let j = 0; j < i; j++) tmp[j] = a[j] - k * a[i - 1 - j];
    for (let j = 0; j < i; j++) a[j] = tmp[j];
    a[i] = k;
    err *= 1 - k * k;
    if (!(err > 0)) break;
  }
  out.gain = Math.sqrt(Math.max(err, 0));
  return out;
}

/**
 * 20 log10( G / |A(e^jw)| ) at numBins frequencies from 0 up to (not including) Nyquist.
 * offsetDb shifts the curve; pass the same normalisation the FFT plot uses so both share a scale.
 */
export function evaluateLPCEnvelopeDb(
  a: Float64Array,
  gain: number,
  numBins: number,
  out: Float32Array = new Float32Array(numBins),
  offsetDb = 0,
): Float32Array {
  const p = a.length;
  const gainDb = 20 * Math.log10(gain + 1e-20) + offsetDb;
  for (let bin = 0; bin < numBins; bin++) {
    const w = (Math.PI * bin) / numBins;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    // (c, s) walks e^{-jwk} for k = 1..p by repeated rotation.
    let c = cw;
    let s = -sw;
    let re = 1;
    let im = 0;
    for (let k = 0; k < p; k++) {
      re -= a[k] * c;
      im -= a[k] * s;
      const nc = c * cw + s * sw;
      s = s * cw - c * sw;
      c = nc;
    }
    out[bin] = gainDb - 10 * Math.log10(re * re + im * im + 1e-20);
  }
  return out;
}

/**
 * Roots of z^p - a_1 z^(p-1) - ... - a_p by Durand-Kerner (Weierstrass) iteration.
 * Deterministic start; returns false when it did not settle.
 */
export function findPolynomialRoots(
  a: Float64Array,
  re: Float64Array,
  im: Float64Array,
  maxIterations = 80,
): boolean {
  const p = a.length;
  for (let k = 0; k < p; k++) {
    const ang = (2 * Math.PI * k) / p + 0.4;
    re[k] = 0.9 * Math.cos(ang);
    im[k] = 0.9 * Math.sin(ang);
  }
  for (let iter = 0; iter < maxIterations; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < p; k++) {
      const zr = re[k];
      const zi = im[k];
      // Horner: P(z) = (((z - a1) z - a2) z ...) - ap
      let pr = 1;
      let pi = 0;
      for (let j = 0; j < p; j++) {
        const tr = pr * zr - pi * zi - a[j];
        pi = pr * zi + pi * zr;
        pr = tr;
      }
      let dr = 1;
      let di = 0;
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        const er = zr - re[j];
        const ei = zi - im[j];
        const tr = dr * er - di * ei;
        di = dr * ei + di * er;
        dr = tr;
      }
      const den = dr * dr + di * di;
      if (den < 1e-300) continue;
      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;
      re[k] = zr - qr;
      im[k] = zi - qi;
      const delta = Math.abs(qr) + Math.abs(qi);
      if (delta > maxDelta) maxDelta = delta;
    }
    if (maxDelta < 1e-10) return true;
  }
  return false;
}

/** Physiological search ranges for the first three formants of an adult voice, in Hz. */
export const FORMANT_RANGES = {
  f1: [220, 950],
  f2: [750, 2650],
  f3: [1800, 3600],
  maxBandwidth: 500,
} as const;

export interface PoleAnalysis {
  /** Every root of A(z); conjugate pairs included. */
  poles: ComplexPoint[];
  formants: FormantPeak;
  converged: boolean;
  rootRe: Float64Array;
  rootIm: Float64Array;
  order: Uint8Array;
}

export function createPoleAnalysis(order: number): PoleAnalysis {
  return {
    poles: Array.from({ length: order }, () => ({
      re: 0,
      im: 0,
      magnitude: 0,
      angleRad: 0,
      freqHz: 0,
      bandwidthHz: 0,
      formantIndex: 0,
    })),
    formants: { f1: 0, f2: 0, f3: 0, b1: 0, b2: 0, b3: 0, confidence: 0 },
    converged: false,
    rootRe: new Float64Array(order),
    rootIm: new Float64Array(order),
    order: new Uint8Array(order),
  };
}

/**
 * Solve A(z) = 0, turn each upper-half-plane root into a resonance
 * (F = angle * fs / 2π, B = -ln r * fs / π) and pick F1..F3 from the plausible ones.
 */
export function extractFormantsAndPoles(
  a: Float64Array,
  sampleRate: number,
  out: PoleAnalysis = createPoleAnalysis(a.length),
): PoleAnalysis {
  const p = a.length;
  const { poles, formants, rootRe, rootIm, order } = out;
  out.converged = findPolynomialRoots(a, rootRe, rootIm);
  for (let k = 0; k < p; k++) {
    const pole = poles[k];
    const re = rootRe[k];
    const im = rootIm[k];
    const mag = Math.hypot(re, im);
    const ang = Math.atan2(im, re);
    pole.re = re;
    pole.im = im;
    pole.magnitude = mag;
    pole.angleRad = ang;
    pole.freqHz = (Math.abs(ang) * sampleRate) / (2 * Math.PI);
    pole.bandwidthHz = mag > 0 ? (-Math.log(mag) * sampleRate) / Math.PI : Infinity;
    pole.formantIndex = 0;
    order[k] = k;
  }
  // Insertion sort of indices by frequency; p is small.
  for (let i = 1; i < p; i++) {
    const v = order[i];
    let j = i - 1;
    while (j >= 0 && poles[order[j]].freqHz > poles[v].freqHz) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = v;
  }
  formants.f1 = formants.f2 = formants.f3 = 0;
  formants.b1 = formants.b2 = formants.b3 = 0;
  const R = FORMANT_RANGES;
  for (let i = 0; i < p; i++) {
    const pole = poles[order[i]];
    if (pole.im <= 1e-9 || pole.bandwidthHz > R.maxBandwidth) continue;
    const f = pole.freqHz;
    if (formants.f1 === 0 && formants.f2 === 0 && f >= R.f1[0] && f <= R.f1[1]) {
      formants.f1 = f;
      formants.b1 = pole.bandwidthHz;
      pole.formantIndex = 1;
    } else if (formants.f2 === 0 && f > formants.f1 && f >= R.f2[0] && f <= R.f2[1]) {
      formants.f2 = f;
      formants.b2 = pole.bandwidthHz;
      pole.formantIndex = 2;
    } else if (formants.f2 > 0 && formants.f3 === 0 && f >= R.f3[0] && f <= R.f3[1]) {
      formants.f3 = f;
      formants.b3 = pole.bandwidthHz;
      pole.formantIndex = 3;
    }
  }
  const q1 = formants.f1 > 0 ? Math.max(0, 1 - formants.b1 / R.maxBandwidth) : 0;
  const q2 = formants.f2 > 0 ? Math.max(0, 1 - formants.b2 / R.maxBandwidth) : 0;
  formants.confidence = out.converged ? 0.5 * (q1 + q2) : 0;
  return out;
}
