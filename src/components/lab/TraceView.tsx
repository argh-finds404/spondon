"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Eq } from "@/components/docs/math";
import { Prov } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Trace } from "@/components/instrument/Trace";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";
import { labRuntime, useLabStore, type TraceStageId } from "@/store/lab-store";
import { TRACE_STAGES, type StageSpec } from "./stages";

const hz = (v: number) => (v > 0 ? `${Math.round(v)} Hz` : "—");
const noop = () => () => {};
/** True in the browser, false while rendering on the server: the held frame only exists in the browser. */
const useInBrowser = () => useSyncExternalStore(noop, () => true, () => false);

function Plot({ title, sub, kind, compare }: { title: string; sub: string; kind: StageSpec["afterTrace"]; compare: boolean }) {
  return (
    <figure data-ui className="ui-panel flex min-w-0 flex-col">
      <figcaption className="border-b border-line px-4 py-3">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] text-muted">{sub}</span>
      </figcaption>
      {kind === "plate" ? (
        <PlateStage interactive showNodalLines className="h-[280px] w-full" />
      ) : (
        <Trace kind={kind} inspect compareBaseline={compare} label={title} className="h-[280px] w-full" />
      )}
    </figure>
  );
}

function Control({ spec }: { spec: StageSpec }) {
  const options = useLabStore((s) => s.analyzerOptions);
  const update = useLabStore((s) => s.updateAnalyzerOptions);
  if (spec.control === "preEmphasis") {
    return (
      <div className="seg" role="radiogroup" aria-label="Pre-emphasis">
        <button type="button" role="radio" aria-checked={options.preEmphasis > 0} onClick={() => update({ preEmphasis: 0.97 })}>
          On, α = 0.97
        </button>
        <button type="button" role="radio" aria-checked={options.preEmphasis === 0} data-hot={options.preEmphasis === 0} onClick={() => update({ preEmphasis: 0 })}>
          Off
        </button>
      </div>
    );
  }
  if (spec.control === "window") {
    const info = WINDOW_INFO[options.windowType];
    return (
      <div>
        <div className="seg flex-wrap" role="radiogroup" aria-label="Window">
          {WINDOW_TYPES.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={options.windowType === w} onClick={() => update({ windowType: w })}>
              {WINDOW_INFO[w].label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[14px] text-muted">
          Highest sidelobe {info.peakSidelobeDb.toFixed(1)} dB, main lobe {info.mainLobeBins} bins wide.
        </p>
      </div>
    );
  }
  if (spec.control === "order") {
    return (
      <label className="block max-w-[360px]">
        <span className="flex items-baseline justify-between">
          <span className="text-[14px] text-muted">Model order</span>
          <span className="ui-fig text-[15px] text-ink">{options.lpcOrder} poles</span>
        </span>
        <input
          type="range"
          className="ui-slider mt-1"
          min={4}
          max={24}
          step={2}
          value={options.lpcOrder}
          onChange={(e) => update({ lpcOrder: Number(e.target.value) })}
        />
      </label>
    );
  }
  return null;
}

/** The numbers behind stages 6 and 7, read from the held frame. Re-rendered only when the frame is recomputed. */
function Numbers({ stage }: { stage: TraceStageId }) {
  useLabStore((s) => s.recomputeCount);
  const inBrowser = useInBrowser();
  if (!inBrowser) return null;
  const t = labRuntime.getActiveTelemetry();
  const sb = t.stageBuffers;
  if (stage === 6) {
    return (
      <p className="ui-fig text-[13px] leading-relaxed break-words text-ink">
        G = {sb.lpcGain.toFixed(4)}
        <br />
        {sb.lpcCoeffs.map((a, i) => `a${i + 1} = ${a.toFixed(3)}`).join(",  ")}
      </p>
    );
  }
  const poles = sb.allPoles.filter((p) => p.im >= 0 && p.radius > 0);
  return (
    <table data-ui className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-line text-muted">
          <th scope="col" className="py-1.5 pr-3 font-normal">Radius</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-normal">Frequency</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-normal">Bandwidth</th>
          <th scope="col" className="py-1.5 font-normal">Taken as</th>
        </tr>
      </thead>
      <tbody>
        {poles.map((p, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            <td className="ui-fig py-1.5 pr-3">{p.radius.toFixed(3)}</td>
            <td className="ui-fig py-1.5 pr-3 text-right">{Math.round(p.freqHz)} Hz</td>
            <td className="ui-fig py-1.5 pr-3 text-right">{Math.round(p.bandwidthHz)} Hz</td>
            <td className={`py-1.5 ${p.selectedAs ? "font-semibold text-accent" : "text-muted"}`}>{p.selectedAs ?? "not a formant"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Formants of the held frame, and of the frame as it was captured when a setting has changed it. */
function Formants() {
  const changed = useLabStore((s) => s.recomputeCount);
  const inBrowser = useInBrowser();
  const now = labRuntime.getActiveTelemetry();
  const was = labRuntime.getBaselineTelemetry();
  const moved = inBrowser && changed > 1 && Math.abs(now.formants.f1 - was.formants.f1) + Math.abs(now.formants.f2 - was.formants.f2) > 1;
  return (
    <dl data-ui className="grid grid-cols-3 gap-3">
      {(["f1", "f2", "f3"] as const).map((k) => (
        <div key={k} className="rounded-(--radius-sm) bg-surface px-3 py-2.5">
          <dt className="ui-label">
            <Prov kind="derived">{k.toUpperCase()}</Prov>
          </dt>
          <dd className="ui-fig mt-1 text-[16px] text-ink">{inBrowser ? hz(now.formants[k]) : "—"}</dd>
          {moved && <dd className="ui-fig text-[13px] text-muted">was {hz(was.formants[k])}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * One frame, held still, walked through the eight stages of the analysis. Arriving freezes the newest
 * frame; leaving puts the lab back exactly as it was: live, with the settings it had.
 */
export function TraceView() {
  const stage = useLabStore((s) => s.traceStage) as TraceStageId;
  const setStage = useLabStore((s) => s.setTraceStage);
  const capture = useLabStore((s) => s.captureAndTrace);
  const spec = TRACE_STAGES[stage - 1];
  const prev = TRACE_STAGES[stage - 2];
  const next = TRACE_STAGES[stage];

  useEffect(() => {
    if (!useLabStore.getState().frozen) useLabStore.getState().captureAndTrace();
    return () => {
      const s = useLabStore.getState();
      s.updateAnalyzerOptions(labRuntime.getBaselineOptions());
      useLabStore.setState({ bypassedStage: null });
      if (s.frozen) s.toggleFreeze();
      s.setTraceOpen(false);
    };
  }, []);

  return (
    <main id="content" className="wrap pt-(--nav-h) pb-(--section)">
      <header className="grid12 items-end gap-y-5 pt-[calc(var(--section)/2.5)] pb-8">
        <h1 className="t-head col-span-12 lg:col-span-7">Trace one frame.</h1>
        <div className="col-span-12 lg:col-span-5">
          <p className="t-lead text-ink">
            A single 43 ms frame is held still. Step through the eight stages it passes through, and change a setting
            to see that same frame recomputed.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-sm" onClick={capture}>
              Hold a new frame
            </button>
            <Link href="/lab" className="btn btn-quiet btn-sm">
              Back to the lab
            </Link>
          </div>
        </div>
      </header>

      <ol aria-label="Stages" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {TRACE_STAGES.map((st) => (
          <li key={st.id}>
            <button
              type="button"
              aria-current={st.id === stage ? "step" : undefined}
              onClick={() => setStage(st.id)}
              className="flex min-h-14 w-full items-center gap-2.5 rounded-(--radius-sm) bg-surface px-3 text-left text-[15px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink aria-[current=step]:bg-ink aria-[current=step]:text-bg"
            >
              <span className="ui-fig text-[13px] opacity-70">{st.id}</span>
              {st.name}
            </button>
          </li>
        ))}
      </ol>

      <section aria-labelledby="stage-title" className="grid12 mt-8 gap-y-8">
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-4">
          <h2 id="stage-title" className="text-[clamp(1.6rem,2.4vw,2.25rem)] leading-[1.1] font-[600] tracking-[-0.025em]">
            {spec.title}
          </h2>
          <p className="text-[15px] text-muted">
            <Prov kind={spec.kind} />
          </p>
          <p className="t-body text-ink">{spec.why}</p>
          <Eq ml={spec.formula.ml} label={spec.formula.label} />
          {spec.control && (
            <div>
              <p className="mb-2 text-[15px] font-semibold text-ink">Change it, on this same frame</p>
              <Control spec={spec} />
            </div>
          )}
        </div>

        <div className="col-span-12 flex flex-col gap-4 lg:col-span-8">
          <div className="grid gap-4 md:grid-cols-2">
            <Plot title={`In: ${spec.beforeTitle}`} sub={spec.beforeSub} kind={spec.beforeTrace} compare={stage === 8} />
            <Plot title={`Out: ${spec.afterTitle}`} sub={spec.afterSub} kind={spec.afterTrace} compare />
          </div>
          <Formants />
          {(stage === 6 || stage === 7) && (
            <details className="rounded-(--radius-sm) bg-surface p-4">
              <summary className="cursor-pointer text-[15px] font-semibold text-ink">
                {stage === 6 ? "The coefficients of this frame" : "Every pole of this frame"}
              </summary>
              <div className="mt-3">
                <Numbers stage={stage} />
              </div>
            </details>
          )}
        </div>
      </section>

      <nav aria-label="Previous and next stage" className="mt-12 flex flex-wrap justify-between gap-3">
        {prev ? (
          <button type="button" className="btn btn-quiet" onClick={() => setStage(prev.id)}>
            ← {prev.name}
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button type="button" className="btn" onClick={() => setStage(next.id)}>
            {next.name} →
          </button>
        ) : (
          <Link href="/experiments" className="btn">
            Now break it: the experiments →
          </Link>
        )}
      </nav>
    </main>
  );
}
