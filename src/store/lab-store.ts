import { create } from "zustand";
import type { AnalysisConfig, AnalyzerOptions } from "@/lib/dsp/analyzer";
import { createStageTraceBuffers, DEFAULT_ANALYZER_OPTIONS, FRAME_SIZE } from "@/lib/dsp/analyzer";
import { AudioController, DEFAULT_SYNTH, type SourceMode, type SynthSettings } from "@/lib/dsp/audio-controller";
import { DEFAULT_TARGET, findVowel } from "@/lib/dsp/vowel-targets";
import type { ComplexPoint, DSPFrameTelemetry, WindowType } from "@/types/dsp";

/** "all" shows every panel; the others solo one. */
export type LabView = "all" | "figure" | "vowel" | "spectrum" | "poles" | "scope";
export type TraceStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface LabState {
  activeView: LabView;
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
  targetId: string;
  synth: SynthSettings;
  analyzerOptions: AnalyzerOptions;
  volume: number;

  setActiveView: (view: LabView) => void;
  setShowNodalLines: (show: boolean) => void;
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
    voiced: false,
    timeDomainRaw: new Float32Array(FRAME_SIZE),
    timeDomainWindowed: new Float32Array(FRAME_SIZE),
    fftMagnitudeDb: new Float32Array(FRAME_SIZE).fill(-120),
    lpcEnvelopeDb: new Float32Array(FRAME_SIZE).fill(-120),
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
    stageBuffers: createStageTraceBuffers(12),
  };
}

function copyTelemetryInto(src: DSPFrameTelemetry, dst: DSPFrameTelemetry): void {
  dst.timestampMs = src.timestampMs;
  dst.sampleRate = src.sampleRate;
  dst.analysisRate = src.analysisRate;
  dst.windowType = src.windowType;
  dst.voiced = src.voiced;
  dst.timeDomainRaw.set(src.timeDomainRaw);
  dst.timeDomainWindowed.set(src.timeDomainWindowed);
  dst.fftMagnitudeDb.set(src.fftMagnitudeDb);
  dst.lpcEnvelopeDb.set(src.lpcEnvelopeDb);
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
    if ((ctrl.mode === "mic" || ctrl.mode === "stream") && !ctrl.telemetry.voiced && this.hasHeldVoiced && !ctrl.isRecordingClip) {
      return this.lastVoicedSnapshot;
    }
    return ctrl.telemetry;
  }

  /** The original frozen telemetry captured before any parameter changes while paused. */
  getBaselineTelemetry(): DSPFrameTelemetry {
    if (this.frozen) return this.baselineSnapshot;
    return this.getActiveTelemetry();
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
        const outFrame =
          (ctrl.mode === "mic" || ctrl.mode === "stream") &&
          !t.voiced &&
          this.hasHeldVoiced &&
          !ctrl.isRecordingClip
            ? this.lastVoicedSnapshot
            : t;
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
  targetId: DEFAULT_TARGET.id,
  synth: { ...DEFAULT_SYNTH },
  analyzerOptions: { ...DEFAULT_ANALYZER_OPTIONS },
  volume: 0.4,

  setActiveView: (activeView) => set({ activeView }),

  setShowNodalLines: (showNodalLines) => set({ showNodalLines }),

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
    labRuntime.clearTrail();
    labRuntime.setFrozen(false);
    set({
      frozen: false,
      bypassedStage: null,
      targetId: DEFAULT_TARGET.id,
      synth,
      analyzerOptions: opts,
      volume: 0.4,
    });
  },

  clearTrail: () => labRuntime.clearTrail(),
}));

export type { WindowType };
