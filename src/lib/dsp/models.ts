import { computeRadix2FFT, createLPCResult, type LPCResult } from "./fft-lpc";

/**
 * Multi-model spectral and physical vocal-tract estimators:
 * 1. Burg's Lattice Maximum Entropy LPC (`solveBurgLPC`) — estimates reflection coefficients k_m
 *    directly from forward/backward prediction residuals without windowing edge bias.
 * 2. Real Cepstrum & Homomorphic Envelope (`CepstrumBuffers`, `computeCepstralEnvelope`) —
 *    separates source periodicity (rahmonic peak) from smooth spectral envelope including zeros.
 * 3. Kelly-Lochbaum Lossless Tube Area Function (`computeVocalTractArea`) & Wakita Vocal-Tract
 *    Length (`estimateVocalTractLengthCm`) — maps PARCOR reflection coefficients k_m to physical
 *    cross-sectional areas from glottis to lips.
 */

export type LpcMethod = "autocorr" | "burg";

interface BurgScratch {
  f: Float64Array;
  b: Float64Array;
  aPrev: Float64Array;
}

const burgScratch = new Map<string, BurgScratch>();

function getBurgScratch(n: number, order: number): BurgScratch {
  const key = `${n}:${order}`;
  let s = burgScratch.get(key);
  if (!s) {
    s = {
      f: new Float64Array(n),
      b: new Float64Array(n),
      aPrev: new Float64Array(order),
    };
    burgScratch.set(key, s);
  }
  return s;
}

/**
 * Burg's lattice method for all-pole linear prediction.
 * Guarantees |k_m| < 1 (minimum-phase filter, all poles strictly inside the unit circle)
 * and avoids the autocorrelation windowing smear on short frames and transients.
 */
export function solveBurgLPC(
  signal: Float32Array,
  order: number,
  out: LPCResult = createLPCResult(order),
): LPCResult {
  const n = signal.length;
  const { a, reflectionK } = out;
  a.fill(0);
  reflectionK.fill(0);
  if (n <= order + 1) {
    out.gain = 0;
    return out;
  }

  const { f, b, aPrev } = getBurgScratch(n, order);
  let power = 0;
  for (let i = 0; i < n; i++) {
    const x = signal[i];
    f[i] = x;
    b[i] = x;
    power += x * x;
  }

  let err = power / n;
  if (!(err > 1e-14)) {
    out.gain = 0;
    return out;
  }

  for (let m = 0; m < order; m++) {
    let num = 0;
    let den = 0;
    for (let i = m + 1; i < n; i++) {
      const fi = f[i];
      const bi = b[i - 1];
      num += fi * bi;
      den += fi * fi + bi * bi;
    }
    if (!(den > 1e-30)) break;

    // Reflection coefficient k_m in (-1, 1); clamp slightly away from ±1 for numerical stability.
    const rawK = (2 * num) / den;
    let k = rawK;
    if (k > 0.9995) k = 0.9995;
    else if (k < -0.9995) k = -0.9995;
    reflectionK[m] = k;

    for (let j = 0; j < m; j++) aPrev[j] = a[j];
    a[m] = k;
    for (let j = 0; j < m; j++) {
      a[j] = aPrev[j] - k * aPrev[m - 1 - j];
    }

    err *= 1 - k * k;
    // Rank-termination: if |rawK| -> 1, the deterministic line spectrum is fully captured;
    // continuing further would fit Float32 quantization noise with spurious poles.
    if (Math.abs(rawK) >= 0.9995 || !(err > 1e-18)) break;
    for (let i = n - 1; i >= m + 1; i--) {
      const fi = f[i];
      const bi = b[i - 1];
      f[i] = fi - k * bi;
      b[i] = bi - k * fi;
    }
  }

  // Scale gain so unwindowed Burg residual matches coherent Hamming-windowed LPC power scale (~0.3974 * n).
  out.gain = Math.sqrt(Math.max(err * n * 0.4, 0));
  return out;
}

interface CepstrumScratch {
  re: Float32Array;
  im: Float32Array;
}

const cepstrumScratch = new Map<number, CepstrumScratch>();

function getCepstrumScratch(fftSize: number): CepstrumScratch {
  let s = cepstrumScratch.get(fftSize);
  if (!s) {
    s = { re: new Float32Array(fftSize), im: new Float32Array(fftSize) };
    cepstrumScratch.set(fftSize, s);
  }
  return s;
}

export interface CepstralAnalysis {
  /** Cepstral rahmonic pitch estimate in Hz (0 when below prominence threshold). */
  cepstralF0Hz: number;
  /** Prominence of the fundamental rahmonic peak, 0..1. */
  rahmonicProminence: number;
  /** Detected anti-resonance (spectral zero) frequency in Hz, or 0 when none is prominent. */
  antiResonanceHz: number;
  /** Depth of the strongest spectral valley relative to LPC/neighbouring peaks in dB. */
  antiResonanceDepthDb: number;
}

/**
 * Compute the homomorphic liftered cepstral spectral envelope (in dB, on the exact same scale
 * as `fftMagnitudeDb`) and extract the cepstral pitch rahmonic + strongest nasal/instrument anti-zero.
 *
 * Because c[n] = IFFT(log|X[k]|) makes no all-pole assumption, the liftered envelope captures both
 * vocal-tract resonances (poles) and nasal/acoustic-body anti-resonances (zeros).
 */
export function computeCepstralEnvelopeDb(
  fftMagnitudeDb: Float32Array,
  analysisRate: number,
  envelopeOut: Float32Array,
  lpcEnvelopeDb?: Float32Array,
  infoOut: CepstralAnalysis = {
    cepstralF0Hz: 0,
    rahmonicProminence: 0,
    antiResonanceHz: 0,
    antiResonanceDepthDb: 0,
  },
): CepstralAnalysis {
  const half = fftMagnitudeDb.length;
  const fftSize = half << 1;
  const { re, im } = getCepstrumScratch(fftSize);

  // Symmetric log-magnitude spectrum in dB across 0..N-1.
  for (let k = 0; k < half; k++) {
    const db = Math.max(-120, fftMagnitudeDb[k]);
    re[k] = db;
    im[k] = 0;
    if (k > 0) {
      re[fftSize - k] = db;
      im[fftSize - k] = 0;
    }
  }
  re[half] = Math.max(-120, fftMagnitudeDb[half - 1]);
  im[half] = 0;

  // Inverse FFT of real even sequence: conjugate = no-op since im = 0, then divide by N.
  computeRadix2FFT(re, im);
  const invN = 1 / fftSize;
  for (let n = 0; n < fftSize; n++) {
    re[n] *= invN;
    im[n] = 0;
  }

  // Search quefrency range [fs/450, fs/75] for fundamental glottal rahmonic peak.
  const minQ = Math.max(20, Math.floor(analysisRate / 450));
  const maxQ = Math.min(half - 2, Math.ceil(analysisRate / 75));
  let bestQ = -1;
  let bestVal = -Infinity;
  let floorSum = 0;
  let floorCount = 0;
  for (let q = minQ; q <= maxQ; q++) {
    const v = re[q];
    floorSum += Math.abs(v);
    floorCount++;
    if (v > bestVal && v >= re[q - 1] && v >= re[q + 1]) {
      bestVal = v;
      bestQ = q;
    }
  }
  const meanAbs = floorCount > 0 ? floorSum / floorCount : 1e-6;
  if (bestQ > minQ && bestVal > 0.45) {
    const y0 = re[bestQ - 1];
    const y1 = re[bestQ];
    const y2 = re[bestQ + 1];
    const den = y0 - 2 * y1 + y2;
    const shift = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
    infoOut.cepstralF0Hz = analysisRate / (bestQ + shift);
    infoOut.rahmonicProminence = Math.min(1, Math.max(0, (bestVal - meanAbs) / 3.2));
  } else {
    infoOut.cepstralF0Hz = 0;
    infoOut.rahmonicProminence = 0;
  }

  // Raised-cosine low-time lifter below ~2.1 ms (quefrency cutoff ~26 samples at 12 kHz)
  // preserves vocal-tract resonances and anti-zeros while rejecting harmonic pitch ripples.
  const cutoff = Math.max(14, Math.min(minQ - 2, Math.round(analysisRate * 0.0022)));
  const taper = Math.max(4, Math.round(cutoff * 0.35));
  for (let n = 1; n < half; n++) {
    let w = 0;
    if (n <= cutoff - taper) {
      w = 1;
    } else if (n < cutoff + taper) {
      const u = (n - (cutoff - taper)) / (2 * taper);
      w = 0.5 * (1 + Math.cos(Math.PI * u));
    }
    re[n] *= w;
    re[fftSize - n] *= w;
  }
  re[half] = 0;

  // Forward FFT recovers smooth log-magnitude envelope in dB.
  computeRadix2FFT(re, im);
  for (let k = 0; k < half; k++) {
    envelopeOut[k] = Math.max(-120, Math.min(12, re[k]));
  }

  // Detect prominent narrow spectral anti-resonance (zero/notch) between 350 Hz and 4200 Hz
  // by measuring local notch depth below the linear chord bridging ±550 Hz shoulders on the
  // cepstral envelope itself (completely invariant to LPC method or window scalar gain).
  infoOut.antiResonanceHz = 0;
  infoOut.antiResonanceDepthDb = 0;
  const nyquist = analysisRate / 2;
  const span = Math.max(10, Math.round((420 / nyquist) * half));
  const binLo = Math.max(span + 2, Math.floor((350 / nyquist) * half));
  const binHi = Math.min(half - span - 2, Math.ceil((4200 / nyquist) * half));
  const hasLpc = Boolean(lpcEnvelopeDb && lpcEnvelopeDb.length === half);

  let deepestDb = 0;
  let deepestBin = -1;
  for (let b = binLo; b <= binHi; b++) {
    const v = envelopeOut[b];
    if (v <= envelopeOut[b - 1] && v <= envelopeOut[b + 1]) {
      const leftPeak = Math.max(envelopeOut[b - span], envelopeOut[b - (span >> 1)]);
      const rightPeak = Math.max(envelopeOut[b + span], envelopeOut[b + (span >> 1)]);
      // Require both sides of the notch to stand above the valley so a broadband roll-off is ignored
      const bridgeFloor = Math.min(leftPeak, rightPeak);
      if (bridgeFloor - v >= 2.5) {
        const cepValleyDb = 0.5 * (leftPeak + rightPeak) - v;
        let lpcValleyDb = 0;
        if (hasLpc && lpcEnvelopeDb) {
          const lpcLeft = Math.max(lpcEnvelopeDb[b - span], lpcEnvelopeDb[b - (span >> 1)]);
          const lpcRight = Math.max(lpcEnvelopeDb[b + span], lpcEnvelopeDb[b + (span >> 1)]);
          lpcValleyDb = Math.max(0, 0.5 * (lpcLeft + lpcRight) - lpcEnvelopeDb[b]);
        }
        // Gain- and tilt-invariant zero residual: subtracts normal all-pole inter-formant valley depth
        const notchDepth = cepValleyDb - lpcValleyDb;
        if (notchDepth > deepestDb) {
          deepestDb = notchDepth;
          deepestBin = b;
        }
      }
    }
  }
  if (deepestBin > 0 && deepestDb >= 4.6) {
    infoOut.antiResonanceHz = (deepestBin / (half - 1)) * nyquist;
    infoOut.antiResonanceDepthDb = deepestDb;
  }

  return infoOut;
}

/**
 * Reconstruct the normalized 1D cross-sectional area function A[0..M] of a lossless acoustic
 * Kelly-Lochbaum tube from PARCOR reflection coefficients k[0..p-1].
 *
 * Convention:
 * - Index 0 is the glottis; index p is the lip opening (normalized reference A[p] = 1).
 * - Output values are normalized into [0.08, 1.0] so any 2D/3D renderer can extrude a stable
 *   physical vocal-tract geometry without numerical blow-up when |k_m| -> 1.
 */
export function computeVocalTractArea(
  reflectionK: ArrayLike<number>,
  areaOut: Float32Array,
): Float32Array {
  const sections = areaOut.length;
  const p = Math.min(reflectionK.length, sections - 1);
  if (p <= 0) {
    areaOut.fill(0.5);
    return areaOut;
  }

  // Walk backward from lip termination (section p, normalized area = 1) toward glottis (section 0).
  areaOut[p] = 1;
  for (let m = p - 1; m >= 0; m--) {
    // Clamp |k| <= 0.92 for physical anatomical plausibility.
    const k = Math.max(-0.92, Math.min(0.92, reflectionK[m] || 0));
    // Acoustic tube junction relation: A_m / A_{m+1} = (1 + k_m) / (1 - k_m) or inverse depending on sign convention.
    // For solveLevinsonDurbin's A(z) = 1 - sum a_k z^-k, reflectionK[m] = a^{(m)}[m]:
    const ratio = (1 - k) / (1 + k);
    areaOut[m] = Math.max(0.04, Math.min(25, areaOut[m + 1] * ratio));
  }
  for (let m = p + 1; m < sections; m++) {
    areaOut[m] = areaOut[p];
  }

  // Normalize by peak cross-section so max area = 1.0, preserving relative constrictions.
  let maxArea = 1e-6;
  for (let m = 0; m <= p; m++) {
    if (areaOut[m] > maxArea) maxArea = areaOut[m];
  }
  for (let m = 0; m < sections; m++) {
    areaOut[m] = Math.max(0.08, Math.min(1, areaOut[m] / maxArea));
  }
  return areaOut;
}

/** Speed of sound in warm humid vocal tract air (~37°C), in cm/s. */
const SOUND_SPEED_CM_S = 35300;

/**
 * Wakita / odd-quarter-wave estimate of apparent vocal-tract length L (in cm) from F1..F3:
 * For a uniform tube closed at the glottis and open at the lips, F_k = (2k - 1) * c / (4 * L).
 * Averaging across higher formants (weighted toward F2 and F3, which are less perturbed by jaw opening)
 * yields a stable anatomical estimate in [11.5, 22.0] cm (typical adult neutral ~17.0 cm).
 */
export function estimateVocalTractLengthCm(f1: number, f2: number, f3: number): number {
  if (!(f1 > 150) || !(f2 > 550)) return 0;
  const l1 = SOUND_SPEED_CM_S / (4 * f1);
  const l2 = (3 * SOUND_SPEED_CM_S) / (4 * f2);
  const l3 = f3 > 1400 ? (5 * SOUND_SPEED_CM_S) / (4 * f3) : l2;
  // Weight higher formants more heavily since F1 varies strongly with mouth opening.
  const rawCm = f3 > 1400 ? 0.18 * l1 + 0.37 * l2 + 0.45 * l3 : 0.3 * l1 + 0.7 * l2;
  return Math.max(11.5, Math.min(22.5, rawCm));
}
