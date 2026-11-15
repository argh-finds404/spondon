"use client";

import Link from "next/link";
import { Prov, VowelKeys } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Reveal } from "@/components/site/Reveal";
import { findVowel, VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { useLabStore } from "@/store/lab-store";

/** The one live thing: press a vowel, hear it, watch the dot land and the sand redraw. */
export function VowelInstrument() {
  const targetId = useLabStore((s) => s.targetId);
  const tour = useLabStore((s) => s.synth.tour);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const setSourceMode = useLabStore((s) => s.setSourceMode);
  const vowel = findVowel(targetId);
  const playing = sourceMode === "synth";

  return (
    <Reveal as="section" id="instrument" className="section wrap grid12 gap-y-10">
      <div className="col-span-12 lg:col-span-5">
        <h2 className="t-head reveal">Eight vowels, eight figures.</h2>
        <p className="t-lead reveal mt-6 max-w-[34ch] text-ink" style={{ "--i": 1 } as React.CSSProperties}>
          Press a key. The voice holds that vowel, the dot settles on its place in the chart, and the sand redraws
          itself.
        </p>
        <div data-ui className="ui-panel reveal mt-8 max-w-[440px]" style={{ "--i": 2 } as React.CSSProperties}>
          <PlateStage showNodalLines className="aspect-square w-full" />
          <p className="flex items-center justify-between gap-4 border-t border-line px-3 py-2.5 text-ink">
            <Prov kind="mapped">Mapped from F1 and F2</Prov>
            <span className="ui-fig text-[12px]">
              m <Readout field="modeM" /> · n <Readout field="modeN" />
            </span>
          </p>
        </div>
      </div>

      <div className="reveal col-span-12 lg:col-span-7" style={{ "--i": 2 } as React.CSSProperties}>
        <div data-ui className="ui-panel">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-4">
              <span lang={vowel.banglaSymbol ? "bn" : undefined} className="bn text-[44px] leading-none font-medium text-ink">
                {vowel.banglaSymbol ?? vowel.symbol}
              </span>
              <span>
                <span className="block text-[14px] font-medium text-ink">
                  /{vowel.symbol}/ · {vowel.label}
                </span>
                <span className="ui-label block">
                  {tour ? "Target. The voice is touring all eight." : "Target, and the vowel the voice is holding."}
                </span>
              </span>
            </div>
            <dl className="flex gap-6">
              <div>
                <dt className="ui-label">
                  <Prov kind="derived">F1</Prov>
                </dt>
                <dd className="ui-fig text-[13px] text-ink">
                  <Readout field="f1" /> Hz
                </dd>
              </div>
              <div>
                <dt className="ui-label">
                  <Prov kind="derived">F2</Prov>
                </dt>
                <dd className="ui-fig text-[13px] text-ink">
                  <Readout field="f2" /> Hz
                </dd>
              </div>
              <div>
                <dt className="ui-label">From target</dt>
                <dd className="ui-fig text-[13px] text-ink">
                  <Readout field="bark" /> Bark
                </dd>
              </div>
            </dl>
          </div>
          <Trace
            kind="vowel"
            label="Vowel chart: first formant against second, with the eight reference vowels, the live position and its trail"
            onPick={(id) => selectTarget(id, sourceMode !== "mic")}
            className="h-[min(56svh,440px)] w-full"
          />
          <VowelKeys className="border-t border-line p-0.5" />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="button" className="btn" onClick={() => void setSourceMode(playing ? "silent" : "synth")}>
            {playing ? "Stop the sound" : "Play it aloud"}
          </button>
          <button
            type="button"
            aria-pressed={sourceMode === "mic"}
            className="btn"
            onClick={() => void setSourceMode(sourceMode === "mic" ? "silent" : "mic")}
          >
            {sourceMode === "mic" ? "Stop microphone" : "Use microphone"}
          </button>
          <Link href="/vowels" className="link t-small font-medium">
            The vowel atlas
          </Link>
          <p className="t-small text-muted">
            <Prov kind="reference">
              Reference: F1 {vowel.targetF1}, F2 {vowel.targetF2} Hz
            </Prov>
          </p>
        </div>
        <noscript>
          <p className="t-small mt-4 text-muted">
            Without script, each vowel can still be heard as a file:{" "}
            {VOWEL_TARGETS.map((v) => (
              <a key={v.id} className="link mr-3" href={`/api/synth?vowel=${v.id}&duration=1.5`}>
                /{v.symbol}/
              </a>
            ))}
          </p>
        </noscript>
      </div>
    </Reveal>
  );
}
