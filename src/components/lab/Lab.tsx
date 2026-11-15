"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Prov, SourceSwitch, VowelKeys, type Provenance } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import type { TraceKind } from "@/components/instrument/draw";
import { findVowel, nearestVowel, VOWEL_TARGETS, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";
import { labRuntime, useLabStore, type LabView, type TraceStageId } from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";

const VIEWS: { view: LabView; label: string }[] = [
  { view: "all", label: "All" },
  { view: "vowel", label: "Vowel chart" },
  { view: "figure", label: "Figure" },
  { view: "spectrum", label: "Spectrum" },
  { view: "poles", label: "Poles" },
  { view: "scope", label: "Scope" },
];

const READINGS: {
  kind: Provenance;
  rows: { label: string; field: ReadoutField; unit?: string; extra?: { field: ReadoutField; unit?: string }; bangla?: boolean }[];
}[] = [
  {
    kind: "measured",
    rows: [
      { label: "Pitch, F0", field: "f0", unit: "Hz", extra: { field: "note" } },
      { label: "Period", field: "period", unit: "ms" },
      { label: "Pitch clarity", field: "clarity" },
      { label: "Level", field: "level", unit: "dB FS" },
      { label: "Jitter", field: "jitter", unit: "%" },
      { label: "Shimmer", field: "shimmer", unit: "dB" },
      { label: "Syllables", field: "syllables", unit: "per s" },
    ],
  },
  {
    kind: "derived",
    rows: [
      { label: "F1", field: "f1", unit: "Hz", extra: { field: "b1", unit: "wide" } },
      { label: "F2", field: "f2", unit: "Hz", extra: { field: "b2", unit: "wide" } },
      { label: "F3", field: "f3", unit: "Hz", extra: { field: "b3", unit: "wide" } },
      { label: "Nearest vowel", field: "vowel", bangla: true },
      { label: "From target", field: "bark", unit: "Bark" },
      { label: "Match", field: "score", unit: "of 100" },
    ],
  },
  {
    kind: "mapped",
    rows: [
      { label: "Plate mode m", field: "modeM" },
      { label: "Plate mode n", field: "modeN" },
    ],
  },
];

function Panel({
  view,
  title,
  kind,
  tools,
  className,
  children,
}: {
  view: LabView;
  title: string;
  kind: Provenance;
  tools?: ReactNode;
  className: string;
  children: ReactNode;
}) {
  const active = useLabStore((s) => s.activeView);
  if (active !== "all" && active !== view) return null;
  return (
    <section className={`ui-panel flex min-w-0 flex-col ${active === "all" ? className : "col-span-12"}`}>
      <header className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 border-b border-line px-3">
        <h2 className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
          <Prov kind={kind}>{title}</Prov>
        </h2>
        {tools}
      </header>
      {children}
    </section>
  );
}

/** A slider that shows its value at once but re-renders the voice at most every 70 ms. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [shown, setShown] = useState(value);
  const [synced, setSynced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(value);
  // Follow the store when it changes from elsewhere (Reset, a vowel key), but not our own
  // commits: those arrive late, while the thumb has already moved on.
  if (value !== synced) {
    setSynced(value);
    setShown(value);
  }
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <label className="block py-1.5">
      <span className="flex items-baseline justify-between gap-4">
        <span className="ui-label">{label}</span>
        <span className="ui-fig text-[12px] text-ink">{format(shown)}</span>
      </span>
      <input
        type="range"
        className="ui-slider"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          setShown(v);
          pending.current = v;
          if (!timer.current) {
            timer.current = setTimeout(() => {
              timer.current = null;
              setSynced(pending.current);
              onCommit(pending.current);
            }, 70);
          }
        }}
      />
    </label>
  );
}

function Readings() {
  return (
    <div className="px-3 py-2">
      {READINGS.map((group) => (
        <dl key={group.kind} className="mb-2.5 last:mb-0">
          {group.rows.map((row) => (
            <div key={row.field} className="flex min-h-7 items-center justify-between gap-4 lg:min-h-[26px]">
              <dt className="ui-label">
                <Prov kind={group.kind}>{row.label}</Prov>
              </dt>
              <dd className={`text-[13px] whitespace-nowrap text-ink ${row.bangla ? "bn text-[16px] leading-none" : "ui-fig"}`}>
                <Readout field={row.field} />
                {row.unit ? <span className="text-muted"> {row.unit}</span> : null}
                {row.extra ? (
                  <span className="text-muted">
                    {" · "}
                    <Readout field={row.extra.field} />
                    {row.extra.unit ? ` ${row.extra.unit}` : ""}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}

function VoiceControls() {
  const synth = useLabStore((s) => s.synth);
  const volume = useLabStore((s) => s.volume);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const micGain = useLabStore((s) => s.micGain);
  const setMicGain = useLabStore((s) => s.setMicGain);
  const liveInput = sourceMode === "mic" || sourceMode === "stream";
  const updateSynth = useLabStore((s) => s.updateSynth);
  const setVolume = useLabStore((s) => s.setVolume);
  return (
    <div className="px-3 py-2">
      {sourceMode === "mic" && (
        <Slider
          label="Microphone input boost"
          value={micGain}
          min={1}
          max={8}
          step={0.5}
          format={(v) => `× ${v.toFixed(1)}`}
          onCommit={setMicGain}
        />
      )}
      <Slider label="Pitch" value={synth.f0Hz} min={70} max={350} step={1} disabled={liveInput} format={(v) => `${v.toFixed(0)} Hz`} onCommit={(v) => updateSynth({ f0Hz: v })} />
      <Slider label="Formant shift (tract length)" value={synth.formantShift} min={0.8} max={1.25} step={0.01} disabled={liveInput} format={(v) => `× ${v.toFixed(2)}`} onCommit={(v) => updateSynth({ formantShift: v })} />
      <Slider label="Jitter put in" value={synth.jitterPercent} min={0} max={3} step={0.1} disabled={liveInput} format={(v) => `${v.toFixed(1)} %`} onCommit={(v) => updateSynth({ jitterPercent: v })} />
      <Slider label="Volume when played" value={volume} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onCommit={setVolume} />
      <p className="ui-label mt-2">
        {liveInput
          ? "These shape the synthetic voice. With a live microphone or tab stream active, the external audio stream is the source."
          : "The voice is a pulse train through three resonators. Its formants are known exactly, so you can check the readings against what you set."}
      </p>
    </div>
  );
}

function AnalysisControls() {
  const options = useLabStore((s) => s.analyzerOptions);
  const update = useLabStore((s) => s.updateAnalyzerOptions);
  const nodal = useLabStore((s) => s.showNodalLines);
  const setNodal = useLabStore((s) => s.setShowNodalLines);
  const info = WINDOW_INFO[options.windowType];
  return (
    <div className="px-3 py-2">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <span className="ui-label">Pre-emphasis 0.97</span>
        <button type="button" role="switch" aria-checked={options.preEmphasis > 0} className="ui-tab text-[13px] font-medium" onClick={() => update({ preEmphasis: options.preEmphasis > 0 ? 0 : 0.97 })}>
          {options.preEmphasis > 0 ? "On" : "Off"}
        </button>
      </div>
      <div className="flex min-h-9 items-center justify-between gap-4">
        <span className="ui-label">Nodal lines on the plate</span>
        <button type="button" role="switch" aria-checked={nodal} className="ui-tab text-[13px] font-medium" onClick={() => setNodal(!nodal)}>
          {nodal ? "Shown" : "Hidden"}
        </button>
      </div>
      <Slider label="Model order" value={options.lpcOrder} min={4} max={24} step={2} format={(v) => `${v} poles`} onCommit={(v) => update({ lpcOrder: v })} />
      <p className="ui-label mt-2">
        {info.label} window: {info.formula}. Highest sidelobe {info.peakSidelobeDb.toFixed(1)} dB, main lobe{" "}
        {info.mainLobeBins} bins. Change the window in the Scope panel.
      </p>
    </div>
  );
}

interface StageSpec {
  id: TraceStageId;
  pill: string;
  title: string;
  kind: Provenance;
  beforeTitle: string;
  beforeSub: string;
  beforeTrace: TraceKind;
  afterTitle: string;
  afterSub: string;
  afterTrace: TraceKind | "plate";
  bypassLabel?: string;
  why: string;
}

const TRACE_STAGES: readonly StageSpec[] = [
  {
    id: 1,
    pill: "1. VOICE PCM",
    title: "Stage 1 — Acoustic Pressure to 12 kHz Discrete PCM",
    kind: "measured",
    beforeTitle: "BEFORE · Continuous Incoming Waveform",
    beforeSub: "Raw buffer x(t) arriving from Web Audio AnalyserNode at native device rate",
    beforeTrace: "voice",
    afterTitle: "AFTER · Decimated 12 kHz Stems x[n]",
    afterSub: "512 discrete samples (42.7 ms window, Δt = 83.3 µs, Nyquist = 6 000 Hz)",
    afterTrace: "samples",
    why: "Decimating from 48 kHz to fs = 12 000 Hz concentrates all 512 samples and LPC poles inside 0–6 kHz, where human vowel formants F1–F3 actually live. Without decimation, a 12-pole LPC model wastes two-thirds of its degrees of freedom fitting empty air between 6 kHz and 24 kHz.",
  },
  {
    id: 2,
    pill: "2. PREP & PRE-EMPHASIS",
    title: "Stage 2 — DC Removal & First-Order Pre-Emphasis Filter",
    kind: "measured",
    beforeTitle: "BEFORE · Raw Decimated Slice rawDecimated[n]",
    beforeSub: "Steep −12 dB/octave glottal spectral tilt dominates high-frequency formants",
    beforeTrace: "rawDecimated",
    afterTitle: "AFTER · Pre-Emphasized y[n] = x[n] − α·x[n−1]",
    afterSub: "+6 dB/octave high-pass boost flattens glottal roll-off so F2 & F3 stand out",
    afterTrace: "preEmphasized",
    bypassLabel: "✕ BYPASS STAGE (α = 0)",
    why: "Human vocal fold vibration falls off at −12 dB/octave, leaving F2 and F3 up to 30 dB weaker than F1. If you bypass pre-emphasis (α = 0), Levinson–Durbin spends almost all its poles modeling the low-frequency glottal slope and F2/F3 collapse or vanish.",
  },
  {
    id: 3,
    pill: "3. WINDOW w[n]",
    title: "Stage 3 — Tapered Windowing xw[n] = y[n] · w[n]",
    kind: "measured",
    beforeTitle: "BEFORE · Unwindowed Pre-Emphasized y[n]",
    beforeSub: "Sharp boundary cliffs at n = 0 and n = 511 act like an impulse step",
    beforeTrace: "preEmphasized",
    afterTitle: "AFTER · Windowed Frame xw[n] = y[n] · w[n]",
    afterSub: "Smooth bell taper brings both frame edges to zero before FFT & autocorrelation",
    afterTrace: "windowed",
    bypassLabel: "✕ BYPASS STAGE (Rectangular)",
    why: "Slicing 512 samples out of a continuous voice wave leaves abrupt discontinuities at n = 0 and n = 511. If you bypass tapered windowing (Rectangular w[n] = 1), those sharp edges spray −13 dB spectral leakage across the entire spectrum and bias autocorrelation lags.",
  },
  {
    id: 4,
    pill: "4. 1024-pt FFT",
    title: "Stage 4 — Zero-Padded 1024-Point Radix-2 Cooley–Tukey FFT",
    kind: "measured",
    beforeTitle: "BEFORE · Windowed Time-Domain Slice xw[n]",
    beforeSub: "512 tapered samples padded with 512 trailing zeros (N = 1024)",
    beforeTrace: "windowed",
    afterTitle: "AFTER · Log-Power Spectrum |X[k]| dB & Harmonics",
    afterSub: "512 bins from 0 to 6 kHz (Δf = 11.72 Hz/bin) with glottal harmonic peaks ▲ k·F0",
    afterTrace: "fftHarmonics",
    why: "The 1024-point FFT decomposes the time wave into a fine comb of glottal harmonics spaced every F0 Hz. However, the FFT alone cannot directly give you formants—picking the tallest FFT bin picks a pitch harmonic k·F0 rather than the vocal tract resonance center.",
  },
  {
    id: 5,
    pill: "5. PITCH / F0 (NSDF)",
    title: "Stage 5 — McLeod Normalized Square Difference Function (NSDF)",
    kind: "measured",
    beforeTitle: "BEFORE · Periodic Glottal Cycles in Time Domain",
    beforeSub: "Repeating vocal-fold pitch periods T0 = 1 / F0 across the 42.7 ms frame",
    beforeTrace: "pitch",
    afterTitle: "AFTER · NSDF Curve n(τ) & Parabolic Peak τ_peak",
    afterSub: "First major peak above 0.9·n_max pins fundamental period τ_peak → F0 = fs / τ_peak",
    afterTrace: "nsdf",
    why: "Time-domain zero-crossing counters fail whenever strong formants create multiple crossings per period. McLeod's NSDF normalizes autocorrelation energy at every lag τ ∈ [0, 255] into [−1, +1] and uses parabolic interpolation to lock onto F0 with sub-sample precision.",
  },
  {
    id: 6,
    pill: "6. LPC(p) ENVELOPE",
    title: "Stage 6 — Autocorrelation & Levinson–Durbin All-Pole Envelope",
    kind: "derived",
    beforeTitle: "BEFORE · Jagged FFT Harmonic Comb |X[k]|",
    beforeSub: "Individual glottal harmonics obscure the underlying vocal-tract resonances",
    beforeTrace: "fft",
    afterTitle: "AFTER · Smooth All-Pole Envelope H(e^jω) over FFT",
    afterSub: "Levinson–Durbin solves Toeplitz system R·a = r in O(p²) to fit vocal-tract filter",
    afterTrace: "spectrum",
    bypassLabel: "✕ UNDER-FIT STAGE (Order p = 4)",
    why: "Linear Predictive Coding separates the vocal tract filter H(z) from the glottal source by predicting each sample from the previous p samples. Lowering p to 4 under-fits and merges F1/F2 into a single blob; raising p to 24 over-fits and chases individual pitch harmonics.",
  },
  {
    id: 7,
    pill: "7. Z-PLANE POLES",
    title: "Stage 7 — Companion Matrix Eigenvalues & Complex Z-Plane Poles",
    kind: "derived",
    beforeTitle: "BEFORE · Predictor Polynomial A(z) = 1 − ∑ a_k z^−k",
    beforeSub: "LPC coefficients a[1..p] (cyan) and normalized autocorrelation R[1..p]/R[0] (faint)",
    beforeTrace: "lpcCoeffs",
    afterTitle: "AFTER · Complex Conjugate Roots z_k = r_k e^(±jθ_k)",
    afterSub: "Pole angle θ_k gives frequency Hz; pole radius r_k gives bandwidth B = −(fs/π) ln r_k",
    afterTrace: "zplane",
    why: "Peaks on the LPC spectrum can still merge when two formants sit close together. Factoring A(z) = 0 into complex roots inside the unit circle reveals every resonance's exact pole angle (frequency) and radius (damping), keeping only upper-half-plane roots with B < 500 Hz as F1, F2, F3.",
  },
  {
    id: 8,
    pill: "8. FORMANTS & VOWEL",
    title: "Stage 8 — Acoustic Vowel Space (F1, F2) & Chladni Nodal Mapping",
    kind: "mapped",
    beforeTitle: "BEFORE · Extracted Formants (F1, F2, F3) in Vowel Space",
    beforeSub: "Bark-scale psychoacoustic distance to 8 Bangla / IPA reference vowels",
    beforeTrace: "vowel",
    afterTitle: "AFTER · Chladni Standing-Wave Plate C(x, y) = 0",
    afterSub: "Deterministic bijective mapping: F1 → mode m, F2 → mode n on a square plate",
    afterTrace: "plate",
    why: "Tongue height controls pharyngeal cavity volume (F1, vertical axis) while tongue advancement controls oral cavity length (F2, horizontal axis). Mapping (F1, F2) into Bark space and Chladni nodal numbers (m, n) turns an invisible acoustic resonance into a reproducible geometric fingerprint.",
  },
] as const;

function fmtArr(arr: ArrayLike<number>, count: number, digits = 4): string {
  const n = Math.min(count, arr.length);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    parts.push(`${v >= 0 ? "+" : ""}${v.toFixed(digits)}`);
  }
  return `[ ${parts.join(", ")}${arr.length > n ? ", …" : ""} ]`;
}

function TraceInspector() {
  const traceStage = useLabStore((s) => s.traceStage);
  const setTraceStage = useLabStore((s) => s.setTraceStage);
  const stepTraceStage = useLabStore((s) => s.stepTraceStage);
  const setTraceOpen = useLabStore((s) => s.setTraceOpen);
  const captureAndTrace = useLabStore((s) => s.captureAndTrace);
  const toggleBypassStage = useLabStore((s) => s.toggleBypassStage);
  const bypassedStage = useLabStore((s) => s.bypassedStage);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);
  const recomputeCount = useLabStore((s) => s.recomputeCount);
  const options = useLabStore((s) => s.analyzerOptions);
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const nodal = useLabStore((s) => s.showNodalLines);

  const [showMath, setShowMath] = useState(true);
  const [, setTick] = useState(0);

  // Subscribe to telemetry updates so the live mathematical tape stays in sync when live or re-computed.
  useEffect(() => {
    let last = 0;
    return labRuntime.subscribe(() => {
      const now = performance.now();
      if (useLabStore.getState().frozen || now - last > 140) {
        last = now;
        setTick((c) => (c + 1) % 100000);
      }
    });
  }, [recomputeCount, frozen, traceStage]);

  const spec = TRACE_STAGES[traceStage - 1];
  const active: DSPFrameTelemetry = labRuntime.getActiveTelemetry();
  const base: DSPFrameTelemetry = labRuntime.getBaselineTelemetry();
  const sb = active.stageBuffers;
  const winInfo = WINDOW_INFO[options.windowType];
  const canBypass = traceStage === 2 || traceStage === 3 || traceStage === 6;
  const isBypassed = bypassedStage === traceStage;
  const modifiedWhileFrozen = frozen && recomputeCount > 0;

  const restoreBaseline = () => {
    const baseOpts = labRuntime.getBaselineOptions();
    updateOptions(baseOpts);
    useLabStore.setState({ bypassedStage: null, recomputeCount: 0 });
  };

  return (
    <section
      aria-label="Trace and Re-Run Signal Inspector"
      className="ui-panel mb-4 border border-accent/50 bg-surface"
    >
      {/* Top Pipeline Stepper Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="mark bg-accent!" aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-wide text-ink uppercase">
            Trace &amp; Re-Run Signal
          </h2>
          <span className="bg-raised px-2 py-0.5 text-[11px] font-medium text-muted">
            {frozen
              ? modifiedWhileFrozen
                ? `Frozen slice · Re-computed (${recomputeCount}×) vs Baseline`
                : "Frozen slice · 512 samples locked"
              : "Live stream · Click Freeze or Capture to lock a slice"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => stepTraceStage(-1)}
            className="btn min-h-8! px-2.5! py-1! text-[12px]"
          >
            ◀ PREV
          </button>
          <button
            type="button"
            onClick={() => stepTraceStage(1)}
            className="btn min-h-8! px-2.5! py-1! text-[12px]"
          >
            STEP ▶
          </button>
          <button
            type="button"
            onClick={() => {
              if (!frozen) captureAndTrace();
              else {
                toggleFreeze();
                setTimeout(() => useLabStore.getState().captureAndTrace(), 40);
              }
            }}
            className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-medium"
            title="Capture the latest 512-sample voice slice as the new baseline"
          >
            Capture new slice
          </button>
          {modifiedWhileFrozen && (
            <button
              type="button"
              onClick={restoreBaseline}
              className="ui-tab min-h-8 border border-line px-2.5 text-[12px] font-medium text-accent"
            >
              Restore baseline
            </button>
          )}
          <button
            type="button"
            onClick={() => setTraceOpen(false)}
            className="ui-tab min-h-8 px-2 text-[12px] font-medium text-muted hover:text-ink"
          >
            Close ✕
          </button>
        </div>
      </header>

      {/* 8-Stage Pipeline Bar */}
      <div
        role="tablist"
        aria-label="8-Stage DSP Pipeline"
        className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line bg-raised/50 px-3 py-2"
      >
        {TRACE_STAGES.map((st, idx) => {
          const current = st.id === traceStage;
          return (
            <div key={st.id} className="flex flex-none items-center gap-1">
              <button
                type="button"
                role="tab"
                aria-selected={current}
                onClick={() => setTraceStage(st.id)}
                className={`px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                  current
                    ? "bg-accent text-[#08090c] font-semibold"
                    : "bg-raised text-muted hover:text-ink"
                }`}
              >
                [ {st.pill} ]
              </button>
              {idx < TRACE_STAGES.length - 1 && (
                <span className="px-0.5 text-[11px] text-muted select-none" aria-hidden>
                  ➔
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Stage Subheader & Interactive Re-Computation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">
            <Prov kind={spec.kind}>{spec.title}</Prov>
          </h3>
        </div>

        {/* Stage-specific live re-computation controls */}
        <div className="flex flex-wrap items-center gap-3">
          {traceStage === 2 && (
            <button
              type="button"
              aria-pressed={options.preEmphasis > 0}
              onClick={() => updateOptions({ preEmphasis: options.preEmphasis > 0 ? 0 : 0.97 })}
              className="btn min-h-8! px-3! py-1! text-[12px]"
            >
              [ Toggle Pre-Emphasis α=0.97 : {options.preEmphasis > 0 ? "ON" : "OFF (α=0)"} ]
            </button>
          )}

          {(traceStage === 3 || traceStage === 4) && (
            <div role="radiogroup" aria-label="Window function" className="flex flex-wrap items-center gap-1.5">
              {WINDOW_TYPES.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={options.windowType === w}
                  onClick={() => updateOptions({ windowType: w })}
                  className={`px-2.5 py-1 text-[12px] font-medium ${
                    options.windowType === w ? "bg-accent text-[#08090c] font-semibold" : "bg-raised text-muted hover:text-ink"
                  }`}
                >
                  {WINDOW_INFO[w].label}
                </button>
              ))}
              <span className="ui-fig ml-1 text-[11px] text-muted">
                Sidelobe {winInfo.peakSidelobeDb.toFixed(1)} dB · Main lobe {winInfo.mainLobeBins} bins
              </span>
            </div>
          )}

          {(traceStage === 6 || traceStage === 7) && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12px]">
                <span className="text-muted">LPC Order p:</span>
                <input
                  type="range"
                  min={4}
                  max={24}
                  step={2}
                  value={options.lpcOrder}
                  onChange={(e) => updateOptions({ lpcOrder: Number(e.target.value) })}
                  className="ui-slider w-28"
                />
                <span className="ui-fig min-w-[6ch] font-semibold text-ink">{options.lpcOrder} poles</span>
              </label>
            </div>
          )}

          {canBypass && (
            <button
              type="button"
              aria-pressed={isBypassed}
              onClick={() => toggleBypassStage(traceStage)}
              className={`px-2.5 py-1 text-[12px] font-medium transition-colors ${
                isBypassed
                  ? "bg-accent text-[#08090c] font-semibold"
                  : "border border-line bg-raised text-ink hover:border-accent"
              }`}
            >
              [ {isBypassed ? "✓ STAGE BYPASSED — CLICK TO RESTORE" : spec.bypassLabel ?? "✕ BYPASS THIS STAGE"} ]
            </button>
          )}
        </div>
      </div>

      {/* BEFORE | AFTER Visual Comparison Grid */}
      <div className="grid grid-cols-12 border-b border-line">
        {/* LEFT COLUMN: BEFORE (Stage Input) */}
        <div className="col-span-12 flex flex-col border-b border-line md:col-span-6 md:border-r md:border-b-0">
          <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5">
            <span className="text-[12px] font-semibold text-ink">{spec.beforeTitle}</span>
            <span className="text-[11px] text-muted">{spec.beforeSub}</span>
          </div>
          <Trace
            kind={spec.beforeTrace}
            inspect
            compareBaseline={traceStage === 8}
            onPick={traceStage === 8 ? (id) => selectTarget(id, sourceMode !== "mic" && sourceMode !== "stream") : undefined}
            label={spec.beforeTitle}
            className="h-[220px] w-full"
          />
        </div>

        {/* RIGHT COLUMN: AFTER (Stage Output) */}
        <div className="col-span-12 flex flex-col md:col-span-6">
          <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised/30 px-3 py-1.5">
            <span className="text-[12px] font-semibold text-ink">{spec.afterTitle}</span>
            <span className="text-[11px] text-muted">{spec.afterSub}</span>
          </div>
          {spec.afterTrace === "plate" ? (
            <PlateStage interactive showNodalLines={nodal} className="h-[220px] w-full" />
          ) : (
            <Trace
              kind={spec.afterTrace}
              inspect
              compareBaseline
              label={spec.afterTitle}
              className="h-[220px] w-full"
            />
          )}
        </div>
      </div>

      {/* Live Stage Telemetry Strip (Baseline vs Current when frozen & modified) */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-b border-line bg-raised/40 px-3 py-2 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span>
            <span className="text-muted">Params:</span>{" "}
            <span className="ui-fig text-ink">
              α = {options.preEmphasis.toFixed(2)} · {WINDOW_INFO[options.windowType].label} · LPC({options.lpcOrder})
            </span>
          </span>
          <span>
            <span className="text-muted">F0:</span>{" "}
            <span className="ui-fig text-ink">
              {active.voiced ? `${Math.round(active.stability.f0Hz)} Hz (τ = ${sb.peakLagTau.toFixed(1)})` : "Unvoiced"}
            </span>
          </span>
          <span>
            <span className="text-muted">Formants (AFTER):</span>{" "}
            <span className="ui-fig text-ink">
              F1 {Math.round(active.formants.f1)} Hz · F2 {Math.round(active.formants.f2)} Hz · F3 {Math.round(active.formants.f3)} Hz
            </span>
          </span>
          {modifiedWhileFrozen && (
            <span>
              <span className="text-muted">Baseline (BEFORE):</span>{" "}
              <span className="ui-fig text-muted">
                F1 {Math.round(base.formants.f1)} Hz · F2 {Math.round(base.formants.f2)} Hz · F3 {Math.round(base.formants.f3)} Hz
              </span>
              <span className="ui-fig ml-2 text-accent">
                (ΔF1 {Math.round(active.formants.f1 - base.formants.f1) >= 0 ? "+" : ""}
                {Math.round(active.formants.f1 - base.formants.f1)} Hz, ΔF2{" "}
                {Math.round(active.formants.f2 - base.formants.f2) >= 0 ? "+" : ""}
                {Math.round(active.formants.f2 - base.formants.f2)} Hz)
              </span>
            </span>
          )}
        </div>
        <button
          type="button"
          aria-expanded={showMath}
          onClick={() => setShowMath(!showMath)}
          className="ui-tab min-h-7 text-[12px] font-semibold text-accent"
        >
          [ {showMath ? "HIDE MATHEMATICS ▲" : "SHOW MATHEMATICS ▼"} ]
        </button>
      </div>

      {/* Bottom Strip: WHY THIS STAGE MATTERS + Expandable SHOW MATHEMATICS Tape */}
      <div className="px-3 py-2.5">
        <p className="text-[13px] leading-relaxed text-ink">
          <strong className="font-semibold text-accent uppercase">Why this stage matters: </strong>
          {spec.why}
        </p>

        {showMath && (
          <div className="mt-3 grid grid-cols-12 gap-3 border-t border-line pt-3 text-[12px]">
            <div className="col-span-12 space-y-1.5 lg:col-span-7">
              <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                Live Captured Frame Numerical Tape (N = 512, fs = {active.analysisRate} Hz)
              </div>
              <div className="ui-fig overflow-x-auto bg-raised p-2.5 leading-relaxed text-ink">
                <div>
                  <span className="text-muted">rawDecimated x[0..5]   = </span>
                  {fmtArr(sb.rawDecimated, 6, 4)}
                </div>
                <div>
                  <span className="text-muted">preEmphasized y[0..5]  = </span>
                  {fmtArr(sb.preEmphasized, 6, 4)}{" "}
                  <span className="text-muted">(y[n] = x[n] − {options.preEmphasis.toFixed(2)}·x[n−1])</span>
                </div>
                <div>
                  <span className="text-muted">windowWeights w[0..5]  = </span>
                  {fmtArr(sb.windowWeights, 6, 4)}{" "}
                  <span className="text-muted">({WINDOW_INFO[options.windowType].label}, w[256] = {sb.windowWeights[256]?.toFixed(4) ?? "1.0000"})</span>
                </div>
                <div>
                  <span className="text-muted">windowed xw[0..5]      = </span>
                  {fmtArr(sb.windowed, 6, 4)}
                </div>
                <div>
                  <span className="text-muted">autocorr R[0..6]       = </span>
                  {fmtArr(sb.autocorrCoeffs, 7, 4)}
                </div>
                <div>
                  <span className="text-muted">lpcCoeffs a[1..{sb.lpcCoeffs.length}] = </span>
                  {fmtArr(sb.lpcCoeffs, 8, 4)}{" "}
                  <span className="text-muted">· Gain G = {sb.lpcGain.toFixed(4)}</span>
                </div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-5">
              <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                Extracted Upper-Half-Plane Roots (r, θ) → (F_i, B_i)
              </div>
              <div className="max-h-[152px] overflow-y-auto bg-raised p-2">
                <table className="ui-fig w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="pb-1">Root z</th>
                      <th className="pb-1">|z| = r</th>
                      <th className="pb-1">θ / π</th>
                      <th className="pb-1">Freq</th>
                      <th className="pb-1">BW</th>
                      <th className="pb-1">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sb.allPoles
                      .filter((p) => p.im >= 0 && p.radius > 0)
                      .map((p, i) => (
                        <tr key={i} className="border-b border-line/40 last:border-0">
                          <td className="py-0.5">
                            {p.re.toFixed(2)}+{p.im.toFixed(2)}j
                          </td>
                          <td className="py-0.5">{p.radius.toFixed(3)}</td>
                          <td className="py-0.5">{p.anglePi.toFixed(3)}π</td>
                          <td className="py-0.5">{Math.round(p.freqHz)} Hz</td>
                          <td className="py-0.5">{Math.round(p.bandwidthHz)} Hz</td>
                          <td className="py-0.5 font-semibold text-accent">
                            {p.selectedAs ?? "rejected"}
                          </td>
                        </tr>
                      ))}
                    {sb.allPoles.filter((p) => p.im >= 0 && p.radius > 0).length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-2 text-center text-muted">
                          No conjugate poles in current frame.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const MIC_GAINS = [1, 2.5, 5, 8] as const;

/**
 * Real-time hardware & acoustic capture monitor for Microphone and Tab/YouTube streams.
 * Updates its VU meter bar and voice-gate status via DOM refs at 60 fps without triggering React re-renders.
 */
function LiveInputMonitor() {
  const sourceMode = useLabStore((s) => s.sourceMode);
  const deviceLabel = useLabStore((s) => s.micDeviceLabel);
  const micGain = useLabStore((s) => s.micGain);
  const setMicGain = useLabStore((s) => s.setMicGain);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);
  const captureAndTrace = useLabStore((s) => s.captureAndTrace);
  const armed = useLabStore((s) => s.autoCaptureArmed);
  const setArmed = useLabStore((s) => s.setAutoCaptureArmed);

  const barRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLParagraphElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let lastTextUpdate = 0;
    return labRuntime.subscribe((t) => {
      const bar = barRef.current;
      const status = statusRef.current;
      const detail = detailRef.current;
      const dot = dotRef.current;
      if (!bar || !status || !detail || !dot) return;

      // Map rmsDb from [-72 dB .. -4 dB] to [2% .. 100%]
      const db = t.stability.rmsDb;
      const pct = Math.max(2, Math.min(100, ((db + 72) / 68) * 100));
      bar.style.width = `${pct.toFixed(1)}%`;

      const isFrozen = useLabStore.getState().frozen;
      const hasSound = db > -56;
      if (isFrozen) {
        bar.style.backgroundColor = "var(--accent)";
        dot.style.backgroundColor = "var(--accent)";
      } else if (t.voiced) {
        bar.style.backgroundColor = "#10b981";
        dot.style.backgroundColor = "#10b981";
      } else if (hasSound) {
        bar.style.backgroundColor = "#00e5ff";
        dot.style.backgroundColor = "#00e5ff";
      } else {
        bar.style.backgroundColor = "var(--muted)";
        dot.style.backgroundColor = "var(--accent)";
      }

      const now = performance.now();
      if (now - lastTextUpdate < 90 && !isFrozen) return;
      lastTextUpdate = now;

      if (isFrozen) {
        status.textContent = "PAUSED ON CAPTURED SLICE";
        detail.textContent = `F0 ${Math.round(t.stability.f0Hz)} Hz · F1 ${Math.round(t.formants.f1)} Hz · F2 ${Math.round(t.formants.f2)} Hz`;
      } else if (t.voiced && t.formants.f1 > 0) {
        const near = nearestVowel(t.formants.f1, t.formants.f2);
        status.textContent = "● VOICE LOCKED — ANALYZING LIVE";
        detail.textContent = `F0 ${Math.round(t.stability.f0Hz)} Hz · F1 ${Math.round(t.formants.f1)} Hz · F2 ${Math.round(t.formants.f2)} Hz · Nearest ${vowelGlyph(near)} /${near.symbol}/`;
      } else if (hasSound) {
        status.textContent = "◐ SOUND DETECTED (UNVOICED)";
        detail.textContent = "Signal is reaching the analyzer — hold a steady vowel (আ /aa/, ই /ii/, উ /uu/) to lock pitch & formants";
      } else {
        status.textContent = "○ LISTENING FOR VOICE…";
        detail.textContent =
          sourceMode === "mic"
            ? "Speak or hum a vowel into your microphone — increase Gain Boost if your mic is quiet"
            : "Play audio in your shared browser tab to see live formants";
      }
    });
  }, [sourceMode]);

  return (
    <section
      role="status"
      aria-label="Live audio input monitor"
      className="ui-panel mb-3 border border-accent/40 bg-raised px-3 py-2.5 text-[12px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        {/* Left: Active Hardware Device + Live Voice Gate State */}
        <div className="flex min-w-[260px] flex-1 items-center gap-3">
          <span
            ref={dotRef}
            className={`mark shrink-0 bg-accent! ${frozen ? "" : "animate-pulse"}`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span ref={statusRef} className="font-semibold tracking-wide text-ink uppercase">
                ○ LISTENING FOR VOICE…
              </span>
              <span className="truncate bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                {deviceLabel ?? (sourceMode === "mic" ? "Microphone active" : "Shared tab audio")}
              </span>
            </div>
            <p ref={detailRef} className="ui-fig mt-0.5 truncate text-[12px] text-muted">
              Speak or hum a vowel into your microphone — nothing is recorded or uploaded.
            </p>
          </div>
        </div>

        {/* Center: 60fps Real-Time VU Level Meter Bar */}
        <div className="flex min-w-[210px] flex-1 items-center gap-3">
          <span className="text-[11px] font-medium whitespace-nowrap text-muted uppercase">Input Level</span>
          <div
            className="relative h-3 flex-1 overflow-hidden border border-line bg-surface"
            title="Live RMS input level (threshold line marks −58 dB FS voice gate)"
          >
            {/* Voice gate threshold marker at -58 dB */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-ink/40"
              style={{ left: "20.6%" }}
            />
            <div
              ref={barRef}
              className="h-full w-[4%] bg-muted transition-[width] duration-75"
            />
          </div>
          <span className="ui-fig min-w-[7.5ch] text-right text-[12px] text-ink">
            <Readout field="level" /> dB
          </span>
        </div>

        {/* Right: Mic Gain Boost + Auto-Capture / Trace Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {sourceMode === "mic" && (
            <div role="group" aria-label="Microphone gain boost" className="flex items-center gap-1 bg-surface p-0.5">
              <span className="px-1.5 text-[11px] text-muted">Gain</span>
              {MIC_GAINS.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={micGain === g}
                  onClick={() => setMicGain(g)}
                  className={`px-2 py-0.5 text-[11px] font-medium ${
                    micGain === g ? "bg-accent text-[#08090c] font-semibold" : "text-muted hover:text-ink"
                  }`}
                >
                  {g}×
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            aria-pressed={armed}
            onClick={() => setArmed(!armed)}
            className={`px-2.5 py-1 text-[12px] font-medium transition-colors ${
              armed
                ? "bg-accent text-[#08090c] font-semibold animate-pulse"
                : "border border-line bg-surface text-ink hover:border-accent"
            }`}
            title="Arms a trigger that automatically freezes and opens the 8-stage X-Ray the moment you hold a steady spoken vowel"
          >
            {armed ? "● ARMED: Speak a vowel to auto-freeze…" : "Auto-capture next vowel"}
          </button>

          <button
            type="button"
            onClick={() => (frozen ? toggleFreeze() : captureAndTrace())}
            className="btn min-h-7! px-2.5! py-1! text-[12px]"
          >
            {frozen ? "Resume live mic" : "Freeze & trace now"}
          </button>
        </div>
      </div>
    </section>
  );
}

const SIDE_TABS = ["Readings", "Voice", "Analysis"] as const;

export function Lab() {
  const targetId = useLabStore((s) => s.targetId);
  const activeView = useLabStore((s) => s.activeView);
  const setActiveView = useLabStore((s) => s.setActiveView);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);
  const traceOpen = useLabStore((s) => s.traceOpen);
  const setTraceOpen = useLabStore((s) => s.setTraceOpen);
  const captureAndTrace = useLabStore((s) => s.captureAndTrace);
  const reset = useLabStore((s) => s.resetCalibration);
  const micError = useLabStore((s) => s.micError);
  const micStatus = useLabStore((s) => s.micStatus);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const windowType = useLabStore((s) => s.analyzerOptions.windowType);
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);
  const nodal = useLabStore((s) => s.showNodalLines);
  const [side, setSide] = useState<(typeof SIDE_TABS)[number]>("Readings");
  const target = findVowel(targetId);
  const solo = activeView !== "all";
  const liveInput = sourceMode === "mic" || sourceMode === "stream";

  // /lab?vowel=ii opens holding that vowel (the homepage form and the atlas link here).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("vowel");
    if (id && VOWEL_TARGETS.some((v) => v.id === id)) useLabStore.getState().selectTarget(id, true);
  }, []);

  const plotHeight = solo ? "h-[min(62svh,620px)]" : "";

  return (
    <main id="content" className="wrap min-h-svh pt-(--nav-h) pb-6 text-[13px] leading-[1.4]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 py-3.5">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">Laboratory</h1>
          <p className="mt-0.5 text-[14px] text-muted">
            Target{" "}
            <span lang={target.banglaSymbol ? "bn" : undefined} className="bn text-ink">
              {vowelGlyph(target)}
            </span>{" "}
            /{target.symbol}/, <span className="ui-fig text-ink"><Readout field="bark" /></span> Bark away.{" "}
            <span className="text-ink"><Readout field="guidance" /></span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <SourceSwitch />
          <span className="flex items-center gap-4">
            <button
              type="button"
              aria-pressed={traceOpen}
              onClick={() => (traceOpen ? setTraceOpen(false) : captureAndTrace())}
              className="btn min-h-9! px-3! py-1! text-[12px] font-semibold tracking-wide"
            >
              [ TRACE THIS SIGNAL ]
            </button>
            <button type="button" aria-pressed={frozen} onClick={toggleFreeze} className="ui-tab min-h-11 text-[13px] font-medium lg:min-h-8">
              Freeze
            </button>
            <button type="button" onClick={reset} className="ui-tab min-h-11 text-[13px] font-medium lg:min-h-8">
              Reset
            </button>
          </span>
        </div>
      </header>

      {micStatus === "requesting" && (
        <p role="status" className="mb-3 flex items-center gap-2.5 bg-raised px-3 py-2.5 text-[13px] text-ink">
          <span className="mark animate-pulse bg-accent!" aria-hidden />
          Waiting for the browser&rsquo;s permission to access your microphone or tab audio…
        </p>
      )}
      {micError && (
        <p role="alert" className="mb-3 border border-accent/50 bg-raised px-3 py-2.5 text-[13px] text-ink">
          {micError}
        </p>
      )}
      {(sourceMode === "mic" || sourceMode === "stream") && <LiveInputMonitor />}

      {traceOpen && <TraceInspector />}

      <div role="tablist" aria-label="Panels" className="no-scrollbar -mx-1 mb-3 flex gap-5 overflow-x-auto px-1">
        {VIEWS.map((v) => (
          <button
            key={v.view}
            type="button"
            role="tab"
            aria-selected={activeView === v.view}
            onClick={() => setActiveView(v.view)}
            className="ui-tab min-h-9 flex-none text-[13px] font-medium whitespace-nowrap"
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Panel view="vowel" title="Vowel chart" kind="derived" className="col-span-12 lg:col-span-4">
          <Trace
            kind="vowel"
            inspect
            compareBaseline
            label="Vowel chart: first formant against second, with eight reference vowels, the live position and its trail"
            onPick={(id) => selectTarget(id, !liveInput)}
            className={`w-full ${plotHeight || "min-h-[300px] flex-1 lg:min-h-[240px]"}`}
          />
          <VowelKeys className="border-t border-line p-0.5" />
        </Panel>

        <Panel view="figure" title="Figure" kind="mapped" className="col-span-12 md:col-span-7 lg:col-span-5">
          <PlateStage interactive showNodalLines={nodal} className={`w-full ${plotHeight || "min-h-[340px] flex-1 lg:min-h-[300px]"}`} />
          <p className="flex flex-wrap items-center justify-between gap-x-4 border-t border-line px-3 py-2 text-[12px] text-muted">
            <span>F1 chooses m, F2 chooses n. Drag to turn the plate.</span>
            <span className="ui-fig text-ink">
              m <Readout field="modeM" /> · n <Readout field="modeN" />
            </span>
          </p>
        </Panel>

        {!solo && (
          <section className="ui-panel col-span-12 flex min-w-0 flex-col md:col-span-5 lg:col-span-3">
            <header role="tablist" aria-label="Side panel" className="flex min-h-10 items-center gap-5 border-b border-line px-3">
              {SIDE_TABS.map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={side === tab} onClick={() => setSide(tab)} className="ui-tab min-h-10 text-[13px] font-medium">
                  {tab}
                </button>
              ))}
            </header>
            {side === "Readings" && <Readings />}
            {side === "Voice" && <VoiceControls />}
            {side === "Analysis" && <AnalysisControls />}
          </section>
        )}

        <Panel
          view="scope"
          title="Scope"
          kind="measured"
          className="col-span-12 lg:col-span-4"
          tools={
            <div role="radiogroup" aria-label="Window" className="flex gap-4">
              {WINDOW_TYPES.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={windowType === w} onClick={() => updateOptions({ windowType: w })} className="ui-tab text-[12px] font-medium">
                  {WINDOW_INFO[w].label}
                </button>
              ))}
            </div>
          }
        >
          <Trace kind="scope" label="The frame before and after the window: x[n] and x[n] times w[n]" className={`w-full ${plotHeight || "h-[200px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        <Panel
          view="spectrum"
          title="Spectrum and envelope"
          kind="derived"
          className="col-span-12 lg:col-span-5"
          tools={
            <p className="flex items-center gap-4 text-[12px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-muted" />FFT</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-lpc" />LPC</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-accent" />Formants</span>
            </p>
          }
        >
          <Trace kind="spectrum" inspect compareBaseline label="Magnitude spectrum with the linear-prediction envelope and formant markers" className={`w-full ${plotHeight || "h-[220px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        <Panel view="poles" title="Z-plane" kind="derived" className="col-span-12 lg:col-span-3">
          <Trace kind="zplane" inspect compareBaseline label="Poles of the vocal-tract model inside the unit circle" className={`w-full ${plotHeight || "h-[260px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        {solo && (
          <section className="ui-panel col-span-12">
            <Readings />
          </section>
        )}
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] text-muted">
        <Prov kind="measured">Measured: read off the signal</Prov>
        <Prov kind="derived">Derived: from a model fitted to it</Prov>
        <Prov kind="mapped">Mapped: a drawing rule</Prov>
        <span>An educational instrument, not a medical device.</span>
      </p>
    </main>
  );
}
