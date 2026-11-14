/** Telemetry contract between the DSP engine and everything that draws it. */

export type WindowType = "rectangular" | "hamming" | "hann" | "blackman";

/** A root of the LPC polynomial A(z), i.e. a pole of the vocal-tract model H(z) = G / A(z). */
export interface ComplexPoint {
  re: number;
  im: number;
  /** |z|. Closer to 1 means a narrower resonance. */
  magnitude: number;
  angleRad: number;
  /** angle * fs / 2π */
  freqHz: number;
  /** -ln|z| * fs / π */
  bandwidthHz: number;
  /** 1, 2 or 3 when this pole was chosen as F1, F2 or F3; otherwise 0. */
  formantIndex: number;
}

export interface FormantPeak {
  f1: number;
  f2: number;
  f3: number;
  b1: number;
  b2: number;
  b3: number;
  /** 0..1, from how many formants were found and how narrow they are. */
  confidence: number;
}

export interface VoiceStabilityMetrics {
  f0Hz: number;
  /** MPM clarity, 0..1. */
  pitchConfidence: number;
  /** Local jitter: mean |T(i) - T(i+1)| / mean T, cycle to cycle, in percent. */
  jitterPercent: number;
  /** Local shimmer: mean |20 log10(A(i+1) / A(i))| in dB. */
  shimmerDb: number;
  /** Frame level in dB re full scale. */
  rmsDb: number;
  /** Zero crossings per sample, 0..1. */
  zeroCrossingRate: number;
  syllablesPerSec: number;
}

export interface VowelTarget {
  id: string;
  /** IPA symbol. */
  symbol: string;
  banglaSymbol?: string;
  label: string;
  targetF1: number;
  targetF2: number;
  targetF3: number;
  toleranceHz: number;
  /** How the mouth makes it. */
  articulation: string;
}

export interface TargetMatch {
  targetId: string;
  euclideanDistanceHz: number;
  /** Distance on the Bark scale, closer to how ears judge vowel difference. */
  distanceBark: number;
  /** 0..100 */
  convergenceScore: number;
  guidance: string;
}

export interface DSPFrameTelemetry {
  timestampMs: number;
  /** Rate of the incoming audio. */
  sampleRate: number;
  /** Rate after decimation; every array below is at this rate. */
  analysisRate: number;
  windowType: WindowType;
  /** True when the frame is loud and periodic enough to trust. */
  voiced: boolean;
  /** 512 samples, x[n]. */
  timeDomainRaw: Float32Array;
  /** 512 samples, x[n] * w[n]. */
  timeDomainWindowed: Float32Array;
  /** 512 bins, 0 to Nyquist of analysisRate, dB re a full-scale sinusoid. */
  fftMagnitudeDb: Float32Array;
  /** 512 bins on the same scale as fftMagnitudeDb, from G / |A(e^jw)|. */
  lpcEnvelopeDb: Float32Array;
  /** a_1 ... a_p of A(z) = 1 - sum a_k z^-k */
  lpcCoefficients: number[];
  zPlanePoles: ComplexPoint[];
  formants: FormantPeak;
  stability: VoiceStabilityMetrics;
  activeTargetMatch: TargetMatch;
}
