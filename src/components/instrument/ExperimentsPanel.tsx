"use client";

import { useEffect, useState } from "react";
import { chladniModes } from "@/lib/chladni";
import { nearestVowel, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { WINDOW_INFO } from "@/lib/dsp/windows";
import {
  computeHighBandTiltDb,
  computeSidelobeFloorDb,
  labRuntime,
  useLabStore,
  type ExperimentId,
} from "@/store/lab-store";
import type { DSPFrameTelemetry, WindowType } from "@/types/dsp";
import { Prov } from "./controls";
import { PlateStage } from "./PlateStage";
import { Trace } from "./Trace";

interface SignalNodeSpec {
  id: string;
  label: string;
  sub: string;
  experimentId: ExperimentId;
}

export const SIGNAL_CHAIN_NODES: readonly SignalNodeSpec[] = [
  { id: "voice", label: "Voice", sub: "Glottal source", experimentId: 4 },
  { id: "prep", label: "Pre-emphasis", sub: "Lift the highs", experimentId: 2 },
  { id: "window", label: "Window", sub: "Taper w[n]", experimentId: 1 },
  { id: "fft", label: "FFT", sub: "1,024 points", experimentId: 4 },
  { id: "f0", label: "F0", sub: "Pitch period", experimentId: 4 },
  { id: "lpc", label: "LPC", sub: "Order p filter", experimentId: 3 },
  { id: "formants", label: "Formants", sub: "Z-plane poles", experimentId: 5 },
  { id: "vowel", label: "Vowel", sub: "F1 against F2", experimentId: 5 },
  { id: "figure", label: "Figure", sub: "Chladni m, n", experimentId: 5 },
] as const;

interface ExperimentMeta {
  id: ExperimentId;
  code: string;
  stageTag: string;
  title: string;
  question: string;
  goal: string;
  formula: string;
  why: string;
}

export const EXPERIMENTS_META: readonly ExperimentMeta[] = [
  {
    id: 1,
    code: "Experiment 1",
    stageTag: "Windowing",
    title: "Why do we window a signal?",
    question: "What happens to the FFT spectrum and LPC formants when you slice 512 samples without tapering the edges?",
    goal: "Break the Hamming window by switching to a Rectangular (unwindowed) boxcar and measure the spectral leakage floor and formant shift against the dashed Hamming baseline.",
    formula: "w_Hamming[n] = 0.54 − 0.46 cos(2πn / (N − 1))   vs.   w_Rect[n] = 1.0",
    why: "A rectangular (unwindowed) frame cuts off the waveform abruptly at n = 0 and n = 511. Those sharp boundary cliffs act like an impulse step in the time domain, spraying spurious −13.3 dB sidelobe energy ('spectral leakage') across every frequency bin and biasing the LPC autocorrelation lags.",
  },
  {
    id: 2,
    code: "Experiment 2",
    stageTag: "Pre-emphasis",
    title: "Why lift the highs before LPC?",
    question: "Why does human speech need a +6 dB/octave pre-emphasis filter before fitting an all-pole vocal tract model?",
    goal: "Break pre-emphasis by setting α = 0 (OFF) and watch the high-frequency spectrum sag while upper formants (F2, F3) lose pole sharpness or collapse.",
    formula: "y[n] = x[n] − α · x[n − 1]   (α = 0.97)   ⇔   H_pre(z) = 1 − 0.97 z⁻¹",
    why: "The human glottal source naturally rolls off at −12 dB/octave, leaving F2 and F3 up to 25–30 dB weaker than F1. Without pre-emphasis (α = 0), Levinson–Durbin spends most of its poles fitting the steep low-frequency glottal slope instead of resolving higher vocal-tract resonances.",
  },
  {
    id: 3,
    code: "Experiment 3",
    stageTag: "Model order",
    title: "Why does the model order matter?",
    question: "How many poles does it take to capture the human vocal tract without merging formants or chasing pitch harmonics?",
    goal: "Compare p = 4 (Underfit), p = 12 (Optimal), and p = 24 (Overfit) against the dashed p = 12 baseline envelope.",
    formula: "H(z) = G / (1 − ∑_{k=1..p} a_k z⁻ᵏ)   →   p / 2 complex conjugate pole pairs",
    why: "Each complex conjugate pole pair models at most one resonance peak. At fs = 12 kHz (0–6 kHz Nyquist), p = 4 provides only 2 pole pairs—merging F1 and F2 into a single wide blob (underfitting). Raising p to 24 gives 12 pole pairs—forcing the envelope to snap onto individual glottal harmonics k·F0 (overfitting).",
  },
  {
    id: 4,
    code: "Experiment 4",
    stageTag: "Spectrum and pitch",
    title: "How does pitch change the spectrum?",
    question: "When you sing the same vowel at a higher pitch, why do the FFT spikes spread apart while the vowel stays the same?",
    goal: "Sweep the fundamental pitch F0 from 110 Hz to 280 Hz and observe time-domain period compression T0 = 1/F0 alongside frequency-domain harmonic expansion Δf = F0.",
    formula: "T₀ = 1 / F₀ (ms)   ⇔   Δf_harmonic = F₀ (Hz)   while   H_tract(e^jω) stays anchored",
    why: "By Fant's Source–Filter theory, speech is the convolution of a periodic glottal pulse train (spaced every T0 ms in time, or every F0 Hz in frequency) with the vocal tract filter. Raising F0 widens the FFT harmonic comb teeth (▲ F0, 2F0, 3F0), making high-pitched voices harder to sample without LPC.",
  },
  {
    id: 5,
    code: "Experiment 5",
    stageTag: "Poles",
    title: "What does a pole actually do?",
    question: "How do a pole's radius r and angle θ inside the unit circle control resonance frequency, bandwidth, vowel identity, and Chladni geometry?",
    goal: "Grab and drag the F1 or F2 pole (●) directly inside the Z-plane unit circle (or use arrow keys / preset buttons) to sculpt the vocal tract filter in real time.",
    formula: "z_k = r_k e^(±jθ_k)   ⇒   F_k = (θ_k · f_s) / 2π Hz ,   B_k = −(f_s / π) ln(r_k) Hz",
    why: "Every formant is a complex conjugate pole pair inside the unit circle. Rotating the pole angle θ slides the resonance peak across frequency Hz; pushing the pole radius r toward the unit circle (r → 1) shrinks damping bandwidth B → 0, turning a flat bump into a laser-sharp ringing peak and morphing the vowel & Chladni figure.",
  },
] as const;

function fmtSigned(delta: number, digits = 0, unit = ""): string {
  const rounded = digits === 0 ? Math.round(delta) : Number(delta.toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${digits === 0 ? rounded : rounded.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

/**
 * Clickable 9-Node Signal Chain bar shown at the top of `/lab`.
 * Clicking any DSP stage jumps straight to the corresponding interactive experiment.
 */
export function SignalChainHeader() {
  const labMode = useLabStore((s) => s.labMode);
  const activeExperiment = useLabStore((s) => s.activeExperiment);
  const setActiveExperiment = useLabStore((s) => s.setActiveExperiment);

  return (
    <nav
      aria-label="Signal chain: choose a stage to open its experiment"
      className="ui-panel mb-3 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
        <span className="text-[12px] font-semibold text-muted">
          The signal chain. Pick a stage to break it and see what changes.
        </span>
        <span className="text-[12px] text-muted">
          {labMode === "experiments"
            ? `Open: experiment ${activeExperiment}, ${EXPERIMENTS_META[activeExperiment - 1].stageTag.toLowerCase()}`
            : "Five experiments, one per group of stages"}
        </span>
      </div>
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto py-0.5">
        {SIGNAL_CHAIN_NODES.map((node, idx) => {
          const isCurrent = labMode === "experiments" && activeExperiment === node.experimentId;
          return (
            <div key={node.id} className="flex flex-none items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveExperiment(node.experimentId)}
                className={`group flex flex-col items-start rounded-(--radius-sm) px-3 py-1.5 text-left transition-[background-color,transform] duration-150 active:scale-[0.97] ${
                  isCurrent ? "bg-accent text-accent-ink" : "bg-raised text-ink hover:bg-hover"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <span>{node.label}</span>
                  <span
                    className={`text-[12px] ${
                      isCurrent ? "text-accent-ink" : "text-accent"
                    }`}
                  >
                    {node.experimentId}
                  </span>
                </span>
                <span
                  className={`text-[12px] whitespace-nowrap ${
                    isCurrent ? "text-accent-ink font-medium" : "text-muted group-hover:text-ink"
                  }`}
                >
                  {node.sub}
                </span>
              </button>
              {idx < SIGNAL_CHAIN_NODES.length - 1 && (
                <span className="px-0.5 text-[12px] text-muted select-none" aria-hidden>
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function ExperimentsPanel() {
  const activeExperiment = useLabStore((s) => s.activeExperiment);
  const setActiveExperiment = useLabStore((s) => s.setActiveExperiment);
  const setLabMode = useLabStore((s) => s.setLabMode);
  const resetExperiment = useLabStore((s) => s.resetExperiment);
  const captureExperimentBaseline = useLabStore((s) => s.captureExperimentBaseline);
  const baselineVersion = useLabStore((s) => s.baselineVersion);
  const options = useLabStore((s) => s.analyzerOptions);
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);
  const synth = useLabStore((s) => s.synth);
  const updateSynth = useLabStore((s) => s.updateSynth);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const setSourceMode = useLabStore((s) => s.setSourceMode);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const nodal = useLabStore((s) => s.showNodalLines);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);

  const [selectedPole, setSelectedPole] = useState<1 | 2>(1);
  const [, setTick] = useState(0);

  // Throttle live numeric readout refresh to ~8 fps so telemetry numbers stay live without 60fps React re-renders.
  useEffect(() => {
    let last = 0;
    return labRuntime.subscribe(() => {
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        setTick((c) => (c + 1) % 100000);
      }
    });
  }, [activeExperiment, baselineVersion, frozen]);

  const meta = EXPERIMENTS_META[activeExperiment - 1];
  const live: DSPFrameTelemetry = labRuntime.getActiveTelemetry();
  const baseSnap = labRuntime.getExperimentBaseline();

  // Live computed metrics from real DSP buffers
  const liveLeakageDb = computeSidelobeFloorDb(live.fftMagnitudeDb);
  const baseLeakageDb = baseSnap ? baseSnap.sidelobeFloorDb : liveLeakageDb;
  const deltaLeakageDb = liveLeakageDb - baseLeakageDb;

  const liveTiltDb = computeHighBandTiltDb(live.fftMagnitudeDb);
  const baseTiltDb = baseSnap ? baseSnap.highBandTiltDb : liveTiltDb;
  const deltaTiltDb = liveTiltDb - baseTiltDb;

  const liveModes = { m: 2.8, n: 5.6 };
  if (live.formants.f1 > 0 && live.formants.f2 > 0) {
    chladniModes(live.formants.f1, live.formants.f2, liveModes);
  }
  const baseModes = baseSnap
    ? { m: baseSnap.chladniM, n: baseSnap.chladniN }
    : { m: liveModes.m, n: liveModes.n };

  const dF1 = baseSnap ? live.formants.f1 - baseSnap.f1 : 0;
  const dF2 = baseSnap ? live.formants.f2 - baseSnap.f2 : 0;
  const dF3 = baseSnap ? live.formants.f3 - baseSnap.f3 : 0;
  const dB2 = baseSnap ? live.formants.b2 - baseSnap.b2 : 0;
  const dF0 = baseSnap ? live.stability.f0Hz - baseSnap.f0Hz : 0;

  // Locate active F1 & F2 poles in zPlanePoles
  let pole1 = live.zPlanePoles.find((p) => p.im > 0 && p.formantIndex === 1) ?? null;
  let pole2 = live.zPlanePoles.find((p) => p.im > 0 && p.formantIndex === 2) ?? null;
  if (!pole1) pole1 = live.zPlanePoles.find((p) => p.im > 0 && p.magnitude > 0) ?? null;
  if (!pole2) pole2 = live.zPlanePoles.find((p) => p.im > 0 && p !== pole1 && p.magnitude > 0) ?? null;

  const activePole = selectedPole === 1 ? pole1 : pole2;
  const basePoleRadius =
    baseSnap ? (selectedPole === 1 ? baseSnap.pole1Radius : baseSnap.pole2Radius) : (activePole?.magnitude ?? 0);
  const basePoleAngle =
    baseSnap ? (selectedPole === 1 ? baseSnap.pole1AngleRad : baseSnap.pole2AngleRad) : (activePole?.angleRad ?? 0);

  // Handlers that automatically snapshot BEFORE baseline prior to applying a change
  const applyWindowExperiment = (w: WindowType) => {
    if (!labRuntime.getExperimentBaseline() || w === "rectangular") {
      if (options.windowType !== w) {
        captureExperimentBaseline(`Before: ${WINDOW_INFO[options.windowType].label} Window`);
      }
    }
    updateOptions({ windowType: w });
  };

  const applyPreEmphasisExperiment = (alpha: number) => {
    if (options.preEmphasis !== alpha) {
      captureExperimentBaseline(
        options.preEmphasis > 0 ? `Before: Pre-Emphasis ON (α = ${options.preEmphasis.toFixed(2)})` : "Before: Pre-Emphasis OFF (α = 0)",
      );
    }
    updateOptions({ preEmphasis: alpha });
  };

  const applyLpcOrderExperiment = (order: number) => {
    if (options.lpcOrder !== order && (!labRuntime.getExperimentBaseline() || options.lpcOrder === 12)) {
      captureExperimentBaseline(`Before: LPC Order p = ${options.lpcOrder}`);
    }
    updateOptions({ lpcOrder: order });
  };

  const applyPitchExperiment = (f0Hz: number) => {
    if (!labRuntime.getExperimentBaseline()) {
      captureExperimentBaseline(`Before: Pitch F0 = ${Math.round(synth.f0Hz)} Hz`);
    }
    updateSynth({ f0Hz, tour: false });
  };

  const applyPolePreset = (formant: 1 | 2, radius: number, freqHz: number, label: string) => {
    if (!labRuntime.getExperimentBaseline()) {
      captureExperimentBaseline(label);
    }
    setSelectedPole(formant);
    const theta = (2 * Math.PI * freqHz) / 12000;
    labRuntime.setPoleOverride(formant, radius * Math.cos(theta), radius * Math.sin(theta));
    useLabStore.setState({ baselineVersion: useLabStore.getState().baselineVersion + 1 });
  };

  const stepExperiment = (delta: number) => {
    const next = (((activeExperiment - 1 + delta + 5) % 5) + 1) as ExperimentId;
    setActiveExperiment(next);
  };

  const nearLive = live.formants.f1 > 0 ? nearestVowel(live.formants.f1, live.formants.f2) : null;
  const nearBase = baseSnap && baseSnap.f1 > 0 ? nearestVowel(baseSnap.f1, baseSnap.f2) : null;

  // Determine regime badge for Experiment 03
  const lpcOrder = options.lpcOrder;
  const lpcRegime =
    lpcOrder < 8
      ? { badge: "UNDERFITTING — Formants Merge", color: "bg-accent text-accent-ink" }
      : lpcOrder <= 14
        ? { badge: "OPTIMAL — True Vocal Tract Envelope", color: "bg-lock text-accent-ink" }
        : lpcOrder <= 18
          ? { badge: "HIGH ORDER — Extra Formant / Ripple", color: "bg-lpc text-accent-ink" }
          : { badge: "OVERFITTING — Chasing Pitch Harmonics", color: "bg-accent text-accent-ink" };

  const liveT0Ms = live.stability.f0Hz > 0 ? 1000 / live.stability.f0Hz : 0;
  const baseT0Ms = baseSnap && baseSnap.f0Hz > 0 ? 1000 / baseSnap.f0Hz : liveT0Ms;

  return (
    <section
      aria-label="Break the Signal — 5 Interactive DSP Classroom Experiments"
      className="ui-panel mb-4 border border-accent/60 bg-surface"
    >
      {/* Top Experiment Navigation Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mark bg-accent!" aria-hidden />
          <h2 className="text-[13px] font-semibold text-ink">
            Break the Signal — 5 Classroom Experiments
          </h2>
          <div role="tablist" aria-label="Choose DSP Experiment" className="flex flex-wrap items-center gap-1">
            {EXPERIMENTS_META.map((exp) => {
              const active = exp.id === activeExperiment;
              return (
                <button
                  key={exp.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveExperiment(exp.id)}
                  className={`px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                    active
                      ? "bg-accent text-accent-ink"
                      : "bg-raised text-muted hover:text-ink"
                  }`}
                >
                  0{exp.id} · {exp.stageTag.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => stepExperiment(-1)}
            className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-medium rounded-(--radius-sm)"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={() => resetExperiment(activeExperiment)}
            className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-semibold text-accent rounded-(--radius-sm)"
          >
            Reset Experiment
          </button>
          <button
            type="button"
            onClick={() => stepExperiment(1)}
            className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-medium rounded-(--radius-sm)"
          >
            Next Experiment →
          </button>
          <button
            type="button"
            onClick={() => setLabMode("workspace")}
            className="ui-tab min-h-8 px-2 text-[12px] font-medium text-muted hover:text-ink"
          >
            Exit to Full Lab ✕
          </button>
        </div>
      </header>

      {/* Live CAUSE -> EFFECT Propagation Ribbon */}
      <div
        aria-label="Cause to Effect Signal Propagation Strip"
        className="border-b border-line bg-raised/60 px-3 py-2 text-[12px] rounded-(--radius-sm)"
      >
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-accent">
            Live Cause ➔ Effect Propagation Across Downstream Stages
          </span>
          <span className="ui-fig text-muted">
            {baseSnap
              ? `Comparing live signal against baseline (${baseSnap.label}) — dashed curve shows BEFORE`
              : "Click a [ ✕ BREAK IT ] control below to lock a BEFORE baseline and measure downstream deltas"}
          </span>
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5">
          <div className="flex-none border border-accent bg-accent/15 px-2 py-1 rounded-(--radius-sm)">
            <div className="font-semibold text-accent">1. You change</div>
            <div className="ui-fig text-ink">{meta.stageTag}</div>
          </div>
          <span className="text-muted" aria-hidden>➔</span>

          <div
            className={`flex-none border px-2 py-1 rounded-(--radius-sm) ${
              baseSnap && (Math.abs(deltaLeakageDb) > 1 || Math.abs(deltaTiltDb) > 1 || Math.abs(dF0) > 2)
                ? "border-accent/80 bg-surface text-ink"
                : "border-line bg-surface/60 text-muted"
            }`}
          >
            <div className="font-semibold">2. Spectrum</div>
            <div className="ui-fig">
              {activeExperiment === 1
                ? `Leakage ${fmtSigned(deltaLeakageDb, 1, "dB")}`
                : activeExperiment === 2
                  ? `High/Low Tilt ${fmtSigned(deltaTiltDb, 1, "dB")}`
                  : `Δf = ${Math.round(live.stability.f0Hz)} Hz`}
            </div>
          </div>
          <span className="text-muted" aria-hidden>➔</span>

          <div
            className={`flex-none border px-2 py-1 rounded-(--radius-sm) ${
              baseSnap && (activeExperiment === 3 || activeExperiment === 5 || Math.abs(dF1) > 2 || Math.abs(dF2) > 2)
                ? "border-lpc/80 bg-surface text-ink"
                : "border-line bg-surface/60 text-muted"
            }`}
          >
            <div className="font-semibold">3. Envelope</div>
            <div className="ui-fig">
              LPC({options.lpcOrder}) · {options.lpcOrder / 2} pole pairs
            </div>
          </div>
          <span className="text-muted" aria-hidden>➔</span>

          <div
            className={`flex-none border px-2 py-1 rounded-(--radius-sm) ${
              baseSnap && (Math.abs(dF1) >= 2 || Math.abs(dF2) >= 2)
                ? "border-accent bg-surface text-ink"
                : "border-line bg-surface/60 text-muted"
            }`}
          >
            <div className="font-semibold">4. Formants</div>
            <div className="ui-fig">
              {baseSnap
                ? `ΔF1 ${fmtSigned(dF1, 0, "Hz")} · ΔF2 ${fmtSigned(dF2, 0, "Hz")}`
                : `F1 ${Math.round(live.formants.f1)} · F2 ${Math.round(live.formants.f2)} Hz`}
            </div>
          </div>
          <span className="text-muted" aria-hidden>➔</span>

          <div
            className={`flex-none border px-2 py-1 rounded-(--radius-sm) ${
              baseSnap && (Math.abs(dF1) >= 8 || Math.abs(dF2) >= 12)
                ? "border-accent bg-surface text-ink"
                : "border-line bg-surface/60 text-muted"
            }`}
          >
            <div className="font-semibold">5. Vowel position</div>
            <div className="ui-fig">
              {nearBase && nearLive && baseSnap
                ? `${vowelGlyph(nearBase)} /${nearBase.symbol}/ → ${vowelGlyph(nearLive)} /${nearLive.symbol}/`
                : nearLive
                  ? `Nearest ${vowelGlyph(nearLive)} /${nearLive.symbol}/`
                  : "Waiting for voice"}
            </div>
          </div>
          <span className="text-muted" aria-hidden>➔</span>

          <div
            className={`flex-none border px-2 py-1 rounded-(--radius-sm) ${
              baseSnap && (Math.abs(liveModes.m - baseModes.m) >= 0.05 || Math.abs(liveModes.n - baseModes.n) >= 0.05)
                ? "border-accent bg-surface text-ink"
                : "border-line bg-surface/60 text-muted"
            }`}
          >
            <div className="font-semibold">6. Figure</div>
            <div className="ui-fig">
              {baseSnap
                ? `(${baseModes.m.toFixed(1)}, ${baseModes.n.toFixed(1)}) → (${liveModes.m.toFixed(1)}, ${liveModes.n.toFixed(1)})`
                : `Modes (${liveModes.m.toFixed(2)}, ${liveModes.n.toFixed(2)})`}
            </div>
          </div>
        </div>
      </div>

      {/* Main Experiment Card Header: 1. GOAL + 2. INTERACTIVE CONTROLS */}
      <div className="border-b border-line p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-accent px-2 py-0.5 text-[12px] font-bold text-accent-ink">
                {meta.code}
              </span>
              <span className="text-[12px] font-semibold text-muted">
                {meta.stageTag}
              </span>
            </div>
            <h3 className="text-[18px] font-semibold tracking-tight text-ink">
              {meta.title}
            </h3>
            <p className="text-[13px] text-ink">
              <strong className="font-semibold text-accent">Goal: </strong>
              {meta.goal}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => captureExperimentBaseline(`Manual Snapshot (${meta.code})`)}
              className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-medium rounded-(--radius-sm)"
              title="Lock current telemetry as the BEFORE reference curve"
            >
              Snapshot BEFORE
            </button>
            <button
              type="button"
              aria-pressed={frozen}
              onClick={toggleFreeze}
              className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-medium rounded-(--radius-sm)"
            >
              {frozen ? "Resume Live Stream" : "Freeze Frame"}
            </button>
          </div>
        </div>

        {/* Experiment-Specific Interactive Control Strip */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-line bg-raised/50 p-3 rounded-(--radius-sm)">
          {activeExperiment === 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[12px] font-semibold text-muted">
                Window Function w[n]:
              </span>
              {(["hamming", "hann", "blackman"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={options.windowType === w}
                  onClick={() => applyWindowExperiment(w)}
                  className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    options.windowType === w
                      ? "bg-lock text-accent-ink"
                      : "border border-line bg-surface text-ink hover:border-accent"
                  }`}
                >
                  [ {WINDOW_INFO[w].label} {w === "hamming" ? "(Default)" : ""} ]
                </button>
              ))}
              <button
                type="button"
                aria-pressed={options.windowType === "rectangular"}
                onClick={() => applyWindowExperiment("rectangular")}
                className={`px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                  options.windowType === "rectangular"
                    ? "bg-accent text-accent-ink ring-2 ring-accent/50"
                    : "border border-accent bg-accent/15 text-accent hover:bg-accent hover:text-accent-ink"
                }`}
              >
                [ ✕ BREAK WINDOWING (Rectangular w[n] = 1) ]
              </button>
            </div>
          )}

          {activeExperiment === 2 && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="mr-1 text-[12px] font-semibold text-muted">
                Pre-Emphasis Filter H(z) = 1 − α·z⁻¹:
              </span>
              <button
                type="button"
                aria-pressed={options.preEmphasis > 0}
                onClick={() => applyPreEmphasisExperiment(0.97)}
                className={`px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                  options.preEmphasis > 0
                    ? "bg-lock text-accent-ink"
                    : "border border-line bg-surface text-ink hover:border-accent"
                }`}
              >
                [ ✓ Pre-Emphasis ON (α = 0.97, +6 dB/oct Boost) ]
              </button>
              <button
                type="button"
                aria-pressed={options.preEmphasis === 0}
                onClick={() => applyPreEmphasisExperiment(0)}
                className={`px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                  options.preEmphasis === 0
                    ? "bg-accent text-accent-ink ring-2 ring-accent/50"
                    : "border border-accent bg-accent/15 text-accent hover:bg-accent hover:text-accent-ink"
                }`}
              >
                [ ✕ BREAK PRE-EMPHASIS (OFF, α = 0) ]
              </button>
            </div>
          )}

          {activeExperiment === 3 && (
            <div className="flex w-full flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={options.lpcOrder === 4}
                  onClick={() => applyLpcOrderExperiment(4)}
                  className={`px-3 py-1.5 text-[12px] font-bold transition-colors ${
                    options.lpcOrder === 4
                      ? "bg-accent text-accent-ink"
                      : "border border-accent bg-accent/15 text-accent hover:bg-accent hover:text-accent-ink"
                  }`}
                >
                  [ ✕ p = 4 (Underfit — Too Smooth) ]
                </button>
                <button
                  type="button"
                  aria-pressed={options.lpcOrder === 12}
                  onClick={() => applyLpcOrderExperiment(12)}
                  className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    options.lpcOrder === 12
                      ? "bg-lock text-accent-ink"
                      : "border border-line bg-surface text-ink hover:border-accent"
                  }`}
                >
                  [ ✓ p = 12 (Optimal Vocal Tract) ]
                </button>
                <button
                  type="button"
                  aria-pressed={options.lpcOrder === 24}
                  onClick={() => applyLpcOrderExperiment(24)}
                  className={`px-3 py-1.5 text-[12px] font-bold transition-colors ${
                    options.lpcOrder === 24
                      ? "bg-accent text-accent-ink"
                      : "border border-accent bg-accent/15 text-accent hover:bg-accent hover:text-accent-ink"
                  }`}
                >
                  [ ✕ p = 24 (Overfit — Chasing Harmonics) ]
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium text-muted">Sweep Order p:</span>
                  <input
                    type="range"
                    min={4}
                    max={24}
                    step={2}
                    value={options.lpcOrder}
                    onChange={(e) => applyLpcOrderExperiment(Number(e.target.value))}
                    className="ui-slider w-36"
                  />
                  <span className="ui-fig min-w-[7ch] font-bold text-ink">{options.lpcOrder} poles</span>
                </label>
                <span className={`px-2.5 py-1 text-[12px] font-bold ${lpcRegime.color}`}>
                  {lpcRegime.badge}
                </span>
              </div>
            </div>
          )}

          {activeExperiment === 4 && (
            <div className="flex w-full flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[12px] font-semibold text-muted">
                  Glottal Pitch F0:
                </span>
                {[
                  { hz: 110, label: "110 Hz Low (Dense Harmonics)" },
                  { hz: 165, label: "165 Hz Mid" },
                  { hz: 280, label: "✕ 280 Hz High (Sparse Comb)" },
                ].map((preset) => (
                  <button
                    key={preset.hz}
                    type="button"
                    disabled={sourceMode === "mic" || sourceMode === "stream"}
                    aria-pressed={Math.abs(synth.f0Hz - preset.hz) < 4}
                    onClick={() => applyPitchExperiment(preset.hz)}
                    className={`px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
                      Math.abs(synth.f0Hz - preset.hz) < 4
                        ? preset.hz >= 250
                          ? "bg-accent text-accent-ink"
                          : "bg-lock text-accent-ink"
                        : "border border-line bg-surface text-ink hover:border-accent"
                    }`}
                  >
                    [ {preset.label} ]
                  </button>
                ))}
                {(sourceMode === "mic" || sourceMode === "stream") && (
                  <button
                    type="button"
                    onClick={() => void setSourceMode("synth")}
                    className="border border-accent bg-accent/15 px-2.5 py-1 text-[12px] font-semibold text-accent rounded-(--radius-sm)"
                  >
                    Switch to Synth Voice for F0 Slider
                  </button>
                )}
              </div>

              <label className="flex items-center gap-2.5 text-[12px]">
                <span className="font-medium text-muted">Sweep F0 (60–400 Hz):</span>
                <input
                  type="range"
                  min={60}
                  max={400}
                  step={1}
                  disabled={sourceMode === "mic" || sourceMode === "stream"}
                  value={synth.f0Hz}
                  onChange={(e) => applyPitchExperiment(Number(e.target.value))}
                  className="ui-slider w-40"
                />
                <span className="ui-fig min-w-[6ch] font-bold text-ink">{Math.round(synth.f0Hz)} Hz</span>
              </label>
            </div>
          )}

          {activeExperiment === 5 && (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-muted">
                  Active Pole Handle:
                </span>
                <button
                  type="button"
                  aria-pressed={selectedPole === 1}
                  onClick={() => setSelectedPole(1)}
                  className={`px-2.5 py-1 text-[12px] font-semibold ${
                    selectedPole === 1 ? "bg-lpc text-accent-ink" : "border border-line bg-surface text-ink"
                  }`}
                >
                  [ F1 Pole ✥ (Jaw Height) ]
                </button>
                <button
                  type="button"
                  aria-pressed={selectedPole === 2}
                  onClick={() => setSelectedPole(2)}
                  className={`px-2.5 py-1 text-[12px] font-semibold ${
                    selectedPole === 2 ? "bg-lpc text-accent-ink" : "border border-line bg-surface text-ink"
                  }`}
                >
                  [ F2 Pole ✥ (Tongue Frontness) ]
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    applyPolePreset(
                      selectedPole,
                      0.99,
                      selectedPole === 1 ? (live.formants.f1 || 730) : (live.formants.f2 || 1180),
                      "Before: Natural Pole Damping",
                    )
                  }
                  className="border border-accent bg-accent/15 px-2.5 py-1 text-[12px] font-semibold text-accent hover:bg-accent hover:text-accent-ink rounded-(--radius-sm)"
                >
                  [ ✕ Push Near Unit Circle (r = 0.99 · Laser Peak) ]
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPolePreset(
                      selectedPole,
                      0.72,
                      selectedPole === 1 ? (live.formants.f1 || 730) : (live.formants.f2 || 1180),
                      "Before: Natural Pole Damping",
                    )
                  }
                  className="border border-accent bg-accent/15 px-2.5 py-1 text-[12px] font-semibold text-accent hover:bg-accent hover:text-accent-ink rounded-(--radius-sm)"
                >
                  [ ✕ Pull Toward Origin (r = 0.72 · Flat Damped Blob) ]
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!labRuntime.getExperimentBaseline()) {
                      captureExperimentBaseline("Before: /ɑː/ (আ) Pole Angles");
                    }
                    const theta1 = (2 * Math.PI * 300) / 12000;
                    const theta2 = (2 * Math.PI * 2250) / 12000;
                    labRuntime.setPoleOverride(1, 0.95 * Math.cos(theta1), 0.95 * Math.sin(theta1));
                    labRuntime.setPoleOverride(2, 0.93 * Math.cos(theta2), 0.93 * Math.sin(theta2));
                    useLabStore.setState({ baselineVersion: useLabStore.getState().baselineVersion + 1 });
                  }}
                  className="border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink hover:border-accent rounded-(--radius-sm)"
                >
                  [ Rotate θ to /iː/ (ই) Formants ]
                </button>
                {labRuntime.hasPoleOverrides() && (
                  <button
                    type="button"
                    onClick={() => resetExperiment(5)}
                    className="bg-accent px-2.5 py-1 text-[12px] font-bold text-accent-ink"
                  >
                    [ Restore Natural Poles ]
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. SYNCHRONIZED LIVE VISUALIZATION GRID */}
      <div className="grid grid-cols-12 border-b border-line">
        {activeExperiment === 1 && (
          <>
            <div className="col-span-12 flex flex-col border-b border-line lg:col-span-5 lg:border-r lg:border-b-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="measured">Time-Domain Window Taper xw[n] = x[n] · w[n]</Prov>
                </span>
                <span className="text-[12px] text-muted">
                  Active: {WINDOW_INFO[options.windowType].label} (dashed = BEFORE)
                </span>
              </div>
              <Trace
                kind="scope"
                compareBaseline
                label="Time-domain frame before and after windowing"
                className="h-[250px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col lg:col-span-7">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">FFT Spectrum, Sidelobe Leakage &amp; LPC Envelope</Prov>
                </span>
                <span className="text-[12px] text-muted">
                  Dashed ghost = Baseline · Solid = Live {WINDOW_INFO[options.windowType].label}
                </span>
              </div>
              <Trace
                kind="spectrum"
                inspect
                compareBaseline
                label="FFT magnitude spectrum and LPC envelope with baseline ghost overlay"
                className="h-[250px] w-full"
              />
            </div>
          </>
        )}

        {activeExperiment === 2 && (
          <>
            <div className="col-span-12 flex flex-col border-b border-line lg:col-span-7 lg:border-r lg:border-b-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">Spectral Tilt &amp; Formant Peaks (α = {options.preEmphasis.toFixed(2)})</Prov>
                </span>
                <span className="text-[12px] text-muted">
                  Watch 1.5–4.5 kHz high-band energy &amp; F2/F3 peaks vs dashed baseline
                </span>
              </div>
              <Trace
                kind="spectrum"
                inspect
                compareBaseline
                label="Spectrum and LPC formants showing pre-emphasis tilt effect"
                className="h-[250px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col lg:col-span-5">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">Z-Plane Pole Distribution</Prov>
                </span>
                <span className="text-[12px] text-muted">
                  Faint rings = Baseline poles · Crosses = Live poles
                </span>
              </div>
              <Trace
                kind="zplane"
                inspect
                compareBaseline
                label="Z-plane poles with and without pre-emphasis"
                className="h-[250px] w-full"
              />
            </div>
          </>
        )}

        {activeExperiment === 3 && (
          <>
            <div className="col-span-12 flex flex-col border-b border-line lg:col-span-7 lg:border-r lg:border-b-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">All-Pole LPC({options.lpcOrder}) Envelope vs. FFT Harmonic Comb</Prov>
                </span>
                <span className="text-[12px] text-muted">
                  p = 4 merges F1/F2 · p = 12 fits vocal tract · p = 24 chases harmonics
                </span>
              </div>
              <Trace
                kind="spectrum"
                inspect
                compareBaseline
                label="LPC envelope for selected model order p over FFT spectrum"
                className="h-[250px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col lg:col-span-5">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">Z-Plane Roots ({options.lpcOrder} Poles = {options.lpcOrder / 2} Conjugate Pairs)</Prov>
                </span>
                <span className="text-[12px] text-muted">
                  Each upper-half-plane root pair can create 1 spectral peak
                </span>
              </div>
              <Trace
                kind="zplane"
                inspect
                compareBaseline
                label="Z-plane showing p poles inside unit circle"
                className="h-[250px] w-full"
              />
            </div>
          </>
        )}

        {activeExperiment === 4 && (
          <>
            <div className="col-span-12 flex flex-col border-b border-line lg:col-span-5 lg:border-r lg:border-b-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="measured">Time-Domain Glottal Period T0 = 1 / F0</Prov>
                </span>
                <span className="ui-fig text-[12px] text-ink">
                  F0 = {Math.round(live.stability.f0Hz)} Hz ➔ T0 = {liveT0Ms.toFixed(2)} ms
                </span>
              </div>
              <Trace
                kind="pitch"
                label="Time-domain wave with pitch period markers T0"
                className="h-[250px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col lg:col-span-7">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">Harmonic Comb Spacing Δf = F0 Under Fixed Vocal Tract Envelope</Prov>
                </span>
                <span className="ui-fig text-[12px] text-ink">
                  Harmonics at {Math.round(live.stability.f0Hz)}, {Math.round(live.stability.f0Hz * 2)}, {Math.round(live.stability.f0Hz * 3)} Hz
                </span>
              </div>
              <Trace
                kind="fftHarmonics"
                inspect
                compareBaseline
                label="FFT harmonic comb with ▲ k·F0 markers"
                className="h-[250px] w-full"
              />
            </div>
          </>
        )}

        {activeExperiment === 5 && (
          <>
            <div className="col-span-12 flex flex-col border-b border-line md:col-span-6 lg:col-span-3 lg:border-r lg:border-b-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">1. Drag Poles in Z-Plane</Prov>
                </span>
                <span className="text-[12px] text-accent">Drag ● F1 / F2 or ↑↓←→</span>
              </div>
              <Trace
                kind="zplane"
                inspect
                compareBaseline
                draggablePoles
                selectedPoleFormant={selectedPole}
                onPoleSelect={setSelectedPole}
                label="Interactive Z-plane: drag F1 or F2 poles directly or use arrow keys"
                className="h-[260px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col border-b border-line md:col-span-6 lg:col-span-4 lg:border-r lg:border-b-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">2. Re-Evaluated LPC Envelope H(e^jω)</Prov>
                </span>
                <span className="text-[12px] text-muted">Dashed = Baseline</span>
              </div>
              <Trace
                kind="spectrum"
                inspect
                compareBaseline
                label="Live LPC envelope recomputed from dragged Z-plane pole"
                className="h-[260px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col border-b border-line md:col-span-6 md:border-b-0 lg:col-span-2 lg:border-r">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="derived">3. Vowel Space</Prov>
                </span>
                <span className="text-[12px] text-muted">(F1, F2)</span>
              </div>
              <Trace
                kind="vowel"
                bare
                compareBaseline
                onPick={(id) => selectTarget(id, sourceMode !== "mic" && sourceMode !== "stream")}
                label="Vowel space position shifting as poles move"
                className="h-[260px] w-full"
              />
            </div>

            <div className="col-span-12 flex flex-col md:col-span-6 lg:col-span-3">
              <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5 rounded-(--radius-sm)">
                <span className="text-[12px] font-semibold text-ink">
                  <Prov kind="mapped">4. 3D Chladni Figure</Prov>
                </span>
                <span className="ui-fig text-[12px] text-ink">
                  ({liveModes.m.toFixed(2)}, {liveModes.n.toFixed(2)})
                </span>
              </div>
              <PlateStage interactive showNodalLines={nodal} className="h-[260px] w-full" />
            </div>
          </>
        )}
      </div>

      {/* 4. WHAT CHANGED (BEFORE -> AFTER Live Measured Telemetry Diff) + 5. WHY IT HAPPENED */}
      <div className="grid grid-cols-12 gap-4 p-3.5 text-[12px]">
        {/* Left 7 columns: WHAT CHANGED (BEFORE -> AFTER table & meters) */}
        <div className="col-span-12 lg:col-span-7">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold text-accent">
              4. What Changed — Live Measured BEFORE ➔ AFTER Telemetry Diff
            </span>
            <span className="ui-fig text-[12px] text-muted">
              {baseSnap ? `Baseline: ${baseSnap.label}` : "Baseline: Current Live Frame"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {activeExperiment === 1 && (
              <>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Inter-Harmonic Sidelobe Floor</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {baseLeakageDb.toFixed(1)} dB ➔ {liveLeakageDb.toFixed(1)} dB
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    Δ Leakage: {fmtSigned(deltaLeakageDb, 1, "dB")} (Peak sidelobe {WINDOW_INFO[options.windowType].peakSidelobeDb.toFixed(1)} dB)
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Formant F1 Shift</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {Math.round(baseSnap?.f1 ?? live.formants.f1)} Hz ➔ {Math.round(live.formants.f1)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    ΔF1: {fmtSigned(dF1, 0, "Hz")} · B1 {Math.round(live.formants.b1)} Hz
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Formant F2 Shift</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {Math.round(baseSnap?.f2 ?? live.formants.f2)} Hz ➔ {Math.round(live.formants.f2)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    ΔF2: {fmtSigned(dF2, 0, "Hz")} · Modes ({liveModes.m.toFixed(2)}, {liveModes.n.toFixed(2)})
                  </div>
                </div>
              </>
            )}

            {activeExperiment === 2 && (
              <>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">High-Band vs Low-Band Tilt</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {baseTiltDb.toFixed(1)} dB ➔ {liveTiltDb.toFixed(1)} dB
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    Δ High/Low Ratio: {fmtSigned(deltaTiltDb, 1, "dB")} (1.5–4.5 kHz vs 0.1–1 kHz)
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">F2 Resonance &amp; Bandwidth</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {Math.round(baseSnap?.f2 ?? live.formants.f2)} Hz ➔ {Math.round(live.formants.f2)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    B2: {Math.round(baseSnap?.b2 ?? live.formants.b2)} Hz ➔ {Math.round(live.formants.b2)} Hz ({fmtSigned(dB2, 0, "Hz")})
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">F3 High Formant &amp; Confidence</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {Math.round(baseSnap?.f3 ?? live.formants.f3)} Hz ➔ {Math.round(live.formants.f3)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    ΔF3: {fmtSigned(dF3, 0, "Hz")} · Lock Confidence {Math.round(live.formants.confidence * 100)}%
                  </div>
                </div>
              </>
            )}

            {activeExperiment === 3 && (
              <>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Pole Budget vs. Vocal Tract</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    p = {options.lpcOrder} ({options.lpcOrder / 2} conjugate pairs)
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    {lpcRegime.badge}
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Extracted F1 &amp; F2 Peaks</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    F1 {Math.round(live.formants.f1)} Hz · F2 {Math.round(live.formants.f2)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    ΔF1 {fmtSigned(dF1, 0, "Hz")} · ΔF2 {fmtSigned(dF2, 0, "Hz")} vs baseline
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Bandwidth Sharpness (B1 / B2)</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    B1 {Math.round(live.formants.b1)} Hz · B2 {Math.round(live.formants.b2)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    {options.lpcOrder >= 20
                      ? "Narrowed onto glottal harmonics k·F0"
                      : options.lpcOrder <= 6
                        ? "Broadened across merged resonances"
                        : "Matched to true vocal-tract cavities"}
                  </div>
                </div>
              </>
            )}

            {activeExperiment === 4 && (
              <>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Time Period T0 = 1000 / F0</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {baseT0Ms.toFixed(2)} ms ➔ {liveT0Ms.toFixed(2)} ms
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    {(12000 / Math.max(1, live.stability.f0Hz)).toFixed(1)} samples / cycle at 12 kHz
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Harmonic Comb Spacing Δf</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {Math.round(baseSnap?.f0Hz ?? live.stability.f0Hz)} Hz ➔ {Math.round(live.stability.f0Hz)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    ΔF0: {fmtSigned(dF0, 0, "Hz")} between adjacent FFT teeth
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Source–Filter Independence</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    F1 {Math.round(live.formants.f1)} Hz · F2 {Math.round(live.formants.f2)} Hz
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-lock">
                    Vowel {nearLive ? `${vowelGlyph(nearLive)} /${nearLive.symbol}/` : ""} envelope stays anchored!
                  </div>
                </div>
              </>
            )}

            {activeExperiment === 5 && (
              <>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">
                    Dragged F{selectedPole} Pole Radius r = |z|
                  </div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {basePoleRadius.toFixed(3)} ➔ {(activePole?.magnitude ?? 0).toFixed(3)}
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    BW B{selectedPole}: {Math.round(selectedPole === 1 ? (baseSnap?.b1 ?? live.formants.b1) : (baseSnap?.b2 ?? live.formants.b2))} Hz ➔{" "}
                    {Math.round(selectedPole === 1 ? live.formants.b1 : live.formants.b2)} Hz
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">
                    Pole Angle θ ➔ Formant F{selectedPole}
                  </div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {(basePoleAngle / Math.PI).toFixed(3)}π ➔ {((activePole?.angleRad ?? 0) / Math.PI).toFixed(3)}π rad
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    F{selectedPole}: {Math.round(selectedPole === 1 ? (baseSnap?.f1 ?? live.formants.f1) : (baseSnap?.f2 ?? live.formants.f2))} Hz ➔{" "}
                    {Math.round(selectedPole === 1 ? live.formants.f1 : live.formants.f2)} Hz
                  </div>
                </div>
                <div className="border border-line bg-raised p-2.5 rounded-(--radius-sm)">
                  <div className="text-[12px] text-muted">Downstream Vowel &amp; Plate Modes</div>
                  <div className="ui-fig mt-1 text-[14px] font-semibold text-ink">
                    {nearLive ? `${vowelGlyph(nearLive)} /${nearLive.symbol}/` : "—"} · m {liveModes.m.toFixed(2)}, n {liveModes.n.toFixed(2)}
                  </div>
                  <div className="ui-fig mt-0.5 text-[12px] text-accent">
                    ΔF1 {fmtSigned(dF1, 0, "Hz")} · ΔF2 {fmtSigned(dF2, 0, "Hz")}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right 5 columns: 5. WHY IT HAPPENED (Mathematical intuition + formula) */}
        <div className="col-span-12 flex flex-col justify-between border border-line bg-raised/40 p-3 lg:col-span-5 rounded-(--radius-sm)">
          <div>
            <div className="mb-1 text-[12px] font-bold text-accent">
              5. Why It Happened — Mathematical Intuition
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink">
              {meta.why}
            </p>
          </div>
          <div className="ui-fig mt-2.5 border-t border-line pt-2 text-[11.5px] text-lpc">
            {meta.formula}
          </div>
        </div>
      </div>
    </section>
  );
}
