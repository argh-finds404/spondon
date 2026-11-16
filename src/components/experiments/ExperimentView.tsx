"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Eq } from "@/components/docs/math";
import { Prov } from "@/components/instrument/controls";
import { Trace } from "@/components/instrument/Trace";
import { chladniModes } from "@/lib/chladni";
import { nearestVowel, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";
import {
  computeHighBandTiltDb,
  computeSidelobeFloorDb,
  labRuntime,
  useLabStore,
  type ExperimentBaselineSnapshot,
} from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";
import { EXPERIMENTS, type Experiment } from "./experiments";

type Reading = (t: DSPFrameTelemetry) => number;
type Saved = (b: ExperimentBaselineSnapshot) => number;

interface MetricSpec {
  label: string;
  unit: string;
  digits: number;
  now: Reading;
  before: Saved;
  /** Frame-to-frame wobble of this reading: smaller differences are not shown as a change. */
  still: number;
}

const formant = (k: "f1" | "f2" | "f3"): MetricSpec => ({
  label: k.toUpperCase(),
  unit: "Hz",
  digits: 0,
  still: 6,
  now: (t) => t.formants[k],
  before: (b) => b[k],
});

function pole(t: DSPFrameTelemetry, index: 1 | 2) {
  for (const p of t.zPlanePoles) if (p.formantIndex === index && p.im >= 0) return p;
  return null;
}

const METRICS: Record<Experiment["id"], MetricSpec[]> = {
  1: [
    { label: "Floor between harmonics", unit: "dB", digits: 1, still: 1, now: (t) => computeSidelobeFloorDb(t.fftMagnitudeDb), before: (b) => b.sidelobeFloorDb },
    formant("f1"),
    formant("f2"),
  ],
  2: [
    { label: "High band against low band", unit: "dB", digits: 1, still: 1, now: (t) => computeHighBandTiltDb(t.fftMagnitudeDb), before: (b) => b.highBandTiltDb },
    formant("f2"),
    formant("f3"),
  ],
  3: [formant("f1"), formant("f2"), formant("f3")],
  4: [
    { label: "Pitch", unit: "Hz", digits: 1, still: 0.5, now: (t) => t.stability.f0Hz, before: (b) => b.f0Hz },
    { label: "Period", unit: "ms", digits: 2, still: 0.03, now: (t) => (t.stability.f0Hz > 0 ? 1000 / t.stability.f0Hz : 0), before: (b) => (b.f0Hz > 0 ? 1000 / b.f0Hz : 0) },
    formant("f1"),
  ],
  5: [
    { label: "F1 pole radius", unit: "", digits: 3, still: 0.002, now: (t) => pole(t, 1)?.magnitude ?? 0, before: (b) => b.pole1Radius },
    formant("f1"),
    { label: "F1 bandwidth", unit: "Hz", digits: 0, still: 6, now: (t) => pole(t, 1)?.bandwidthHz ?? 0, before: (b) => b.b1 },
  ],
};

/**
 * One measurement, before and now. Written straight into the page about ten times a second;
 * the numbers move with the voice but never re-render React.
 */
function Metric({ spec }: { spec: MetricSpec }) {
  const nowRef = useRef<HTMLSpanElement>(null);
  const beforeRef = useRef<HTMLSpanElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const specRef = useRef(spec);
  useEffect(() => {
    specRef.current = spec;
  });

  useEffect(() => {
    let frame = 0;
    const fmt = (v: number) => (Number.isFinite(v) && v !== 0 ? v.toFixed(specRef.current.digits) : "—");
    return labRuntime.subscribe((t) => {
      if (frame++ % 6) return;
      const s = specRef.current;
      const base = labRuntime.getExperimentBaseline();
      const now = s.now(t);
      if (nowRef.current) nowRef.current.textContent = fmt(now);
      if (beforeRef.current) beforeRef.current.textContent = base ? fmt(s.before(base)) : "—";
      if (deltaRef.current) {
        const d = base ? now - s.before(base) : 0;
        const show = base && now !== 0 && s.before(base) !== 0 && Math.abs(d) >= s.still;
        deltaRef.current.textContent = show ? `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(s.digits)}` : "";
      }
    });
  }, []);

  return (
    <div className="rounded-(--radius-sm) bg-surface px-4 py-3.5">
      <dt className="text-[14px] text-muted">{spec.label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-2.5">
        <span className="ui-fig text-[24px] leading-none text-ink">
          <span ref={nowRef}>—</span>
          {spec.unit && <span className="ml-1 text-[14px] text-muted">{spec.unit}</span>}
        </span>
        <span ref={deltaRef} className="ui-fig text-[15px] font-semibold text-accent" />
      </dd>
      <dd className="ui-fig mt-1.5 text-[13px] text-muted">
        normal <span ref={beforeRef}>—</span>
      </dd>
    </div>
  );
}

function Control({ id, selectedPole, setSelectedPole }: { id: Experiment["id"]; selectedPole: 1 | 2; setSelectedPole: (p: 1 | 2) => void }) {
  const options = useLabStore((s) => s.analyzerOptions);
  const update = useLabStore((s) => s.updateAnalyzerOptions);
  const synth = useLabStore((s) => s.synth);
  const updateSynth = useLabStore((s) => s.updateSynth);
  const live = useLabStore((s) => s.sourceMode === "mic" || s.sourceMode === "stream");

  if (id === 1) {
    const info = WINDOW_INFO[options.windowType];
    return (
      <>
        <div className="seg flex-wrap" role="radiogroup" aria-label="Window">
          {WINDOW_TYPES.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={options.windowType === w} data-hot={w === "rectangular" && options.windowType === w} onClick={() => update({ windowType: w })}>
              {WINDOW_INFO[w].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[15px] text-muted">
          {info.label}: highest sidelobe {info.peakSidelobeDb.toFixed(1)} dB, main lobe {info.mainLobeBins} bins wide.
        </p>
      </>
    );
  }
  if (id === 2) {
    return (
      <div className="seg" role="radiogroup" aria-label="Pre-emphasis">
        <button type="button" role="radio" aria-checked={options.preEmphasis > 0} onClick={() => update({ preEmphasis: 0.97 })}>
          On, α = 0.97
        </button>
        <button type="button" role="radio" aria-checked={options.preEmphasis === 0} data-hot={options.preEmphasis === 0} onClick={() => update({ preEmphasis: 0 })}>
          Off, α = 0
        </button>
      </div>
    );
  }
  if (id === 3) {
    const p = options.lpcOrder;
    const verdict = p < 8 ? "Too few: formants merge." : p <= 14 ? "About right for a 12 kHz voice." : p <= 18 ? "Generous: an extra peak or ripple may appear." : "Too many: the envelope follows the harmonics.";
    return (
      <>
        <label className="block max-w-[420px]">
          <span className="flex items-baseline justify-between">
            <span className="text-[15px] text-muted">Model order</span>
            <span className="ui-fig text-[18px] text-ink">{p} poles</span>
          </span>
          <input type="range" className="ui-slider mt-2" min={4} max={24} step={2} value={p} onChange={(e) => update({ lpcOrder: Number(e.target.value) })} />
        </label>
        <div className="seg mt-3">
          {[4, 12, 24].map((n) => (
            <button key={n} type="button" aria-pressed={p === n} onClick={() => update({ lpcOrder: n })}>
              {n}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[15px] text-ink">{verdict}</p>
      </>
    );
  }
  if (id === 4) {
    return (
      <>
        <label className="block max-w-[420px]">
          <span className="flex items-baseline justify-between">
            <span className="text-[15px] text-muted">Pitch of the synthetic voice</span>
            <span className="ui-fig text-[18px] text-ink">{Math.round(synth.f0Hz)} Hz</span>
          </span>
          <input
            type="range"
            className="ui-slider mt-2"
            min={80}
            max={320}
            step={5}
            value={synth.f0Hz}
            disabled={live}
            onChange={(e) => updateSynth({ f0Hz: Number(e.target.value), tour: false })}
          />
        </label>
        {live && <p className="mt-3 text-[15px] text-muted">With your microphone on, sing higher and lower instead.</p>}
      </>
    );
  }
  // Experiment 5: choose a pole, drag it on the plot, or use a preset.
  const setPole = (index: 1 | 2, radius: number | null, freqHz: number | null) => {
    const t = labRuntime.getActiveTelemetry();
    const now = pole(t, index);
    const r = radius ?? now?.magnitude ?? 0.95;
    const f = freqHz ?? now?.freqHz ?? (index === 1 ? 700 : 1200);
    const theta = (2 * Math.PI * f) / (t.analysisRate || 12000);
    setSelectedPole(index);
    labRuntime.setPoleOverride(index, r * Math.cos(theta), r * Math.sin(theta));
    useLabStore.setState({ baselineVersion: useLabStore.getState().baselineVersion + 1 });
  };
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Pole to move">
        {([1, 2] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={selectedPole === k} onClick={() => setSelectedPole(k)}>
            F{k} pole
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPole(1, 0.99, null)}>
          Sharpen F1
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPole(1, 0.88, null)}>
          Blur F1
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPole(2, null, 2280)}>
          F2 to /iː/
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPole(2, null, 870)}>
          F2 to /uː/
        </button>
      </div>
    </>
  );
}

/** Nearest vowel and plate modes, now and normal. Low-rate DOM writes, like Metric. */
function VowelLine() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const modes = { m: 0, n: 0 };
    return labRuntime.subscribe((t) => {
      if (frame++ % 6 || !ref.current) return;
      if (!(t.formants.f1 > 0 && t.formants.f2 > 0)) return;
      const v = nearestVowel(t.formants.f1, t.formants.f2);
      chladniModes(t.formants.f1, t.formants.f2, modes);
      const base = labRuntime.getExperimentBaseline();
      const was = base && base.f1 > 0 ? vowelGlyph(nearestVowel(base.f1, base.f2)) : null;
      ref.current.textContent = `${vowelGlyph(v)}${was && was !== vowelGlyph(v) ? ` (was ${was})` : ""} · plate modes m ${modes.m.toFixed(2)}, n ${modes.n.toFixed(2)}`;
    });
  }, []);
  return (
    <p className="text-[15px] text-muted">
      <Prov kind="derived">Nearest vowel</Prov>{" "}
      <span ref={ref} lang="bn" className="bn text-ink">
        —
      </span>
    </p>
  );
}

/**
 * One experiment, one page. Arriving holds the voice on its current vowel and, after a moment, keeps that
 * frame as the dashed "normal" baseline; every change is then measured against it. Leaving puts the
 * setting back, so the lab is never left broken.
 */
export function ExperimentView({ id }: { id: Experiment["id"] }) {
  const exp = EXPERIMENTS[id - 1];
  const prev = EXPERIMENTS[id - 2];
  const next = EXPERIMENTS[id];
  const [selectedPole, setSelectedPole] = useState<1 | 2>(1);
  const resetExperiment = useLabStore((s) => s.resetExperiment);
  const capture = useLabStore((s) => s.captureExperimentBaseline);

  useEffect(() => {
    useLabStore.getState().setActiveExperiment(id);
    // Let the held vowel settle for a few frames before keeping it as the normal reference.
    const timer = setTimeout(() => useLabStore.getState().captureExperimentBaseline("Normal setting"), 700);
    return () => {
      clearTimeout(timer);
      useLabStore.getState().resetExperiment(id);
    };
  }, [id]);

  const reset = () => {
    resetExperiment(id);
    setTimeout(() => capture("Normal setting"), 500);
  };

  return (
    <main id="content" className="wrap pt-(--nav-h) pb-(--section)">
      <header className="grid12 items-end gap-y-5 pt-[calc(var(--section)/2.5)] pb-8">
        <div className="col-span-12 lg:col-span-7">
          <p className="text-[15px] font-semibold text-accent">
            Experiment {exp.id} of 5 · {exp.stage}
          </p>
          <h1 className="t-head mt-2">{exp.title}</h1>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <p className="t-lead text-ink">{exp.task}</p>
        </div>
      </header>

      <div className="grid12 gap-y-6">
        <section aria-label="Controls and measurements" className="col-span-12 flex flex-col gap-5 lg:col-span-4">
          <div className="rounded-(--radius) bg-raised p-5">
            <h2 className="mb-3 text-[17px] font-semibold text-ink">Break it</h2>
            <Control id={id} selectedPole={selectedPole} setSelectedPole={setSelectedPole} />
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="btn btn-quiet btn-sm" onClick={reset}>
                Back to normal
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => capture("Chosen moment")}>
                Use this moment as normal
              </button>
            </div>
          </div>
          <dl className="grid gap-3">
            {METRICS[id].map((spec) => (
              <Metric key={spec.label} spec={spec} />
            ))}
          </dl>
        </section>

        <section aria-label="What it does" className="col-span-12 flex flex-col gap-4 lg:col-span-8">
          <figure data-ui className="ui-panel">
            <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line px-4 py-3 text-[14px]">
              <span className="font-semibold text-ink">{id === 5 ? "The poles, inside the unit circle" : "Spectrum and envelope"}</span>
              <span className="flex items-center gap-2 text-muted">
                <span className="h-0.5 w-5 border-t-2 border-dashed border-muted" aria-hidden />
                dashed: normal setting
              </span>
            </figcaption>
            <Trace
              kind={id === 5 ? "zplane" : "spectrum"}
              inspect
              compareBaseline
              draggablePoles={id === 5}
              selectedPoleFormant={selectedPole}
              onPoleSelect={setSelectedPole}
              label={id === 5 ? "Poles of the vocal-tract model; drag F1 or F2" : "Spectrum with the envelope, now and at the normal setting"}
              className="h-[clamp(300px,46svh,440px)] w-full"
            />
          </figure>
          {(id === 4 || id === 5) && (
            <figure data-ui className="ui-panel">
              <figcaption className="border-b border-line px-4 py-3 text-[14px] font-semibold text-ink">
                {id === 4 ? "The wave: one mark per pitch period" : "Spectrum and envelope"}
              </figcaption>
              <Trace
                kind={id === 4 ? "pitch" : "spectrum"}
                compareBaseline={id === 5}
                label={id === 4 ? "The voice wave with a mark at each pitch period" : "Spectrum with the envelope"}
                className="h-[200px] w-full"
              />
            </figure>
          )}
          <VowelLine />
        </section>
      </div>

      <section aria-labelledby="why" className="grid12 mt-12 gap-y-5">
        <div className="col-span-12 lg:col-span-6">
          <h2 id="why" className="text-[clamp(1.5rem,2.2vw,2rem)] leading-[1.15] font-[600] tracking-[-0.02em]">
            Why it happens
          </h2>
          <p className="t-body mt-4 text-ink">{exp.why}</p>
          <p className="t-body mt-4 text-muted">
            <span className="font-semibold text-ink">Look for:</span> {exp.watch}
          </p>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <Eq ml={exp.formula.ml} label={exp.formula.label} />
        </div>
      </section>

      <nav aria-label="Other experiments" className="mt-12 flex flex-wrap items-center justify-between gap-3">
        {prev ? (
          <Link href={`/experiments/${prev.id}`} className="btn btn-quiet">
            ← {prev.stage}
          </Link>
        ) : (
          <Link href="/experiments" className="btn btn-quiet">
            ← All experiments
          </Link>
        )}
        {next ? (
          <Link href={`/experiments/${next.id}`} className="btn">
            Next: {next.stage} →
          </Link>
        ) : (
          <Link href="/lab/trace" className="btn">
            Trace a frame stage by stage →
          </Link>
        )}
      </nav>
    </main>
  );
}
