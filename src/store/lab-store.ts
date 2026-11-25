import { create } from "zustand";
import type { AnalysisConfig, AnalyzerOptions } from "@/lib/dsp/analyzer";
import { createStageTraceBuffers, DEFAULT_ANALYZER_OPTIONS, FRAME_SIZE } from "@/lib/dsp/analyzer";
import { AudioController, DEFAULT_SYNTH, type SourceMode, type SynthSettings } from "@/lib/dsp/audio-controller";
import { chladniModes } from "@/lib/chladni";
import { evaluateLPCEnvelopeDb } from "@/lib/dsp/fft-lpc";
import { copyRegimeInto, createRegimeTelemetry, TRACT_SECTIONS } from "@/lib/dsp/regime";
import { DEFAULT_TARGET, evaluateTargetConvergence, findVowel } from "@/lib/dsp/vowel-targets";
import { getWindow } from "@/lib/dsp/windows";
import type { ComplexPoint, DSPFrameTelemetry, LpcMethod, ShapeModel, WindowType } from "@/types/dsp";

/** "all" shows every panel; the others solo one. */
export type LabView = "all" | "figure" | "vowel" | "spectrum" | "poles" | "scope" | "time";
export type LabMode = "workspace" | "experiments";
export type ExperimentId = 1 | 2 | 3 | 4 | 5;
export type TraceStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ExperimentBaselineSnapshot {
  label: string;
  telemetry: DSPFrameTelemetry;
  fftMagnitudeDb: Float32Array;
  lpcEnvelopeDb: Float32Array;
  f0Hz: number;
  f1: number;
  f2: number;
  f3: number;
  b1: number;
  b2: number;
  b3: number;
  sidelobeFloorDb: number;
  highBandTiltDb: number;
  pole1Radius: number;
  pole1AngleRad: number;
  pole2Radius: number;
  pole2AngleRad: number;
  chladniM: number;
  chladniN: number;
}

export interface PoleOverrideEntry {
  formantIndex: 1 | 2;
  re: number;
  im: number;
  radius: number;
  angleRad: number;
  freqHz: number;
  bandwidthHz: number;
}

/**
 * Compute inter-harmonic sidelobe / spectral leakage floor (dB) across 1.2–5.5 kHz.
 * Averages local minima (inter-harmonic troughs) so harmonic peaks do not bias the floor.
 */
export function computeSidelobeFloorDb(fftDb: Float32Array): number {
  const startBin = Math.max(2, Math.floor((1200 / 6000) * fftDb.length));
  const endBin = Math.min(fftDb.length - 3, Math.floor((5500 / 6000) * fftDb.length));
  let sum = 0;
  let count = 0;
  for (let b = startBin; b <= endBin; b++) {
    const v = fftDb[b];
    if (v <= fftDb[b - 1] && v <= fftDb[b + 1]) {
      sum += v;
      count++;
    }
  }
  if (count === 0) {
    for (let b = startBin; b <= endBin; b++) {
      sum += fftDb[b];
      count++;
    }
  }
  return count > 0 ? sum / count : -100;
}

/**
 * Compute High-Band (1.5–4.5 kHz) minus Low-Band (0.1–1.0 kHz) spectral energy ratio in dB.
 */
export function computeHighBandTiltDb(fftDb: Float32Array): number {
  const n = fftDb.length;
  const lo0 = Math.max(1, Math.floor((100 / 6000) * n));
  const lo1 = Math.max(lo0 + 1, Math.floor((1000 / 6000) * n));
  const hi0 = Math.max(lo1 + 1, Math.floor((1500 / 6000) * n));
  const hi1 = Math.min(n - 1, Math.floor((4500 / 6000) * n));
  let loSum = 0;
  for (let b = lo0; b <= lo1; b++) loSum += fftDb[b];
  const loMean = loSum / (lo1 - lo0 + 1);
  let hiSum = 0;
  for (let b = hi0; b <= hi1; b++) hiSum += fftDb[b];
  const hiMean = hiSum / (hi1 - hi0 + 1);
  return hiMean - loMean;
}

export interface LabState {
  activeView: LabView;
  labMode: LabMode;
  activeExperiment: ExperimentId;
  baselineVersion: number;
  sourceMode: SourceMode;
  micStatus: "idle" | "requesting" | "active" | "error";
  micError: string | null;
  micDeviceLabel: string | null;
  micGain: number;
  autoCaptureArmed: boolean;
  isRecordingClip: boolean;
  hasRecordedClip: boolean;
  playingRecordedClip: boolean;
  recordingProgress: number;
  frozen: boolean;
  traceOpen: boolean;
  traceStage: number;
  bypassedStage: number | null;
  recomputeCount: number;
  showNodalLines: boolean;
  showCepstrum: boolean;
  shapeModel: ShapeModel;
  plateExciteCount: number;
  targetId: string;
  synth: SynthSettings;
  analyzerOptions: AnalyzerOptions;
  volume: number;

  setActiveView: (view: LabView) => void;
  setLabMode: (mode: LabMode) => void;
  setActiveExperiment: (id: ExperimentId) => void;
  captureExperimentBaseline: (label: string) => void;
  clearExperimentBaseline: () => void;
  resetExperiment: (id?: ExperimentId) => void;
  setShowNodalLines: (show: boolean) => void;
  setShowCepstrum: (show: boolean) => void;
  setShapeModel: (model: ShapeModel) => void;
  excitePlate: () => void;
  calibrateVtlToCurrentVoice: () => void;
  setSourceMode: (mode: SourceMode) => Promise<void>;
  setMicGain: (gain: number) => void;
  setAutoCaptureArmed: (armed: boolean) => void;
  startRecording3s: () => void;
  setPlayRecordedClip: (play: boolean) => void;
  toggleFreeze: () => void;
  setTraceOpen: (open: boolean) => void;
  setTraceStage: (stage: number) => void;
  stepTraceStage: (delta: number) => void;
  captureAndTrace: () => void;
  toggleBypassStage: (stage: number) => void;
  selectTarget: (vowelId: string, syncSynth?: boolean) => void;
  updateSynth: (patch: Partial<SynthSettings>) => void;
  updateAnalyzerOptions: (patch: Partial<AnalyzerOptions>) => void;
  setVolume: (volume: number) => void;
  resetCalibration: () => void;
  clearTrail: () => void;
}

export const TRAIL_CAPACITY = 140;

export interface TrailBuffer {
  f1: Float32Array;
  f2: Float32Array;
  score: Float32Array;
  head: number;
  count: number;
}

type FrameListener = (telemetry: DSPFrameTelemetry) => void;

function createSnapshotBuffer(): DSPFrameTelemetry {
  const poles: ComplexPoint[] = Array.from({ length: 24 }, () => ({
    re: 0,
    im: 0,
    magnitude: 0,
    angleRad: 0,
    freqHz: 0,
    bandwidthHz: 0,
    formantIndex: 0,
  }));
  return {
    timestampMs: 0,
    sampleRate: 48000,
    analysisRate: 12000,
    windowType: "hamming",
    lpcMethod: "autocorr",
    vtlScale: 1,
    voiced: false,
    timeDomainRaw: new Float32Array(FRAME_SIZE),
    timeDomainWindowed: new Float32Array(FRAME_SIZE),
    fftMagnitudeDb: new Float32Array(FRAME_SIZE).fill(-120),
    lpcEnvelopeDb: new Float32Array(FRAME_SIZE).fill(-120),
    cepstralEnvelopeDb: new Float32Array(FRAME_SIZE).fill(-120),
    vocalTractArea: new Float32Array(TRACT_SECTIONS).fill(0.5),
    lpcCoefficients: new Array<number>(12).fill(0),
    zPlanePoles: poles,
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
      targetId: DEFAULT_TARGET.id,
      euclideanDistanceHz: 0,
      distanceBark: 0,
      convergenceScore: 0,
      guidance: "Waiting for a voiced sound.",
    },
    regime: createRegimeTelemetry(),
    stageBuffers: createStageTraceBuffers(12),
  };
}

function copyTelemetryInto(src: DSPFrameTelemetry, dst: DSPFrameTelemetry): void {
  dst.timestampMs = src.timestampMs;
  dst.sampleRate = src.sampleRate;
  dst.analysisRate = src.analysisRate;
  dst.windowType = src.windowType;
  dst.lpcMethod = src.lpcMethod;
  dst.vtlScale = src.vtlScale;
  dst.voiced = src.voiced;
  dst.timeDomainRaw.set(src.timeDomainRaw);
  dst.timeDomainWindowed.set(src.timeDomainWindowed);
  dst.fftMagnitudeDb.set(src.fftMagnitudeDb);
  dst.lpcEnvelopeDb.set(src.lpcEnvelopeDb);
  dst.cepstralEnvelopeDb.set(src.cepstralEnvelopeDb);
  dst.vocalTractArea.set(src.vocalTractArea);
  copyRegimeInto(src.regime, dst.regime);
  if (dst.lpcCoefficients.length !== src.lpcCoefficients.length) {
    dst.lpcCoefficients = src.lpcCoefficients.slice();
  } else {
    for (let i = 0; i < src.lpcCoefficients.length; i++) {
      dst.lpcCoefficients[i] = src.lpcCoefficients[i];
    }
  }
  const poleCount = src.zPlanePoles.length;
  if (dst.zPlanePoles.length !== poleCount) {
    dst.zPlanePoles = src.zPlanePoles.map((p) => ({ ...p }));
  } else {
    for (let i = 0; i < poleCount; i++) {
      Object.assign(dst.zPlanePoles[i], src.zPlanePoles[i]);
    }
  }
  Object.assign(dst.formants, src.formants);
  Object.assign(dst.stability, src.stability);
  Object.assign(dst.activeTargetMatch, src.activeTargetMatch);

  const ssb = src.stageBuffers;
  const dsb = dst.stageBuffers;
  dsb.rawDecimated.set(ssb.rawDecimated);
  dsb.preEmphasized.set(ssb.preEmphasized);
  dsb.windowWeights.set(ssb.windowWeights);
  dsb.windowed.set(ssb.windowed);
  dsb.nsdfCurve.set(ssb.nsdfCurve);
  dsb.peakLagTau = ssb.peakLagTau;
  dsb.autocorrCoeffs = ssb.autocorrCoeffs.slice();
  dsb.lpcCoeffs = ssb.lpcCoeffs.slice();
  dsb.lpcGain = ssb.lpcGain;
  dsb.allPoles = ssb.allPoles.map((p) => ({ ...p }));
}

class LabRuntime {
  private controller: AudioController | null = null;
  private unsubController: (() => void) | null = null;
  private listeners = new Set<FrameListener>();
  private frozen = false;
  private snapshot = createSnapshotBuffer();
  private baselineSnapshot = createSnapshotBuffer();
  private lastVoicedSnapshot = createSnapshotBuffer();
  private overriddenLiveSnapshot = createSnapshotBuffer();
  private experimentBaselineTelemetry = createSnapshotBuffer();
  private experimentBaseline: ExperimentBaselineSnapshot | null = null;
  private poleOverrides: { 1?: PoleOverrideEntry; 2?: PoleOverrideEntry } = {};
  private polyReScratch = new Float64Array(25);
  private polyImScratch = new Float64Array(25);
  private polyAScratch = new Float64Array(24);
  private lastVoicedRawPcm: Float32Array | null = null;
  private hasHeldVoiced = false;
  private liveRmsDb = -120;
  private liveVoiced = false;
  private capturedRawPcm: Float32Array | null = null;
  private capturedSampleRate = 48000;
  private baselineOptions: AnalyzerOptions = { ...DEFAULT_ANALYZER_OPTIONS };
  private divider = 1;
  private frame = 0;
  private armedVoicedStreak = 0;

  readonly trail: TrailBuffer = {
    f1: new Float32Array(TRAIL_CAPACITY),
    f2: new Float32Array(TRAIL_CAPACITY),
    score: new Float32Array(TRAIL_CAPACITY),
    head: 0,
    count: 0,
  };

  private ensureController(): AudioController | null {
    if (typeof window === "undefined") return null;
    if (!this.controller) {
      this.controller = new AudioController(DEFAULT_SYNTH, DEFAULT_ANALYZER_OPTIONS);
      this.controller.onStreamEnded = () => {
        useLabStore.setState({
          sourceMode: "silent",
          micStatus: "idle",
          micError: null,
          micDeviceLabel: null,
          autoCaptureArmed: false,
          isRecordingClip: false,
          playingRecordedClip: false,
        });
        this.controller?.stop();
      };
      this.controller.onRecordingStateChange = () => {
        if (!this.controller) return;
        useLabStore.setState({
          isRecordingClip: this.controller.isRecordingClip,
          hasRecordedClip: this.controller.hasRecordedClip,
          playingRecordedClip: this.controller.playingRecordedClip,
          recordingProgress: this.controller.recordingProgress,
        });
      };
    }
    return this.controller;
  }

  getController(): AudioController | null {
    return this.ensureController();
  }

  getLiveRmsDb(): number {
    return this.liveRmsDb;
  }

  isLiveVoiced(): boolean {
    return this.liveVoiced;
  }

  isHoldingLastVoiced(): boolean {
    const ctrl = this.ensureController();
    return Boolean(
      !this.frozen &&
        ctrl &&
        (ctrl.mode === "mic" || ctrl.mode === "stream") &&
        !this.liveVoiced &&
        this.hasHeldVoiced &&
        !ctrl.isRecordingClip,
    );
  }

  getActiveTelemetry(): DSPFrameTelemetry {
    if (this.frozen) return this.snapshot;
    const ctrl = this.ensureController();
    if (!ctrl) return this.snapshot;
    const rawActive =
      (ctrl.mode === "mic" || ctrl.mode === "stream") &&
      !ctrl.telemetry.voiced &&
      this.hasHeldVoiced &&
      !ctrl.isRecordingClip
        ? this.lastVoicedSnapshot
        : ctrl.telemetry;
    if (this.hasPoleOverrides()) {
      copyTelemetryInto(rawActive, this.overriddenLiveSnapshot);
      this.applyPoleOverridesToTelemetry(this.overriddenLiveSnapshot);
      return this.overriddenLiveSnapshot;
    }
    return rawActive;
  }

  /** The original frozen telemetry captured before any parameter changes while paused. */
  getBaselineTelemetry(): DSPFrameTelemetry {
    if (this.frozen) return this.baselineSnapshot;
    return this.getActiveTelemetry();
  }

  /** Capture a BEFORE baseline snapshot for interactive classroom experiments. */
  captureBaseline(label: string): ExperimentBaselineSnapshot {
    const src = this.getActiveTelemetry();
    copyTelemetryInto(src, this.experimentBaselineTelemetry);
    const modes = { m: 2.8, n: 5.6 };
    if (src.formants.f1 > 0 && src.formants.f2 > 0) {
      chladniModes(src.formants.f1, src.formants.f2, modes);
    }
    let p1Radius = 0;
    let p1Angle = 0;
    let p2Radius = 0;
    let p2Angle = 0;
    for (const p of src.zPlanePoles) {
      if (p.im > 0 && p.formantIndex === 1) {
        p1Radius = p.magnitude;
        p1Angle = p.angleRad;
      } else if (p.im > 0 && p.formantIndex === 2) {
        p2Radius = p.magnitude;
        p2Angle = p.angleRad;
      }
    }
    this.experimentBaseline = {
      label,
      telemetry: this.experimentBaselineTelemetry,
      fftMagnitudeDb: this.experimentBaselineTelemetry.fftMagnitudeDb,
      lpcEnvelopeDb: this.experimentBaselineTelemetry.lpcEnvelopeDb,
      f0Hz: src.stability.f0Hz,
      f1: src.formants.f1,
      f2: src.formants.f2,
      f3: src.formants.f3,
      b1: src.formants.b1,
      b2: src.formants.b2,
      b3: src.formants.b3,
      sidelobeFloorDb: computeSidelobeFloorDb(src.fftMagnitudeDb),
      highBandTiltDb: computeHighBandTiltDb(src.fftMagnitudeDb),
      pole1Radius: p1Radius,
      pole1AngleRad: p1Angle,
      pole2Radius: p2Radius,
      pole2AngleRad: p2Angle,
      chladniM: modes.m,
      chladniN: modes.n,
    };
    const active = this.getActiveTelemetry();
    for (const cb of this.listeners) cb(active);
    return this.experimentBaseline;
  }

  clearBaseline(): void {
    this.experimentBaseline = null;
    const active = this.getActiveTelemetry();
    for (const cb of this.listeners) cb(active);
  }

  getExperimentBaseline(): ExperimentBaselineSnapshot | null {
    return this.experimentBaseline;
  }

  hasPoleOverrides(): boolean {
    return Boolean(this.poleOverrides[1] || this.poleOverrides[2]);
  }

  getPoleOverrides(): { 1?: PoleOverrideEntry; 2?: PoleOverrideEntry } {
    return this.poleOverrides;
  }

  /**
   * Directly set a Z-plane conjugate pole pair (Formant 1 or Formant 2) inside the unit circle
   * and immediately re-evaluate A(z), the LPC spectral envelope, formant frequencies/bandwidths,
   * vowel position, and Chladni plate modes.
   */
  setPoleOverride(formantIndex: 1 | 2, rawRe: number, rawIm: number): PoleOverrideEntry {
    const absIm = Math.max(0.02, Math.abs(rawIm));
    let r = Math.hypot(rawRe, absIm);
    r = Math.max(0.5, Math.min(0.995, r));
    const minFreq = formantIndex === 1 ? 180 : 650;
    const maxFreq = formantIndex === 1 ? 1150 : 3200;
    // The rate the poles live at: about 12 kHz, but 11,025 Hz when the input runs at 44.1 kHz.
    const fs = this.getActiveTelemetry().analysisRate || 12000;
    let theta = Math.atan2(absIm, rawRe);
    const minTheta = (2 * Math.PI * minFreq) / fs;
    const maxTheta = (2 * Math.PI * maxFreq) / fs;
    theta = Math.max(minTheta, Math.min(maxTheta, theta));
    const re = r * Math.cos(theta);
    const im = r * Math.sin(theta);
    const freqHz = (theta * fs) / (2 * Math.PI);
    const bandwidthHz = (-Math.log(r) * fs) / Math.PI;
    const entry: PoleOverrideEntry = {
      formantIndex,
      re,
      im,
      radius: r,
      angleRad: theta,
      freqHz,
      bandwidthHz,
    };
    this.poleOverrides[formantIndex] = entry;
    if (this.frozen) {
      copyTelemetryInto(this.baselineSnapshot, this.snapshot);
      this.applyPoleOverridesToTelemetry(this.snapshot);
      for (const cb of this.listeners) cb(this.snapshot);
    } else {
      const active = this.getActiveTelemetry();
      for (const cb of this.listeners) cb(active);
    }
    return entry;
  }

  /** Keyboard accessibility helper: nudge Formant 1 or 2 pole by dRadius and dFreqHz. */
  nudgePoleOverride(formantIndex: 1 | 2, dRadius: number, dFreqHz: number): PoleOverrideEntry {
    const existing = this.poleOverrides[formantIndex];
    // The rate the poles live at: about 12 kHz, but 11,025 Hz when the input runs at 44.1 kHz.
    const fs = this.getActiveTelemetry().analysisRate || 12000;
    let curRadius = existing?.radius ?? 0;
    let curFreq = existing?.freqHz ?? 0;
    if (!existing) {
      const t = this.getActiveTelemetry();
      for (const p of t.zPlanePoles) {
        if (p.im > 0 && p.formantIndex === formantIndex) {
          curRadius = p.magnitude;
          curFreq = p.freqHz;
          break;
        }
      }
      if (curRadius <= 0) {
        curRadius = formantIndex === 1 ? 0.94 : 0.91;
        curFreq = formantIndex === 1 ? (t.formants.f1 || 720) : (t.formants.f2 || 1180);
      }
    }
    const nextR = Math.max(0.5, Math.min(0.995, curRadius + dRadius));
    const nextF = Math.max(formantIndex === 1 ? 180 : 650, Math.min(formantIndex === 1 ? 1150 : 3200, curFreq + dFreqHz));
    const theta = (2 * Math.PI * nextF) / fs;
    return this.setPoleOverride(formantIndex, nextR * Math.cos(theta), nextR * Math.sin(theta));
  }

  clearPoleOverride(): void {
    this.poleOverrides = {};
    if (this.frozen) {
      copyTelemetryInto(this.baselineSnapshot, this.snapshot);
      for (const cb of this.listeners) cb(this.snapshot);
    } else {
      const active = this.getActiveTelemetry();
      for (const cb of this.listeners) cb(active);
    }
  }

  private applyPoleOverridesToTelemetry(t: DSPFrameTelemetry): void {
    if (!this.hasPoleOverrides()) return;
    const poles = t.zPlanePoles;
    const pCount = poles.length;
    if (pCount < 2) return;

    for (const fIdx of [1, 2] as const) {
      const ov = this.poleOverrides[fIdx];
      if (!ov) continue;

      let upperIdx = -1;
      for (let i = 0; i < pCount; i++) {
        if (poles[i].im >= 0 && poles[i].formantIndex === fIdx) {
          upperIdx = i;
          break;
        }
      }
      if (upperIdx < 0) {
        let bestDist = Infinity;
        for (let i = 0; i < pCount; i++) {
          if (poles[i].im > 0 && poles[i].magnitude > 0 && poles[i].formantIndex === 0) {
            const d = Math.abs(poles[i].freqHz - ov.freqHz);
            if (d < bestDist) {
              bestDist = d;
              upperIdx = i;
            }
          }
        }
      }
      if (upperIdx < 0) continue;

      const oldRe = poles[upperIdx].re;
      const oldIm = poles[upperIdx].im;
      let lowerIdx = -1;
      let bestConj = Infinity;
      for (let i = 0; i < pCount; i++) {
        if (i === upperIdx) continue;
        const d = Math.hypot(poles[i].re - oldRe, poles[i].im + oldIm);
        if (d < bestConj) {
          bestConj = d;
          lowerIdx = i;
        }
      }

      const up = poles[upperIdx];
      up.re = ov.re;
      up.im = ov.im;
      up.magnitude = ov.radius;
      up.angleRad = ov.angleRad;
      up.freqHz = ov.freqHz;
      up.bandwidthHz = ov.bandwidthHz;
      up.formantIndex = fIdx;
      if (upperIdx < t.stageBuffers.allPoles.length) {
        const sp = t.stageBuffers.allPoles[upperIdx];
        sp.re = ov.re;
        sp.im = ov.im;
        sp.radius = ov.radius;
        sp.anglePi = ov.angleRad / Math.PI;
        sp.freqHz = ov.freqHz;
        sp.bandwidthHz = ov.bandwidthHz;
        sp.selectedAs = fIdx === 1 ? "F1" : "F2";
      }

      if (lowerIdx >= 0) {
        const lo = poles[lowerIdx];
        lo.re = ov.re;
        lo.im = -ov.im;
        lo.magnitude = ov.radius;
        lo.angleRad = -ov.angleRad;
        lo.freqHz = ov.freqHz;
        lo.bandwidthHz = ov.bandwidthHz;
        lo.formantIndex = fIdx;
        if (lowerIdx < t.stageBuffers.allPoles.length) {
          const sp = t.stageBuffers.allPoles[lowerIdx];
          sp.re = ov.re;
          sp.im = -ov.im;
          sp.radius = ov.radius;
          sp.anglePi = -ov.angleRad / Math.PI;
          sp.freqHz = ov.freqHz;
          sp.bandwidthHz = ov.bandwidthHz;
          sp.selectedAs = null;
        }
      }

      if (fIdx === 1) {
        t.formants.f1 = ov.freqHz;
        t.formants.b1 = ov.bandwidthHz;
      } else {
        t.formants.f2 = ov.freqHz;
        t.formants.b2 = ov.bandwidthHz;
      }
    }

    // Reconstruct predictor polynomial A(z) = 1 - sum_{k=1}^p a_k z^{-k} from all roots z_0..z_{p-1}.
    if (this.polyReScratch.length < pCount + 1) {
      this.polyReScratch = new Float64Array(pCount + 1);
      this.polyImScratch = new Float64Array(pCount + 1);
      this.polyAScratch = new Float64Array(pCount);
    }
    const cRe = this.polyReScratch;
    const cIm = this.polyImScratch;
    cRe.fill(0, 0, pCount + 1);
    cIm.fill(0, 0, pCount + 1);
    cRe[0] = 1;
    for (let m = 0; m < pCount; m++) {
      const zr = poles[m].re;
      const zi = poles[m].im;
      for (let j = m + 1; j >= 1; j--) {
        const prevRe = cRe[j - 1];
        const prevIm = cIm[j - 1];
        cRe[j] -= zr * prevRe - zi * prevIm;
        cIm[j] -= zr * prevIm + zi * prevRe;
      }
    }
    const a = this.polyAScratch.subarray(0, pCount);
    for (let k = 0; k < pCount; k++) {
      a[k] = -cRe[k + 1];
      if (k < t.lpcCoefficients.length) t.lpcCoefficients[k] = a[k];
      if (k < t.stageBuffers.lpcCoeffs.length) t.stageBuffers.lpcCoeffs[k] = a[k];
    }

    const { sum: windowSum } = getWindow(t.windowType, FRAME_SIZE);
    const refDb = -20 * Math.log10(windowSum / 2);
    const gain = t.stageBuffers.lpcGain > 1e-6 ? t.stageBuffers.lpcGain : 0.04;
    evaluateLPCEnvelopeDb(a, gain, FRAME_SIZE, t.lpcEnvelopeDb, refDb);

    const q1 = t.formants.f1 > 0 ? Math.max(0, 1 - t.formants.b1 / 500) : 0;
    const q2 = t.formants.f2 > 0 ? Math.max(0, 1 - t.formants.b2 / 500) : 0;
    t.formants.confidence = Math.max(0.15, 0.5 * (q1 + q2));
    t.voiced = true;
    const target = findVowel(t.activeTargetMatch.targetId);
    evaluateTargetConvergence(t.formants, target, t.activeTargetMatch, t.vtlScale || 1);
  }

  getCapturedRawPcm(): Float32Array | null {
    return this.capturedRawPcm;
  }

  getBaselineOptions(): AnalyzerOptions {
    return this.baselineOptions;
  }

  setFrozen(frozen: boolean): void {
    const ctrl = this.ensureController();
    if (frozen && !this.frozen && ctrl) {
      const useHeld =
        (ctrl.mode === "mic" || ctrl.mode === "stream") &&
        !ctrl.telemetry.voiced &&
        this.hasHeldVoiced &&
        this.lastVoicedRawPcm !== null;
      const rawSlice = useHeld && this.lastVoicedRawPcm ? this.lastVoicedRawPcm : ctrl.getCurrentRawSlice();
      const srcTelemetry = useHeld ? this.lastVoicedSnapshot : ctrl.telemetry;
      this.capturedRawPcm = new Float32Array(rawSlice);
      this.capturedSampleRate = ctrl.analyzer.sampleRate;
      this.baselineOptions = { ...ctrl.analyzer.options };
      copyTelemetryInto(srcTelemetry, this.snapshot);
      copyTelemetryInto(srcTelemetry, this.baselineSnapshot);
    }
    this.frozen = frozen;
    const active = this.getActiveTelemetry();
    for (const cb of this.listeners) cb(active);
  }

  /** Capture a fresh raw slice from the live controller and freeze on it. */
  captureNewSlice(): void {
    const ctrl = this.ensureController();
    if (!ctrl) return;
    const useHeld =
      (ctrl.mode === "mic" || ctrl.mode === "stream") &&
      !ctrl.telemetry.voiced &&
      this.hasHeldVoiced &&
      this.lastVoicedRawPcm !== null;
    const rawSlice = useHeld && this.lastVoicedRawPcm ? this.lastVoicedRawPcm : ctrl.getCurrentRawSlice();
    const srcTelemetry = useHeld ? this.lastVoicedSnapshot : ctrl.telemetry;
    this.capturedRawPcm = new Float32Array(rawSlice);
    this.capturedSampleRate = ctrl.analyzer.sampleRate;
    this.baselineOptions = { ...ctrl.analyzer.options };
    copyTelemetryInto(srcTelemetry, this.snapshot);
    copyTelemetryInto(srcTelemetry, this.baselineSnapshot);
    this.frozen = true;
    for (const cb of this.listeners) cb(this.snapshot);
  }

  /** Re-run VoiceAnalyzer on the captured raw PCM buffer while frozen and broadcast the updated telemetry. */
  recomputeFrozen(overrides: AnalysisConfig = {}): DSPFrameTelemetry {
    const ctrl = this.ensureController();
    if (!this.frozen || !ctrl || !this.capturedRawPcm) return this.getActiveTelemetry();
    const recomputed = ctrl.analyzer.reprocessCapturedBuffer(
      this.capturedRawPcm,
      this.capturedSampleRate,
      overrides,
    );
    const savedTs = this.baselineSnapshot.timestampMs;
    copyTelemetryInto(recomputed, this.snapshot);
    this.snapshot.timestampMs = savedTs;
    if (this.hasPoleOverrides()) {
      this.applyPoleOverridesToTelemetry(this.snapshot);
    }
    for (const cb of this.listeners) cb(this.snapshot);
    return this.snapshot;
  }

  clearTrail(): void {
    this.trail.head = 0;
    this.trail.count = 0;
    this.hasHeldVoiced = false;
    this.lastVoicedRawPcm = null;
  }

  /** Deliver every nth frame only: 1 is live; a larger step is the reduced-motion rate. */
  setDivider(n: number): void {
    this.divider = Math.max(1, Math.round(n));
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    const ctrl = this.ensureController();
    if (ctrl && !this.unsubController) {
      this.unsubController = ctrl.subscribe((t) => {
        this.liveRmsDb = t.stability.rmsDb;
        this.liveVoiced = t.voiced;
        const skip = ++this.frame % this.divider !== 0;
        if (this.frozen) {
          if (skip) return;
          for (const cb of this.listeners) cb(this.snapshot);
          return;
        }
        if (t.voiced && t.formants.confidence > 0.1 && t.formants.f1 > 0 && t.formants.f2 > 0) {
          const idx = this.trail.head;
          this.trail.f1[idx] = t.formants.f1;
          this.trail.f2[idx] = t.formants.f2;
          this.trail.score[idx] = t.activeTargetMatch.convergenceScore;
          this.trail.head = (idx + 1) % TRAIL_CAPACITY;
          if (this.trail.count < TRAIL_CAPACITY) this.trail.count++;
          copyTelemetryInto(t, this.lastVoicedSnapshot);
          this.lastVoicedRawPcm = new Float32Array(ctrl.getCurrentRawSlice());
          this.hasHeldVoiced = true;
        }
        if (useLabStore.getState().autoCaptureArmed) {
          if (t.voiced && t.stability.pitchConfidence >= 0.62 && t.formants.confidence >= 0.25 && t.formants.f1 > 0) {
            if (++this.armedVoicedStreak >= 8) {
              this.armedVoicedStreak = 0;
              useLabStore.setState({ autoCaptureArmed: false });
              useLabStore.getState().captureAndTrace();
              return;
            }
          } else {
            this.armedVoicedStreak = 0;
          }
        } else {
          this.armedVoicedStreak = 0;
        }
        if (skip) return;
        const rawOut =
          (ctrl.mode === "mic" || ctrl.mode === "stream") &&
          !t.voiced &&
          this.hasHeldVoiced &&
          !ctrl.isRecordingClip
            ? this.lastVoicedSnapshot
            : t;
        let outFrame = rawOut;
        if (this.hasPoleOverrides()) {
          copyTelemetryInto(rawOut, this.overriddenLiveSnapshot);
          this.applyPoleOverridesToTelemetry(this.overriddenLiveSnapshot);
          outFrame = this.overriddenLiveSnapshot;
        }
        for (const cb of this.listeners) cb(outFrame);
      });
    }
    listener(this.getActiveTelemetry());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubController) {
        this.unsubController();
        this.unsubController = null;
      }
    };
  }
}

export const labRuntime = new LabRuntime();

export const useLabStore = create<LabState>((set, get) => ({
  activeView: "all",
  labMode: "workspace",
  activeExperiment: 1,
  baselineVersion: 0,
  sourceMode: "silent",
  micStatus: "idle",
  micError: null,
  micDeviceLabel: null,
  micGain: 2.5,
  autoCaptureArmed: false,
  isRecordingClip: false,
  hasRecordedClip: false,
  playingRecordedClip: false,
  recordingProgress: 0,
  frozen: false,
  traceOpen: false,
  traceStage: 1,
  bypassedStage: null,
  recomputeCount: 0,
  showNodalLines: true,
  showCepstrum: false,
  shapeModel: "square",
  plateExciteCount: 0,
  targetId: DEFAULT_TARGET.id,
  synth: { ...DEFAULT_SYNTH },
  analyzerOptions: { ...DEFAULT_ANALYZER_OPTIONS },
  volume: 0.4,

  setActiveView: (activeView) => set({ activeView }),

  setLabMode: (labMode) => {
    if (labMode === "experiments" && get().synth.tour) {
      const nextSynth: SynthSettings = { ...get().synth, vowelId: get().targetId, tour: false };
      labRuntime.getController()?.setSettings(nextSynth);
      set({ labMode, synth: nextSynth });
    } else {
      set({ labMode });
    }
  },

  setActiveExperiment: (activeExperiment) => {
    labRuntime.clearBaseline();
    labRuntime.clearPoleOverride();
    if (get().synth.tour) {
      const nextSynth: SynthSettings = { ...get().synth, vowelId: get().targetId, tour: false };
      labRuntime.getController()?.setSettings(nextSynth);
      set({
        labMode: "experiments",
        activeExperiment,
        synth: nextSynth,
        baselineVersion: get().baselineVersion + 1,
      });
    } else {
      set({
        labMode: "experiments",
        activeExperiment,
        baselineVersion: get().baselineVersion + 1,
      });
    }
  },

  captureExperimentBaseline: (label) => {
    labRuntime.captureBaseline(label);
    set({ baselineVersion: get().baselineVersion + 1 });
  },

  clearExperimentBaseline: () => {
    labRuntime.clearBaseline();
    set({ baselineVersion: get().baselineVersion + 1 });
  },

  resetExperiment: (id) => {
    const exp = id ?? get().activeExperiment;
    labRuntime.clearBaseline();
    labRuntime.clearPoleOverride();
    if (exp === 1) {
      get().updateAnalyzerOptions({ windowType: "hamming" });
    } else if (exp === 2) {
      get().updateAnalyzerOptions({ preEmphasis: 0.97 });
    } else if (exp === 3) {
      get().updateAnalyzerOptions({ lpcOrder: 12 });
    } else if (exp === 4) {
      get().updateSynth({ f0Hz: DEFAULT_SYNTH.f0Hz });
    }
    set({
      bypassedStage: null,
      baselineVersion: get().baselineVersion + 1,
    });
  },

  setShowNodalLines: (showNodalLines) => set({ showNodalLines }),

  setShowCepstrum: (showCepstrum) => set({ showCepstrum }),

  setShapeModel: (shapeModel) => set({ shapeModel }),

  excitePlate: () => set((s) => ({ plateExciteCount: s.plateExciteCount + 1 })),

  calibrateVtlToCurrentVoice: () => {
    const t = labRuntime.getActiveTelemetry();
    const target = findVowel(get().targetId);
    let scale = 1;
    if (t.voiced && t.formants.f1 > 150 && t.formants.f2 > 550) {
      // Ratio of speaker's measured (F1, F2) to the reference target's (F1, F2), geometric mean.
      const r1 = t.formants.f1 / target.targetF1;
      const r2 = t.formants.f2 / target.targetF2;
      scale = Math.sqrt(r1 * r2);
    } else if (t.regime.vocalTractLengthCm > 11) {
      scale = 17.2 / t.regime.vocalTractLengthCm;
    }
    const clamped = Number(Math.max(0.8, Math.min(1.28, scale)).toFixed(2));
    get().updateAnalyzerOptions({ vtlScale: clamped });
  },

  setSourceMode: async (mode) => {
    const ctrl = labRuntime.getController();
    if (!ctrl) return;

    // Always unfreeze and clear old trails when switching signal sources so live input is immediately visible.
    labRuntime.setFrozen(false);
    labRuntime.clearTrail();

    if (mode === "silent") {
      ctrl.stop();
      set({
        sourceMode: "silent",
        micStatus: "idle",
        micError: null,
        micDeviceLabel: null,
        autoCaptureArmed: false,
        frozen: false,
        bypassedStage: null,
        recomputeCount: 0,
      });
      return;
    }

    if (mode === "mic" || mode === "stream") {
      set({ micStatus: "requesting", micError: null, frozen: false, bypassedStage: null, recomputeCount: 0 });
    } else {
      set({ micStatus: "idle", micError: null, micDeviceLabel: null, autoCaptureArmed: false, frozen: false, bypassedStage: null, recomputeCount: 0 });
    }

    try {
      ctrl.setInputGain(get().micGain);
      await ctrl.start(mode);
      set({
        sourceMode: mode,
        micStatus: mode === "mic" || mode === "stream" ? "active" : "idle",
        micError: null,
        micDeviceLabel: ctrl.deviceLabel,
        frozen: false,
      });
    } catch (err) {
      ctrl.stop();
      const rawMsg = err instanceof Error ? err.message : "Audio device unavailable.";
      const friendly =
        mode === "mic" && (rawMsg.toLowerCase().includes("denied") || rawMsg.toLowerCase().includes("permission"))
          ? "Microphone access was refused, so the instrument went back to the silent synthetic voice."
          : mode === "stream" && (rawMsg.toLowerCase().includes("denied") || rawMsg.toLowerCase().includes("permission") || rawMsg.toLowerCase().includes("cancel"))
            ? "Tab sharing was cancelled, so the instrument stayed on the synthetic voice."
            : rawMsg;
      set({
        sourceMode: "silent",
        micStatus: mode === "mic" || mode === "stream" ? "error" : "idle",
        micError: mode === "mic" || mode === "stream" ? friendly : null,
        micDeviceLabel: null,
        autoCaptureArmed: false,
      });
    }
  },

  setMicGain: (gain) => {
    const clamped = Math.max(0.5, Math.min(12, gain));
    const ctrl = labRuntime.getController();
    if (ctrl) ctrl.setInputGain(clamped);
    set({ micGain: clamped });
  },

  setAutoCaptureArmed: (autoCaptureArmed) => {
    if (autoCaptureArmed && get().frozen) {
      labRuntime.setFrozen(false);
      set({ autoCaptureArmed: true, frozen: false, bypassedStage: null, recomputeCount: 0 });
    } else {
      set({ autoCaptureArmed });
    }
  },

  startRecording3s: () => {
    const ctrl = labRuntime.getController();
    if (!ctrl || ctrl.mode !== "mic") return;
    labRuntime.setFrozen(false);
    set({ frozen: false, bypassedStage: null, recomputeCount: 0, autoCaptureArmed: false });
    ctrl.startRecordingClip(3);
  },

  setPlayRecordedClip: (play) => {
    const ctrl = labRuntime.getController();
    if (!ctrl) return;
    labRuntime.setFrozen(false);
    set({ frozen: false, bypassedStage: null });
    ctrl.setPlayRecordedClip(play, true);
  },

  toggleFreeze: () => {
    const next = !get().frozen;
    labRuntime.setFrozen(next);
    set({ frozen: next, bypassedStage: null, autoCaptureArmed: false });
  },

  setTraceOpen: (traceOpen) => {
    if (traceOpen && !get().frozen) {
      labRuntime.setFrozen(true);
      set({ traceOpen: true, frozen: true, bypassedStage: null });
    } else {
      set({ traceOpen });
    }
  },

  setTraceStage: (stage) => {
    set({ traceStage: Math.max(1, Math.min(8, stage)) });
  },

  stepTraceStage: (delta) => {
    const cur = get().traceStage;
    const next = ((cur - 1 + delta + 8) % 8) + 1;
    set({ traceStage: next });
  },

  captureAndTrace: () => {
    const ctrl = labRuntime.getController();
    if (ctrl && get().frozen) {
      // Unfreeze, advance one live tick on the current synth/mic/stream buffer, then re-freeze
      labRuntime.setFrozen(false);
    }
    labRuntime.captureNewSlice();
    set({ frozen: true, traceOpen: true, bypassedStage: null, recomputeCount: get().recomputeCount + 1 });
  },

  toggleBypassStage: (stage) => {
    const currentBypass = get().bypassedStage;
    const base = labRuntime.getBaselineOptions();
    if (currentBypass === stage) {
      get().updateAnalyzerOptions({ ...base });
      set({ bypassedStage: null });
      return;
    }
    if (!get().frozen) {
      labRuntime.setFrozen(true);
      set({ frozen: true });
    }
    if (stage === 2) {
      get().updateAnalyzerOptions({ preEmphasis: 0 });
    } else if (stage === 3) {
      get().updateAnalyzerOptions({ windowType: "rectangular" });
    } else if (stage === 6) {
      get().updateAnalyzerOptions({ lpcOrder: 4 });
    }
    set({ bypassedStage: stage });
  },

  selectTarget: (vowelId, syncSynth = false) => {
    const target = findVowel(vowelId);
    const ctrl = labRuntime.getController();
    if (ctrl) {
      ctrl.setTarget(target);
      if (syncSynth) {
        const nextSynth: SynthSettings = {
          ...get().synth,
          vowelId: target.id,
          tour: false,
        };
        ctrl.setSettings(nextSynth);
        set({ targetId: target.id, synth: nextSynth });
        if (labRuntime.isFrozen()) {
          labRuntime.recomputeFrozen({ ...get().analyzerOptions, target });
          set({ recomputeCount: get().recomputeCount + 1 });
        }
        return;
      }
    }
    set({ targetId: target.id });
    if (labRuntime.isFrozen()) {
      labRuntime.recomputeFrozen({ ...get().analyzerOptions, target });
      set({ recomputeCount: get().recomputeCount + 1 });
    }
  },

  updateSynth: (patch) => {
    const next = { ...get().synth, ...patch };
    const ctrl = labRuntime.getController();
    if (ctrl) ctrl.setSettings(next);
    if (patch.vowelId) {
      const target = findVowel(patch.vowelId);
      ctrl?.setTarget(target);
      set({ synth: next, targetId: target.id });
    } else {
      set({ synth: next });
    }
  },

  updateAnalyzerOptions: (patch) => {
    const next = { ...get().analyzerOptions, ...patch };
    const ctrl = labRuntime.getController();
    if (ctrl) ctrl.setOptions(next);
    if (labRuntime.isFrozen()) {
      labRuntime.recomputeFrozen({ ...next, target: findVowel(get().targetId) });
      set({ analyzerOptions: next, recomputeCount: get().recomputeCount + 1 });
    } else {
      set({ analyzerOptions: next });
    }
  },

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    const ctrl = labRuntime.getController();
    if (ctrl) ctrl.setVolume(clamped);
    set({ volume: clamped });
  },

  resetCalibration: () => {
    const ctrl = labRuntime.getController();
    const synth = { ...DEFAULT_SYNTH };
    const opts = { ...DEFAULT_ANALYZER_OPTIONS };
    if (ctrl) {
      ctrl.setTarget(DEFAULT_TARGET);
      ctrl.setSettings(synth);
      ctrl.setOptions(opts);
      ctrl.setVolume(0.4);
    }
    labRuntime.clearBaseline();
    labRuntime.clearPoleOverride();
    labRuntime.clearTrail();
    labRuntime.setFrozen(false);
    set({
      frozen: false,
      bypassedStage: null,
      baselineVersion: get().baselineVersion + 1,
      showNodalLines: true,
      showCepstrum: false,
      shapeModel: "square",
      targetId: DEFAULT_TARGET.id,
      synth,
      analyzerOptions: opts,
      volume: 0.4,
    });
  },

  clearTrail: () => labRuntime.clearTrail(),
}));

export type { LpcMethod, ShapeModel, WindowType };
