"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Prov, SourceSwitch, VowelKeys, type Provenance } from "@/components/instrument/controls";
import { InstrumentSelect, type SelectOption } from "@/components/instrument/InstrumentSelect";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { SIGNAL_HZ_RANGE, SIGNAL_INFO, type SignalKind, type WaveKind } from "@/lib/dsp/signals";
import { findVowel, nearestVowel, VOWEL_TARGETS, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";
import { labRuntime, useLabStore, type LabView, type LpcMethod, type ShapeModel } from "@/store/lab-store";

const SHAPE_MODELS: { id: ShapeModel; label: string; hint: string }[] = [
  { id: "square", label: "Square plate", hint: "F1 chooses m, F2 chooses n. Drag to orbit, scroll to zoom, click plate to scatter sand." },
  { id: "circular", label: "Bessel drum", hint: "Cylindrical Bessel J_m(αr)cos(mθ) modes on a circular brass-rimmed membrane." },
  { id: "harmonic", label: "Harmonic field", hint: "Superposition of top-6 live FFT peaks — responds to any voice, whistle, consonant or chord." },
  { id: "tract", label: "3D Vocal tract", hint: "Kelly–Lochbaum 3D resonator tube from glottis (left) to lips (right), driven by PARCOR k_m." },
];

const SHAPE_SELECT_OPTIONS: readonly SelectOption<ShapeModel>[] = [
  { value: "square", label: "Square plate", hint: "Chladni C=0" },
  { value: "circular", label: "Bessel drum", hint: "Circular J_m" },
  { value: "harmonic", label: "Harmonic field", hint: "3D FFT wave" },
  { value: "tract", label: "3D Vocal tract", hint: "Resonator tube" },
];

const LPC_SELECT_OPTIONS: readonly SelectOption<LpcMethod>[] = [
  { value: "autocorr", label: "LPC Autocorr", hint: "Yule–Walker" },
  { value: "burg", label: "LPC Burg", hint: "Lattice MEM" },
];

const SOURCE_WAVE_OPTIONS: readonly SelectOption<WaveKind>[] = [
  { value: "voice", label: "Synthetic voice (vowels)", hint: "Source–filter" },
  ...(Object.keys(SIGNAL_INFO) as SignalKind[]).map((kind) => ({
    value: kind as WaveKind,
    label: `Test: ${SIGNAL_INFO[kind].label}`,
    hint: kind === "noise" ? "Unvoiced" : "Signal",
  })),
];

const VIEWS: { view: LabView; label: string }[] = [
  { view: "all", label: "All" },
  { view: "vowel", label: "Vowel chart" },
  { view: "figure", label: "Figure" },
  { view: "spectrum", label: "Spectrum" },
  { view: "poles", label: "Poles" },
  { view: "scope", label: "Scope" },
  { view: "time", label: "Over time" },
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
      { label: "Centroid", field: "centroid", unit: "Hz", extra: { field: "flatness", unit: "% noise" } },
      { label: "Jitter", field: "jitter", unit: "%" },
      { label: "Shimmer", field: "shimmer", unit: "dB" },
      { label: "Syllables", field: "syllables", unit: "per s" },
    ],
  },
  {
    kind: "derived",
    rows: [
      { label: "Regime", field: "regime" },
      { label: "F1", field: "f1", unit: "Hz", extra: { field: "b1", unit: "wide" } },
      { label: "F2", field: "f2", unit: "Hz", extra: { field: "b2", unit: "wide" } },
      { label: "F3", field: "f3", unit: "Hz", extra: { field: "b3", unit: "wide" } },
      { label: "Est. tract", field: "tractLength", unit: "cm", extra: { field: "antiZero", unit: "Hz Z0" } },
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
  const signal = synth.wave !== "voice";
  return (
    <div className="stage-enter px-3 py-2">
      <div className="py-1.5">
        <span className="ui-label mb-1.5 block">Built-in source</span>
        <InstrumentSelect
          ariaLabel="Built-in source"
          value={synth.wave}
          options={SOURCE_WAVE_OPTIONS}
          disabled={liveInput}
          onChange={(val) => updateSynth({ wave: val })}
          className="w-full"
          menuWidthClass="w-full min-w-[230px]"
        />
      </div>
      {signal && (
        <>
          <Slider
            label="Signal frequency"
            value={synth.waveHz}
            min={SIGNAL_HZ_RANGE[0]}
            max={SIGNAL_HZ_RANGE[1]}
            step={10}
            disabled={liveInput || synth.wave === "sweep" || synth.wave === "noise"}
            format={(v) => `${v.toFixed(0)} Hz`}
            onCommit={(v) => updateSynth({ waveHz: v })}
          />
          <p className="ui-label mb-2">
            What to expect in the spectrum: {SIGNAL_INFO[synth.wave as SignalKind].spectrum}
          </p>
        </>
      )}
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
      <Slider label="Voice pitch" value={synth.f0Hz} min={70} max={350} step={1} disabled={liveInput || signal} format={(v) => `${v.toFixed(0)} Hz`} onCommit={(v) => updateSynth({ f0Hz: v })} />
      <Slider label="Formant shift (tract length)" value={synth.formantShift} min={0.8} max={1.25} step={0.01} disabled={liveInput || signal} format={(v) => `× ${v.toFixed(2)}`} onCommit={(v) => updateSynth({ formantShift: v })} />
      <Slider label="Jitter put in" value={synth.jitterPercent} min={0} max={3} step={0.1} disabled={liveInput || signal} format={(v) => `${v.toFixed(1)} %`} onCommit={(v) => updateSynth({ jitterPercent: v })} />
      <Slider label="Volume when played" value={volume} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onCommit={setVolume} />
      <p className="ui-label mt-2">
        {liveInput
          ? "These shape the built-in source. While a microphone or another tab is live, that is what the lab analyses."
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
  const cepstrum = useLabStore((s) => s.showCepstrum);
  const setCepstrum = useLabStore((s) => s.setShowCepstrum);
  const calibrateVtl = useLabStore((s) => s.calibrateVtlToCurrentVoice);
  const lpcMethod = options.lpcMethod ?? "autocorr";
  const vtlScale = options.vtlScale ?? 1;
  const info = WINDOW_INFO[options.windowType];
  return (
    <div className="px-3 py-2">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <span className="ui-label">LPC estimator</span>
        <div role="radiogroup" aria-label="LPC estimator" className="flex gap-3">
          {(["autocorr", "burg"] as LpcMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={lpcMethod === m}
              className="ui-tab text-[12px] font-medium"
              onClick={() => update({ lpcMethod: m })}
            >
              {m === "autocorr" ? "Autocorr" : "Burg lattice"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-9 items-center justify-between gap-4">
        <span className="ui-label">Cepstral envelope &amp; zeros</span>
        <button
          type="button"
          role="switch"
          aria-checked={cepstrum}
          className="ui-tab text-[13px] font-medium"
          onClick={() => setCepstrum(!cepstrum)}
        >
          {cepstrum ? "Shown" : "Hidden"}
        </button>
      </div>
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
      <Slider
        label="Speaker tract calibration"
        value={vtlScale}
        min={0.8}
        max={1.25}
        step={0.01}
        format={(v) => `× ${v.toFixed(2)}`}
        onCommit={(v) => update({ vtlScale: v })}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={calibrateVtl}
          className="rounded-(--radius-sm) border border-line bg-raised px-2.5 py-1 text-[12px] font-medium text-ink hover:border-accent"
        >
          Fit target to current voice
        </button>
        {Math.abs(vtlScale - 1) > 0.005 && (
          <button
            type="button"
            onClick={() => update({ vtlScale: 1 })}
            className="text-[12px] text-muted hover:text-ink"
          >
            Reset 1.00×
          </button>
        )}
      </div>
      <p className="ui-label mt-2">
        {info.label} window: {info.formula}. Highest sidelobe {info.peakSidelobeDb.toFixed(1)} dB, main lobe{" "}
        {info.mainLobeBins} bins. Change the window in the Scope panel.
      </p>
    </div>
  );
}

/**
 * Real-time hardware & acoustic capture monitor for Microphone and Tab/YouTube streams.
 * Updates its VU meter bar and voice-gate status via DOM refs at 60 fps without triggering React re-renders.
 */
function LiveInputMonitor() {
  const sourceMode = useLabStore((s) => s.sourceMode);
  const deviceLabel = useLabStore((s) => s.micDeviceLabel);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);
  const captureAndTrace = useLabStore((s) => s.captureAndTrace);
  const isRecordingClip = useLabStore((s) => s.isRecordingClip);
  const hasRecordedClip = useLabStore((s) => s.hasRecordedClip);
  const playingRecordedClip = useLabStore((s) => s.playingRecordedClip);
  const recordingProgress = useLabStore((s) => s.recordingProgress);
  const startRecording3s = useLabStore((s) => s.startRecording3s);
  const setPlayRecordedClip = useLabStore((s) => s.setPlayRecordedClip);

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

      // Always drive the VU bar from the live incoming RMS dB so the user sees the mic moving even when holding last vowel
      const liveDb = labRuntime.getLiveRmsDb();
      const pct = Math.max(3, Math.min(100, ((liveDb + 72) / 68) * 100));
      bar.style.width = `${pct.toFixed(1)}%`;

      const st = useLabStore.getState();
      const isFrozen = st.frozen;
      const liveVoiced = labRuntime.isLiveVoiced();
      const holding = labRuntime.isHoldingLastVoiced();
      const hasSound = liveDb > -56;

      if (st.isRecordingClip) {
        bar.style.backgroundColor = "var(--accent)";
        dot.style.backgroundColor = "var(--accent)";
      } else if (isFrozen) {
        bar.style.backgroundColor = "var(--accent)";
        dot.style.backgroundColor = "var(--accent)";
      } else if (liveVoiced || st.playingRecordedClip) {
        bar.style.backgroundColor = "#10b981";
        dot.style.backgroundColor = "#10b981";
      } else if (hasSound || holding) {
        bar.style.backgroundColor = "#00e5ff";
        dot.style.backgroundColor = "#00e5ff";
      } else {
        bar.style.backgroundColor = "var(--muted)";
        dot.style.backgroundColor = "var(--accent)";
      }

      const now = performance.now();
      if (now - lastTextUpdate < 90 && !isFrozen && !st.isRecordingClip) return;
      lastTextUpdate = now;

      if (st.isRecordingClip) {
        const left = Math.max(0, 3 * (1 - st.recordingProgress)).toFixed(1);
        status.textContent = `● RECORDING YOUR VOICE… (${left}s)`;
        detail.textContent = "Say a vowel like 'Aaaa' or 'Eeee' — it will play back automatically when done";
      } else if (st.playingRecordedClip) {
        const near = t.formants.f1 > 0 ? nearestVowel(t.formants.f1, t.formants.f2) : null;
        status.textContent = "▶ PLAYING YOUR 3s VOICE RECORDING";
        detail.textContent = near
          ? `Looping your recorded voice · F0 ${Math.round(t.stability.f0Hz)} Hz · F1 ${Math.round(t.formants.f1)} Hz · F2 ${Math.round(t.formants.f2)} Hz · ${vowelGlyph(near)} /${near.symbol}/`
          : "Looping and analysing your 3-second recording";
      } else if (isFrozen) {
        status.textContent = "Paused on the captured voice";
        detail.textContent = `F0 ${Math.round(t.stability.f0Hz)} Hz · F1 ${Math.round(t.formants.f1)} Hz · F2 ${Math.round(t.formants.f2)} Hz`;
      } else if (liveVoiced && t.formants.f1 > 0) {
        const near = nearestVowel(t.formants.f1, t.formants.f2);
        status.textContent = "● HEARING YOUR VOICE — LIVE";
        detail.textContent = `F0 ${Math.round(t.stability.f0Hz)} Hz · F1 ${Math.round(t.formants.f1)} Hz · F2 ${Math.round(t.formants.f2)} Hz · Nearest ${vowelGlyph(near)} /${near.symbol}/`;
      } else if (holding && t.formants.f1 > 0) {
        const near = nearestVowel(t.formants.f1, t.formants.f2);
        status.textContent = `✓ HELD YOUR LAST VOWEL (${vowelGlyph(near)} /${near.symbol}/ · ${Math.round(t.stability.f0Hz)} Hz)`;
        detail.textContent = `F1 ${Math.round(t.formants.f1)} Hz · F2 ${Math.round(t.formants.f2)} Hz kept on screen so you can inspect it — speak again anytime`;
      } else if (hasSound) {
        status.textContent = "◐ SOUND DETECTED";
        detail.textContent = "Microphone is picking up sound — hold a steady vowel ('Aaaa', 'Eeee') to lock formants";
      } else {
        status.textContent = sourceMode === "mic" ? "○ MICROPHONE READY — SPEAK NOW" : "○ TAB AUDIO READY";
        detail.textContent =
          sourceMode === "mic"
            ? "Say 'Aaaa' into your mic (charts auto-hold your vowel when you stop) or click Record 3s Voice"
            : "Play sound in the shared tab to see its formants";
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
        {/* Left: Active Hardware Device + Clear Status */}
        <div className="flex min-w-[260px] flex-1 items-center gap-3">
          <span
            ref={dotRef}
            className={`mark shrink-0 bg-accent! ${frozen ? "" : "animate-pulse"}`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span ref={statusRef} className="font-semibold text-ink">
                ○ MICROPHONE READY — SPEAK NOW
              </span>
              <span className="truncate bg-surface px-1.5 py-0.5 text-[12px] text-muted">
                {deviceLabel ?? (sourceMode === "mic" ? "Microphone active" : "Shared tab audio")}
              </span>
            </div>
            <p ref={detailRef} className="ui-fig mt-0.5 truncate text-[12px] text-muted">
              Say &lsquo;Aaaa&rsquo; into your mic (charts auto-hold your vowel when you stop) or click Record 3s Voice.
            </p>
          </div>
        </div>

        {/* Center: Live Mic Level Bar */}
        <div className="flex min-w-[190px] flex-1 items-center gap-2.5">
          <span className="text-[12px] font-medium whitespace-nowrap text-muted">Level</span>
          <div
            className="relative h-3 flex-1 overflow-hidden border border-line bg-surface rounded-(--radius-sm)"
            title="Live microphone input level"
          >
            <div
              ref={barRef}
              className="h-full w-[4%] bg-muted transition-[width] duration-75"
            />
          </div>
        </div>

        {/* Right: Simple 1-Click Voice Recording & Inspection Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {sourceMode === "mic" && (
            <button
              type="button"
              disabled={isRecordingClip}
              onClick={startRecording3s}
              className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                isRecordingClip
                  ? "bg-accent text-accent-ink animate-pulse"
                  : "bg-accent text-accent-ink hover:opacity-90"
              }`}
            >
              {isRecordingClip
                ? `● Recording… ${Math.max(0, 3 * (1 - recordingProgress)).toFixed(1)}s`
                : hasRecordedClip
                  ? "Record again"
                  : "Record 3 seconds"}
            </button>
          )}

          {sourceMode === "mic" && hasRecordedClip && !isRecordingClip && (
            <button
              type="button"
              aria-pressed={playingRecordedClip}
              onClick={() => setPlayRecordedClip(!playingRecordedClip)}
              className={`px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                playingRecordedClip
                  ? "border border-accent bg-surface text-accent font-semibold"
                  : "border border-line bg-surface text-ink hover:border-accent"
              }`}
            >
              {playingRecordedClip ? "Back to the live microphone" : "Play my recording"}
            </button>
          )}

          <button
            type="button"
            onClick={() => (frozen ? toggleFreeze() : captureAndTrace())}
            className="border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink hover:border-accent rounded-(--radius-sm)"
          >
            {frozen ? "Resume live" : "Hold and trace"}
          </button>
        </div>
      </div>
    </section>
  );
}

const SIDE_TABS = ["Readings", "Source", "Analysis"] as const;

export function Lab() {
  const targetId = useLabStore((s) => s.targetId);
  const activeView = useLabStore((s) => s.activeView);
  const setActiveView = useLabStore((s) => s.setActiveView);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);
  const reset = useLabStore((s) => s.resetCalibration);
  const micError = useLabStore((s) => s.micError);
  const micStatus = useLabStore((s) => s.micStatus);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const windowType = useLabStore((s) => s.analyzerOptions.windowType);
  const lpcMethod = useLabStore((s) => s.analyzerOptions.lpcMethod ?? "autocorr");
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);
  const nodal = useLabStore((s) => s.showNodalLines);
  const showCepstrum = useLabStore((s) => s.showCepstrum);
  const setShowCepstrum = useLabStore((s) => s.setShowCepstrum);
  const shapeModel = useLabStore((s) => s.shapeModel);
  const setShapeModel = useLabStore((s) => s.setShapeModel);
  const excitePlate = useLabStore((s) => s.excitePlate);
  const activeShapeInfo = SHAPE_MODELS.find((m) => m.id === shapeModel) ?? SHAPE_MODELS[0];
  const [side, setSide] = useState<(typeof SIDE_TABS)[number]>("Readings");
  const target = findVowel(targetId);
  const solo = activeView !== "all";
  const liveInput = sourceMode === "mic" || sourceMode === "stream";
  const wave = useLabStore((s) => s.synth.wave);
  const waveHz = useLabStore((s) => s.synth.waveHz);
  const testSignal = wave === "voice" ? null : wave;
  const router = useRouter();

  // /lab?vowel=ii opens holding that vowel; /lab?signal=square&hz=440 opens on a test signal;
  // /lab?exp=3, an older link, now goes to that experiment's own page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("vowel");
    if (id && VOWEL_TARGETS.some((v) => v.id === id)) useLabStore.getState().selectTarget(id, true);
    const signal = params.get("signal");
    if (signal && signal in SIGNAL_INFO) {
      const hz = Number(params.get("hz"));
      useLabStore.getState().updateSynth({
        wave: signal as SignalKind,
        ...(hz >= SIGNAL_HZ_RANGE[0] && hz <= SIGNAL_HZ_RANGE[1] ? { waveHz: hz } : {}),
      });
    }
    const expParam = Number(params.get("exp"));
    if (expParam >= 1 && expParam <= 5) router.replace(`/experiments/${expParam}`);
  }, [router]);

  const plotHeight = solo ? "h-[min(62svh,620px)]" : "";

  return (
    <main id="content" className="wrap min-h-svh pt-(--nav-h) pb-8 text-[14px] leading-[1.4]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em] text-ink">Laboratory</h1>
            <nav aria-label="More of the lab" className="flex items-center gap-5 text-[15px] font-medium">
              <Link href="/lab/trace" className="link">
                Trace a frame
              </Link>
              <Link href="/experiments" className="link">
                Experiments
              </Link>
            </nav>
          </div>
          {testSignal && !liveInput ? (
            <p className="mt-1 text-[15px] text-muted">
              Test signal: <span className="text-ink">{SIGNAL_INFO[testSignal].label.toLowerCase()}</span>
              {testSignal === "sweep" || testSignal === "noise" ? "" : <>, <span className="ui-fig text-ink">{waveHz}</span> Hz</>}.{" "}
              <span className="text-ink">{SIGNAL_INFO[testSignal].spectrum}</span>
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted">
              Target{" "}
              <span lang={target.banglaSymbol ? "bn" : undefined} className="bn text-ink">
                {vowelGlyph(target)}
              </span>{" "}
              /{target.symbol}/, <span className="ui-fig text-ink"><Readout field="bark" /></span> Bark away.{" "}
              <span className="text-ink"><Readout field="guidance" /></span>
            </p>
          )}
          <p data-testid="lab-regime-strip" className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
            <span className="rounded-(--radius-sm) border border-line bg-surface px-2 py-0.5 text-[12px] font-semibold text-ink">
              <Readout field="regime" />
            </span>
            <span>
              <Readout field="regimeDetail" />
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <SourceSwitch />
          <span className="flex items-center gap-4">
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
        <p role="status" className="mb-3 flex items-center gap-2.5 bg-raised px-3 py-2.5 text-[13px] text-ink rounded-(--radius-sm)">
          <span className="mark animate-pulse bg-accent!" aria-hidden />
          Waiting for the browser&rsquo;s permission to access your microphone or tab audio…
        </p>
      )}
      {micError && (
        <p role="alert" className="mb-3 border border-accent/50 bg-raised px-3 py-2.5 text-[13px] text-ink rounded-(--radius-sm)">
          {micError}
        </p>
      )}
      {(sourceMode === "mic" || sourceMode === "stream") && <LiveInputMonitor />}

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

        <Panel
          view="figure"
          title="3D Acoustic Stage"
          kind="mapped"
          className="col-span-12 md:col-span-7 lg:col-span-5"
          tools={
            <div className="flex items-center gap-2">
              <InstrumentSelect
                ariaLabel="3D geometry"
                size="sm"
                align="right"
                value={shapeModel}
                options={SHAPE_SELECT_OPTIONS}
                onChange={setShapeModel}
                className="w-[152px]"
                menuWidthClass="w-[235px]"
              />
              {shapeModel !== "tract" && (
                <button
                  type="button"
                  onClick={excitePlate}
                  className="rounded-(--radius-sm) border border-line bg-raised px-2.5 py-1 text-[12px] font-medium text-ink transition-transform hover:border-accent active:scale-95"
                >
                  Tap plate
                </button>
              )}
            </div>
          }
        >
          <PlateStage
            interactive
            showNodalLines={nodal}
            shapeModel={shapeModel}
            className={`w-full ${plotHeight || "min-h-[340px] flex-1 lg:min-h-[300px]"}`}
          />
          <p className="flex flex-wrap items-center justify-between gap-x-4 border-t border-line px-3 py-2 text-[12px] text-muted">
            <span>{activeShapeInfo.hint}</span>
            <span className="ui-fig text-ink">
              {shapeModel === "tract" ? (
                <>
                  L <Readout field="tractLength" /> cm
                </>
              ) : (
                <>
                  m <Readout field="modeM" /> · n <Readout field="modeN" />
                </>
              )}
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
            {side === "Source" && <VoiceControls />}
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
          <Trace kind="scope" compareBaseline label="The frame before and after the window: x[n] and x[n] times w[n]" className={`w-full ${plotHeight || "h-[200px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        <Panel
          view="spectrum"
          title="Spectrum and envelope"
          kind="derived"
          className="col-span-12 lg:col-span-5"
          tools={
            <div className="flex items-center gap-2.5 text-[12px]">
              <InstrumentSelect
                ariaLabel="LPC model"
                size="sm"
                align="right"
                value={lpcMethod}
                options={LPC_SELECT_OPTIONS}
                onChange={(m) => updateOptions({ lpcMethod: m })}
                className="w-[140px]"
                menuWidthClass="w-[215px]"
              />
              <button
                type="button"
                aria-pressed={showCepstrum}
                onClick={() => setShowCepstrum(!showCepstrum)}
                className="ui-tab text-[12px] font-medium"
              >
                + Cepstrum
              </button>
            </div>
          }
        >
          <Trace kind="spectrum" inspect compareBaseline label="Magnitude spectrum with the linear-prediction envelope and formant markers" className={`w-full ${plotHeight || "h-[220px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        <Panel view="poles" title="Z-plane" kind="derived" className="col-span-12 lg:col-span-3">
          <Trace kind="zplane" inspect compareBaseline draggablePoles label="Poles of the vocal-tract model inside the unit circle (drag F1 or F2)" className={`w-full ${plotHeight || "h-[260px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        <Panel view="time" title="Spectrogram" kind="measured" className="col-span-12 lg:col-span-8">
          <Trace
            kind="spectrogram"
            label="Scrolling spectrogram: time left to right, frequency upward, with formant trails"
            className={`w-full ${plotHeight || "h-[220px] lg:h-[clamp(170px,24svh,280px)]"}`}
          />
        </Panel>
        {(activeView === "all" || activeView === "time") && (
          <section className="ui-panel col-span-12 flex min-w-0 flex-col lg:col-span-4">
            <header className="flex min-h-10 items-center border-b border-line px-3">
              <h2 className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
                <Prov kind="measured">Pitch track</Prov>
              </h2>
            </header>
            <Trace
              kind="pitchTrack"
              label="Pitch of the signal over the last four seconds"
              className="h-[200px] w-full lg:h-[clamp(170px,24svh,280px)]"
            />
          </section>
        )}

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
