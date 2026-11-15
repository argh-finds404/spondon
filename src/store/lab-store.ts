import { create } from "zustand";
import type { AnalyzerOptions } from "@/lib/dsp/analyzer";
import { DEFAULT_ANALYZER_OPTIONS, FRAME_SIZE } from "@/lib/dsp/analyzer";
import { AudioController, DEFAULT_SYNTH, type SourceMode, type SynthSettings } from "@/lib/dsp/audio-controller";
import { DEFAULT_TARGET, findVowel } from "@/lib/dsp/vowel-targets";
import type { ComplexPoint, DSPFrameTelemetry, WindowType } from "@/types/dsp";

/** "all" shows every panel; the others solo one. */
export type LabView = "all" | "figure" | "vowel" | "spectrum" | "poles" | "scope";

export interface LabState {
  activeView: LabView;
  sourceMode: SourceMode;
  micStatus: "idle" | "requesting" | "active" | "error";
  micError: string | null;
  frozen: boolean;
  showNodalLines: boolean;
  targetId: string;
  synth: SynthSettings;
  analyzerOptions: AnalyzerOptions;
  volume: number;

  setActiveView: (view: LabView) => void;
  setShowNodalLines: (show: boolean) => void;
  setSourceMode: (mode: SourceMode) => Promise<void>;
  toggleFreeze: () => void;
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
}

class LabRuntime {
  private controller: AudioController | null = null;
  private unsubController: (() => void) | null = null;
  private listeners = new Set<FrameListener>();
  private frozen = false;
  private snapshot = createSnapshotBuffer();
  private divider = 1;
  private frame = 0;

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
    }
    return this.controller;
  }

  getController(): AudioController | null {
    return this.ensureController();
  }

  getActiveTelemetry(): DSPFrameTelemetry {
    if (this.frozen) return this.snapshot;
    const ctrl = this.ensureController();
    return ctrl ? ctrl.telemetry : this.snapshot;
  }

  setFrozen(frozen: boolean): void {
    const ctrl = this.ensureController();
    if (frozen && !this.frozen && ctrl) {
      copyTelemetryInto(ctrl.telemetry, this.snapshot);
    }
    this.frozen = frozen;
    const active = this.getActiveTelemetry();
    for (const cb of this.listeners) cb(active);
  }

  clearTrail(): void {
    this.trail.head = 0;
    this.trail.count = 0;
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
        }
        if (skip) return;
        for (const cb of this.listeners) cb(t);
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
  frozen: false,
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

    if (mode === "silent") {
      ctrl.stop();
      set({ sourceMode: "silent", micStatus: "idle", micError: null });
      return;
    }

    if (mode === "mic") {
      set({ micStatus: "requesting", micError: null });
    } else {
      set({ micStatus: "idle", micError: null });
    }

    try {
      await ctrl.start(mode);
      set({
        sourceMode: mode,
        micStatus: mode === "mic" ? "active" : "idle",
        micError: null,
      });
    } catch (err) {
      ctrl.stop();
      const rawMsg = err instanceof Error ? err.message : "Audio device unavailable.";
      const friendly =
        rawMsg.toLowerCase().includes("denied") || rawMsg.toLowerCase().includes("permission")
          ? "Microphone access was refused, so the instrument went back to the silent synthetic voice."
          : rawMsg;
      set({
        sourceMode: "silent",
        micStatus: mode === "mic" ? "error" : "idle",
        micError: mode === "mic" ? friendly : null,
      });
    }
  },

  toggleFreeze: () => {
    const next = !get().frozen;
    labRuntime.setFrozen(next);
    set({ frozen: next });
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
        return;
      }
    }
    set({ targetId: target.id });
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
    set({ analyzerOptions: next });
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
      targetId: DEFAULT_TARGET.id,
      synth,
      analyzerOptions: opts,
      volume: 0.4,
    });
  },

  clearTrail: () => labRuntime.clearTrail(),
}));

export type { WindowType };
