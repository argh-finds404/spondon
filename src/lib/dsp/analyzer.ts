import type { DSPFrameTelemetry, VowelTarget, WindowType } from "@/types/dsp";
import {
  computeAutocorrelation,
  computeRadix2FFT,
  createLPCResult,
  createPoleAnalysis,
  evaluateLPCEnvelopeDb,
  extractFormantsAndPoles,
  solveLevinsonDurbin,
  type LPCResult,
  type PoleAnalysis,
} from "./fft-lpc";
import { detectPitchF0, measureCycles, StabilityTracker, type CycleStats, type PitchResult } from "./pitch-jitter";
import { DEFAULT_TARGET, evaluateTargetConvergence, GUIDANCE } from "./vowel-targets";
import { getWindow } from "./windows";

/** Samples in the spectral frame, after decimation. */
export const FRAME_SIZE = 512;
export const FFT_SIZE = 1024;
/** Decimated samples kept for pitch detection: two spectral frames. */
const PITCH_SIZE = 1024;
/** Decimation aims for this rate: Nyquist of 6 kHz holds F1 to F3 with room to spare. */
export const TARGET_ANALYSIS_RATE = 12000;

export interface AnalyzerOptions {
  windowType: WindowType;
  /** Pre-emphasis coefficient; 0 switches it off. */
  preEmphasis: number;
  lpcOrder: number;
}

export const DEFAULT_ANALYZER_OPTIONS: AnalyzerOptions = {
  windowType: "hamming",
  preEmphasis: 0.97,
  lpcOrder: 12,
};

const VOICED_MIN_DB = -50;
const VOICED_MIN_CLARITY = 0.6;
const MEDIAN = 5;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Hamming-windowed sinc low-pass at 90% of the decimated Nyquist, unity gain at DC. */
function designDecimator(factor: number): Float32Array {
  const taps = 12 * factor + 1;
  const h = new Float32Array(taps);
  const fc = 0.45 / factor;
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

/**
 * One frame in, one telemetry record out:
 * decimate → pitch (MPM) → pre-emphasis → window → FFT → autocorrelation → Levinson-Durbin
 * → roots of A(z) → formants → cycle jitter and shimmer → distance to the target vowel.
 * Every buffer is allocated once; `telemetry` is the same object on every call.
 */
export class VoiceAnalyzer {
  readonly sampleRate: number;
  readonly decimation: number;
  readonly analysisRate: number;
  /** Fewest input samples process() accepts. */
  readonly minSamples: number;
  /** A power of two of at least minSamples, e.g. for AnalyserNode.fftSize. */
  readonly rawSize: number;
  readonly options: AnalyzerOptions;
  target: VowelTarget = DEFAULT_TARGET;
  readonly telemetry: DSPFrameTelemetry;

  private readonly fir: Float32Array;
  private readonly dec = new Float32Array(PITCH_SIZE);
  private readonly pre = new Float32Array(FRAME_SIZE);
  private readonly frame = new Float32Array(FRAME_SIZE);
  private readonly re = new Float32Array(FFT_SIZE);
  private readonly im = new Float32Array(FFT_SIZE);
  private R = new Float64Array(0);
  private lpc: LPCResult = createLPCResult(0);
  private poles: PoleAnalysis = createPoleAnalysis(0);
  private readonly pitch: PitchResult = { f0Hz: 0, confidence: 0 };
  private readonly cycles: CycleStats = { jitterPercent: 0, shimmerDb: 0, cycles: 0 };
  private readonly tracker = new StabilityTracker();
  private readonly history = new Float32Array(3 * MEDIAN);
  private readonly sortBuf = new Float32Array(MEDIAN);
  private historyFill = 0;
  private historyHead = 0;
  private unvoicedFrames = 0;

  constructor(sampleRate: number, options: Partial<AnalyzerOptions> = {}) {
    this.sampleRate = sampleRate;
    this.decimation = Math.max(1, Math.round(sampleRate / TARGET_ANALYSIS_RATE));
    this.analysisRate = sampleRate / this.decimation;
    this.fir = this.decimation > 1 ? designDecimator(this.decimation) : new Float32Array(0);
    this.minSamples = PITCH_SIZE * this.decimation + this.fir.length;
    this.rawSize = nextPow2(this.minSamples);
    this.options = { ...DEFAULT_ANALYZER_OPTIONS, ...options };
    this.telemetry = {
      timestampMs: 0,
      sampleRate,
      analysisRate: this.analysisRate,
      windowType: this.options.windowType,
      voiced: false,
      timeDomainRaw: new Float32Array(FRAME_SIZE),
      timeDomainWindowed: new Float32Array(FRAME_SIZE),
      fftMagnitudeDb: new Float32Array(FRAME_SIZE).fill(-120),
      lpcEnvelopeDb: new Float32Array(FRAME_SIZE).fill(-120),
      lpcCoefficients: [],
      zPlanePoles: [],
      formants: { f1: 0, f2: 0, f3: 0, b1: 0, b2: 0, b3: 0, confidence: 0 },
      stability: {
        f0Hz: 0,
        pitchConfidence: 0,
        jitterPercent: 0,
        shimmerDb: 0,
        rmsDb: -120,
        zeroCrossingRate: 0,
        syllablesPerSec: 0,
      },
      activeTargetMatch: {
        targetId: this.target.id,
        euclideanDistanceHz: 0,
        distanceBark: 0,
        convergenceScore: 0,
        guidance: GUIDANCE.silent,
      },
    };
    this.ensureOrder();
  }

  private ensureOrder(): void {
    const order = Math.min(24, Math.max(4, Math.round(this.options.lpcOrder)));
    this.options.lpcOrder = order;
    if (this.lpc.a.length === order) return;
    this.R = new Float64Array(order + 1);
    this.lpc = createLPCResult(order);
    this.poles = createPoleAnalysis(order);
    this.telemetry.lpcCoefficients = new Array<number>(order).fill(0);
    this.telemetry.zPlanePoles = this.poles.poles;
  }

  /** Low-pass and keep every Nth sample, ending at the newest input that has full filter support. */
  private decimate(raw: Float32Array): void {
    const { dec, fir, decimation: D } = this;
    const end = raw.length;
    if (D === 1) {
      dec.set(raw.subarray(end - PITCH_SIZE, end));
      return;
    }
    const taps = fir.length;
    const first = end - taps - (PITCH_SIZE - 1) * D;
    for (let i = 0; i < PITCH_SIZE; i++) {
      const base = first + i * D;
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += fir[k] * raw[base + k];
      dec[i] = acc;
    }
  }

  private median(slot: number): number {
    const s = this.sortBuf.subarray(0, this.historyFill);
    for (let i = 0; i < this.historyFill; i++) s[i] = this.history[slot * MEDIAN + i];
    s.sort();
    return s[this.historyFill >> 1];
  }

  /** `raw` holds at least minSamples samples at sampleRate, newest last. */
  process(raw: Float32Array, timestampMs: number): DSPFrameTelemetry {
    if (raw.length < this.minSamples) {
      throw new Error(`VoiceAnalyzer needs at least ${this.minSamples} samples, got ${raw.length}`);
    }
    this.ensureOrder();
    const t = this.telemetry;
    const { dec, pre, frame, re, im, options } = this;
    const order = options.lpcOrder;
    t.timestampMs = timestampMs;
    t.windowType = options.windowType;

    this.decimate(raw);
    let mean = 0;
    for (let i = 0; i < PITCH_SIZE; i++) mean += dec[i];
    mean /= PITCH_SIZE;
    for (let i = 0; i < PITCH_SIZE; i++) dec[i] -= mean;

    const x = dec.subarray(PITCH_SIZE - FRAME_SIZE);
    t.timeDomainRaw.set(x);
    let energy = 0;
    let crossings = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      energy += x[i] * x[i];
      if (i > 0 && x[i] >= 0 !== x[i - 1] >= 0) crossings++;
    }
    const rms = Math.sqrt(energy / FRAME_SIZE);
    const st = t.stability;
    st.rmsDb = 20 * Math.log10(rms + 1e-9);
    st.zeroCrossingRate = crossings / (FRAME_SIZE - 1);

    detectPitchF0(dec, this.analysisRate, this.pitch);
    st.pitchConfidence = this.pitch.confidence;
    const voiced = st.rmsDb > VOICED_MIN_DB && this.pitch.f0Hz > 0 && this.pitch.confidence >= VOICED_MIN_CLARITY;
    t.voiced = voiced;
    st.f0Hz = voiced ? this.pitch.f0Hz : 0;

    // x[n] * w[n] for the scope; the spectral chain windows the pre-emphasised copy.
    const { w, sum: windowSum } = getWindow(options.windowType, FRAME_SIZE);
    const alpha = options.preEmphasis;
    pre[0] = x[0] * (1 - alpha);
    for (let i = 1; i < FRAME_SIZE; i++) pre[i] = x[i] - alpha * x[i - 1];
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME_SIZE; i++) {
      t.timeDomainWindowed[i] = x[i] * w[i];
      frame[i] = pre[i] * w[i];
      re[i] = frame[i];
    }

    // 0 dB is a full-scale sinusoid: its windowed DFT peak is sum(w) / 2.
    const refDb = -20 * Math.log10(windowSum / 2);
    computeRadix2FFT(re, im);
    for (let k = 0; k < FRAME_SIZE; k++) {
      t.fftMagnitudeDb[k] = Math.max(-120, 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20) + refDb);
    }

    computeAutocorrelation(frame, order, this.R);
    const hasSignal = this.R[0] > 1e-10;
    if (hasSignal) {
      // A trace of white noise (-60 dB) keeps the normal equations well conditioned.
      this.R[0] *= 1.000001;
      solveLevinsonDurbin(this.R, order, this.lpc);
      evaluateLPCEnvelopeDb(this.lpc.a, this.lpc.gain, FRAME_SIZE, t.lpcEnvelopeDb, refDb);
      extractFormantsAndPoles(this.lpc.a, this.analysisRate, this.poles);
      for (let i = 0; i < order; i++) t.lpcCoefficients[i] = this.lpc.a[i];
    } else {
      t.lpcEnvelopeDb.fill(-120);
      t.lpcCoefficients.fill(0);
      for (const pole of this.poles.poles) {
        pole.re = pole.im = pole.magnitude = pole.angleRad = pole.freqHz = 0;
        pole.formantIndex = 0;
      }
    }

    // Formants: a five-frame median rejects single-frame pole swaps, then a light one-pole smooth.
    const f = t.formants;
    const found = this.poles.formants;
    if (voiced && hasSignal && found.f1 > 0 && found.f2 > 0) {
      this.unvoicedFrames = 0;
      const h = this.historyHead;
      this.history[h] = found.f1;
      this.history[MEDIAN + h] = found.f2;
      this.history[2 * MEDIAN + h] = found.f3 > 0 ? found.f3 : f.f3;
      this.historyHead = (h + 1) % MEDIAN;
      const fresh = this.historyFill === 0;
      if (this.historyFill < MEDIAN) this.historyFill++;
      const k = fresh ? 1 : 0.4;
      f.f1 += (this.median(0) - f.f1) * k;
      f.f2 += (this.median(1) - f.f2) * k;
      f.f3 += (this.median(2) - f.f3) * k;
      f.b1 += (found.b1 - f.b1) * k;
      f.b2 += (found.b2 - f.b2) * k;
      if (found.f3 > 0) f.b3 += (found.b3 - f.b3) * k;
      f.confidence += (found.confidence - f.confidence) * 0.4;
    } else {
      f.confidence *= 0.85;
      if (++this.unvoicedFrames > 12) {
        this.historyFill = 0;
        this.historyHead = 0;
        this.tracker.clearCycles();
        f.confidence = 0;
      }
    }

    if (voiced) {
      const span = Math.min(raw.length, this.rawSize);
      measureCycles(raw.subarray(raw.length - span), this.sampleRate, st.f0Hz, this.cycles);
      this.tracker.pushCycles(this.cycles);
    }
    this.tracker.updateCadence(rms, timestampMs);
    st.jitterPercent = this.tracker.jitterPercent;
    st.shimmerDb = this.tracker.shimmerDb;
    st.syllablesPerSec = this.tracker.syllablesPerSec;

    if (f.confidence > 0.05) {
      evaluateTargetConvergence(f, this.target, t.activeTargetMatch);
    } else {
      const m = t.activeTargetMatch;
      m.targetId = this.target.id;
      m.euclideanDistanceHz = 0;
      m.distanceBark = 0;
      m.convergenceScore = 0;
      m.guidance = GUIDANCE.silent;
    }
    return t;
  }
}
