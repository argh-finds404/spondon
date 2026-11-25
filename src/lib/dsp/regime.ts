import type { FormantPeak, RegimeTelemetry, SpectralPeak, VoiceStabilityMetrics } from "@/types/dsp";
import type { CepstralAnalysis } from "./models";
import { estimateVocalTractLengthCm } from "./models";

export const MAX_SPECTRAL_PEAKS = 6;
export const TRACT_SECTIONS = 13;

export const REGIME_LABELS = {
  silence: "Room silence",
  vowel: "Voiced vowel",
  sonorant: "Sonorant / off-chart",
  fricative: "Fricative / noise",
  plosive: "Transient burst",
  instrument: "Harmonic tone",
} as const;

export function createRegimeTelemetry(): RegimeTelemetry {
  return {
    kind: "silence",
    label: REGIME_LABELS.silence,
    detail: "Waiting for an acoustic signal above the −58 dB floor.",
    spectralCentroidHz: 0,
    spectralFlatness: 0,
    spectralTiltDb: 0,
    onsetFluxDb: 0,
    trajectorySpeedHzPerSec: 0,
    vocalTractLengthCm: 0,
    cepstralF0Hz: 0,
    antiResonanceHz: 0,
    antiResonanceDepthDb: 0,
    topPeaks: Array.from({ length: MAX_SPECTRAL_PEAKS }, () => ({
      freqHz: 0,
      db: -120,
      ampLinear: 0,
    })),
  };
}

export function copyRegimeInto(src: RegimeTelemetry, dst: RegimeTelemetry): void {
  dst.kind = src.kind;
  dst.label = src.label;
  dst.detail = src.detail;
  dst.spectralCentroidHz = src.spectralCentroidHz;
  dst.spectralFlatness = src.spectralFlatness;
  dst.spectralTiltDb = src.spectralTiltDb;
  dst.onsetFluxDb = src.onsetFluxDb;
  dst.trajectorySpeedHzPerSec = src.trajectorySpeedHzPerSec;
  dst.vocalTractLengthCm = src.vocalTractLengthCm;
  dst.cepstralF0Hz = src.cepstralF0Hz;
  dst.antiResonanceHz = src.antiResonanceHz;
  dst.antiResonanceDepthDb = src.antiResonanceDepthDb;
  for (let i = 0; i < MAX_SPECTRAL_PEAKS; i++) {
    const sp = src.topPeaks[i];
    const dp = dst.topPeaks[i];
    if (sp && dp) {
      dp.freqHz = sp.freqHz;
      dp.db = sp.db;
      dp.ampLinear = sp.ampLinear;
    }
  }
}

const peakBins = new Int32Array(64);
const peakVals = new Float32Array(64);

/**
 * Extract up to `MAX_SPECTRAL_PEAKS` (6) prominent spectral peaks from `fftMagnitudeDb`
 * with normalized linear weights for multi-harmonic 3D wave superposition. Zero allocations.
 */
export function extractTopSpectralPeaks(
  fftMagnitudeDb: Float32Array,
  analysisRate: number,
  outPeaks: SpectralPeak[],
): void {
  const bins = fftMagnitudeDb.length;
  const nyquist = analysisRate / 2;
  const binHz = nyquist / Math.max(1, bins - 1);
  const bStart = Math.max(1, Math.floor(80 / binHz));
  const bEnd = Math.min(bins - 2, Math.ceil(5800 / binHz));

  let candidateCount = 0;
  for (let b = bStart; b <= bEnd && candidateCount < 64; b++) {
    const v = fftMagnitudeDb[b];
    if (v > -92 && v >= fftMagnitudeDb[b - 1] && v >= fftMagnitudeDb[b + 1]) {
      peakBins[candidateCount] = b;
      peakVals[candidateCount] = v;
      candidateCount++;
    }
  }

  let ampSum = 0;
  const limit = Math.min(outPeaks.length, MAX_SPECTRAL_PEAKS);
  const chosen = Math.min(limit, candidateCount);
  for (let i = 0; i < limit; i++) {
    const slot = outPeaks[i];
    if (!slot) continue;
    if (i < chosen) {
      let bestIdx = i;
      for (let j = i + 1; j < candidateCount; j++) {
        if (peakVals[j] > peakVals[bestIdx]) bestIdx = j;
      }
      const tmpB = peakBins[i];
      peakBins[i] = peakBins[bestIdx];
      peakBins[bestIdx] = tmpB;
      const tmpV = peakVals[i];
      peakVals[i] = peakVals[bestIdx];
      peakVals[bestIdx] = tmpV;

      slot.freqHz = peakBins[i] * binHz;
      slot.db = peakVals[i];
      slot.ampLinear = Math.pow(10, slot.db * 0.05);
      ampSum += slot.ampLinear;
    } else {
      slot.freqHz = 0;
      slot.db = -120;
      slot.ampLinear = 0;
    }
  }
  if (ampSum > 1e-12) {
    for (let i = 0; i < chosen; i++) {
      outPeaks[i].ampLinear /= ampSum;
    }
  }
}

/**
 * Extract spectral moments, top-6 prominent spectral peaks, trajectory dynamics, and classify
 * any real-world signal (including consonants, nasals, whispers, bursts, and musical tones
 * outside the 8 reference vowels). Zero heap allocations per frame.
 */
export function evaluateAcousticRegime(
  fftMagnitudeDb: Float32Array,
  analysisRate: number,
  voiced: boolean,
  stability: VoiceStabilityMetrics,
  formants: FormantPeak,
  distanceBark: number,
  cepstral: CepstralAnalysis,
  onsetFluxDb: number,
  trajectorySpeedHzPerSec: number,
  out: RegimeTelemetry,
): RegimeTelemetry {
  const bins = fftMagnitudeDb.length;
  const nyquist = analysisRate / 2;
  const binHz = nyquist / Math.max(1, bins - 1);

  // 1. Spectral Centroid, Spectral Flatness (Wiener entropy), and High/Low Tilt across 80..5800 Hz
  const bStart = Math.max(1, Math.floor(80 / binHz));
  const bEnd = Math.min(bins - 2, Math.ceil(5800 / binHz));
  let weightedFreq = 0;
  let powerSum = 0;
  let logPowerSum = 0;
  let count = 0;
  let loDbSum = 0;
  let loCount = 0;
  let hiDbSum = 0;
  let hiCount = 0;

  for (let b = bStart; b <= bEnd; b++) {
    const db = Math.max(-110, fftMagnitudeDb[b]);
    // Power linear from dB: 10^(db / 10)
    const p = Math.pow(10, db * 0.1);
    const hz = b * binHz;
    weightedFreq += hz * p;
    powerSum += p;
    logPowerSum += Math.log(p + 1e-18);
    count++;
    if (hz <= 1000) {
      loDbSum += db;
      loCount++;
    } else if (hz >= 1600 && hz <= 5200) {
      hiDbSum += db;
      hiCount++;
    }
  }

  const centroidHz = powerSum > 1e-14 ? weightedFreq / powerSum : 0;
  const arithMean = count > 0 ? powerSum / count : 0;
  const geomMean = count > 0 ? Math.exp(logPowerSum / count) : 0;
  const flatness = arithMean > 1e-14 ? Math.min(1, Math.max(0, geomMean / arithMean)) : 0;
  const tiltDb = (hiCount > 0 ? hiDbSum / hiCount : -90) - (loCount > 0 ? loDbSum / loCount : -90);

  out.spectralCentroidHz = centroidHz;
  out.spectralFlatness = flatness;
  out.spectralTiltDb = tiltDb;
  out.onsetFluxDb = onsetFluxDb;
  out.trajectorySpeedHzPerSec = trajectorySpeedHzPerSec;
  out.cepstralF0Hz = cepstral.cepstralF0Hz;
  out.antiResonanceHz = cepstral.antiResonanceHz;
  out.antiResonanceDepthDb = cepstral.antiResonanceDepthDb;
  out.vocalTractLengthCm = voiced ? estimateVocalTractLengthCm(formants.f1, formants.f2, formants.f3) : 0;

  // 2. Top-6 spectral peaks (minimum 2-bin separation) for multi-harmonic 3D wave superposition
  extractTopSpectralPeaks(fftMagnitudeDb, analysisRate, out.topPeaks);

  // 3. Classify open-set acoustic regime
  if (stability.rmsDb <= -58) {
    out.kind = "silence";
    out.label = REGIME_LABELS.silence;
    out.detail = "Below the −58 dB acoustic gate.";
    return out;
  }

  if (!voiced) {
    if (onsetFluxDb >= 11) {
      out.kind = "plosive";
      out.label = REGIME_LABELS.plosive;
      out.detail = `Sudden +${onsetFluxDb.toFixed(1)} dB burst · centroid ${Math.round(centroidHz)} Hz (plosive / percussive onset).`;
      return out;
    }
    out.kind = "fricative";
    out.label = REGIME_LABELS.fricative;
    out.detail = `Aperiodic turbulence · centroid ${Math.round(centroidHz)} Hz · flatness ${(flatness * 100).toFixed(0)}% (sibilant / fricative / whisper).`;
    return out;
  }

  // Voiced / periodic signals: distinguish pure harmonic tones/instruments vs off-chart sonorants/nasals vs vowels
  const singleToneDominant = out.topPeaks[0].ampLinear >= 0.68;
  const narrowResonance = (formants.b1 > 0 && formants.b1 < 34) || formants.f2 <= 0 || singleToneDominant;
  if (stability.pitchConfidence >= 0.93 && flatness < 0.015 && narrowResonance) {
    out.kind = "instrument";
    out.label = REGIME_LABELS.instrument;
    out.detail = `High-clarity periodic tone (${Math.round(stability.f0Hz)} Hz) · narrow harmonic line spectrum.`;
    return out;
  }

  if (cepstral.antiResonanceDepthDb >= 9.0 || distanceBark > 1.75) {
    out.kind = "sonorant";
    out.label = REGIME_LABELS.sonorant;
    if (cepstral.antiResonanceDepthDb >= 9.0 && cepstral.antiResonanceHz > 0) {
      out.detail = `Spectral anti-zero at ${Math.round(cepstral.antiResonanceHz)} Hz (−${cepstral.antiResonanceDepthDb.toFixed(1)} dB) · nasal or coupled resonator.`;
    } else if (trajectorySpeedHzPerSec > 1800) {
      out.detail = `Rapid formant glide (${Math.round(trajectorySpeedHzPerSec)} Hz/s) · diphthong or consonant transition.`;
    } else {
      out.detail = `Periodic resonance ${distanceBark.toFixed(2)} Bark outside the 8 reference vowel targets.`;
    }
    return out;
  }

  out.kind = "vowel";
  out.label = REGIME_LABELS.vowel;
  out.detail =
    trajectorySpeedHzPerSec > 1600
      ? `Diphthong / vowel transition (${Math.round(trajectorySpeedHzPerSec)} Hz/s) · tract ~${out.vocalTractLengthCm.toFixed(1)} cm.`
      : `Steady vocal-tract resonance · est. tract length ${out.vocalTractLengthCm.toFixed(1)} cm.`;
  return out;
}
