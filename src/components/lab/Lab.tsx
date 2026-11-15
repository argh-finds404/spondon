"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Prov, SourceSwitch, VowelKeys, type Provenance } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { findVowel, VOWEL_TARGETS, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";
import { useLabStore, type LabView } from "@/store/lab-store";

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
  const mic = useLabStore((s) => s.sourceMode === "mic");
  const updateSynth = useLabStore((s) => s.updateSynth);
  const setVolume = useLabStore((s) => s.setVolume);
  return (
    <div className="px-3 py-2">
      <Slider label="Pitch" value={synth.f0Hz} min={70} max={350} step={1} disabled={mic} format={(v) => `${v.toFixed(0)} Hz`} onCommit={(v) => updateSynth({ f0Hz: v })} />
      <Slider label="Formant shift (tract length)" value={synth.formantShift} min={0.8} max={1.25} step={0.01} disabled={mic} format={(v) => `× ${v.toFixed(2)}`} onCommit={(v) => updateSynth({ formantShift: v })} />
      <Slider label="Jitter put in" value={synth.jitterPercent} min={0} max={3} step={0.1} disabled={mic} format={(v) => `${v.toFixed(1)} %`} onCommit={(v) => updateSynth({ jitterPercent: v })} />
      <Slider label="Volume when played" value={volume} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onCommit={setVolume} />
      <p className="ui-label mt-2">
        {mic
          ? "These shape the synthetic voice. With the microphone on, your own voice is the source."
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
      <Slider label="Model order" value={options.lpcOrder} min={4} max={20} step={2} format={(v) => `${v} poles`} onCommit={(v) => update({ lpcOrder: v })} />
      <p className="ui-label mt-2">
        {info.label} window: {info.formula}. Highest sidelobe {info.peakSidelobeDb.toFixed(1)} dB, main lobe{" "}
        {info.mainLobeBins} bins. Change the window in the Scope panel.
      </p>
    </div>
  );
}

const SIDE_TABS = ["Readings", "Voice", "Analysis"] as const;

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
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);
  const nodal = useLabStore((s) => s.showNodalLines);
  const [side, setSide] = useState<(typeof SIDE_TABS)[number]>("Readings");
  const target = findVowel(targetId);
  const solo = activeView !== "all";

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
          <span className="flex items-center gap-5">
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
        <p role="status" className="mb-3 bg-raised px-3 py-2 text-[13px] text-ink">
          Waiting for the browser&rsquo;s microphone permission.
        </p>
      )}
      {micError && (
        <p role="alert" className="mb-3 bg-raised px-3 py-2 text-[13px] text-ink">
          {micError}
        </p>
      )}
      {sourceMode === "mic" && (
        <p role="status" className="mb-3 flex items-center gap-2.5 bg-raised px-3 py-2 text-[13px] text-ink">
          <span className="mark bg-accent!" aria-hidden />
          Microphone on. Hold a vowel for a second or two; nothing you say is recorded or sent.
        </p>
      )}

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
            label="Vowel chart: first formant against second, with eight reference vowels, the live position and its trail"
            onPick={(id) => selectTarget(id, sourceMode !== "mic")}
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
          <Trace kind="spectrum" inspect label="Magnitude spectrum with the linear-prediction envelope and formant markers" className={`w-full ${plotHeight || "h-[220px] lg:h-[clamp(150px,20svh,240px)]"}`} />
        </Panel>

        <Panel view="poles" title="Z-plane" kind="derived" className="col-span-12 lg:col-span-3">
          <Trace kind="zplane" inspect label="Poles of the vocal-tract model inside the unit circle" className={`w-full ${plotHeight || "h-[260px] lg:h-[clamp(150px,20svh,240px)]"}`} />
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
