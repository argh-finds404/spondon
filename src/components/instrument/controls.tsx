"use client";

import type { ReactNode } from "react";
import type { SourceMode } from "@/lib/dsp/audio-controller";
import { VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { useLabStore } from "@/store/lab-store";

/**
 * Where a number comes from. Measured: read off the signal. Derived: computed from a model fitted
 * to the signal. Mapped: a drawing rule, not a measurement. Reference: a textbook value.
 */
export type Provenance = "measured" | "derived" | "mapped" | "reference";

const MARK_CLASS: Record<Provenance, string> = {
  measured: "mark",
  derived: "mark mark-derived",
  mapped: "mark mark-mapped",
  reference: "mark mark-reference",
};

export const PROVENANCE_WORD: Record<Provenance, string> = {
  measured: "Measured",
  derived: "Derived",
  mapped: "Mapped",
  reference: "Reference",
};

export function Prov({ kind, children }: { kind: Provenance; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={MARK_CLASS[kind]} aria-hidden />
      {children ?? PROVENANCE_WORD[kind]}
    </span>
  );
}

/** Eight keys, one per reference vowel. Pressing one holds the synthetic voice on it and makes it the target. */
export function VowelKeys({ className }: { className?: string }) {
  const targetId = useLabStore((s) => s.targetId);
  const tour = useLabStore((s) => s.synth.tour);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const updateSynth = useLabStore((s) => s.updateSynth);
  const liveInput = sourceMode === "mic" || sourceMode === "stream";

  return (
    <div data-ui className={className}>
      <div role="group" aria-label="Vowel" className="grid grid-cols-4 gap-0.5 sm:grid-cols-9">
        {VOWEL_TARGETS.map((v) => {
          const pressed = !tour && v.id === targetId;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={pressed}
              aria-label={`${v.label} ${v.symbol}`}
              onClick={() => selectTarget(v.id, !liveInput)}
              className="group flex min-h-16 flex-col items-center justify-center gap-0.5 bg-raised transition-[background-color,transform] duration-150 hover:bg-[#20242d] active:scale-[0.97]"
            >
              <span
                lang={v.banglaSymbol ? "bn" : undefined}
                className="ui-tab bn min-h-0! pb-1 text-[24px] leading-none font-medium"
                data-on={pressed}
              >
                {v.banglaSymbol ?? v.symbol}
              </span>
              <span className="text-[12px] text-muted">/{v.symbol}/</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={tour}
          disabled={liveInput}
          onClick={() => updateSynth({ tour: !tour })}
          className="col-span-4 flex min-h-11 items-center justify-center bg-raised transition-[background-color,transform] duration-150 hover:bg-[#20242d] active:scale-[0.97] disabled:opacity-45 sm:col-span-1 sm:min-h-16"
        >
          <span className="ui-tab min-h-6! text-[13px] font-medium" data-on={tour}>
            Tour all
          </span>
        </button>
      </div>
    </div>
  );
}

const SOURCES: { mode: SourceMode; label: string; hint: string }[] = [
  { mode: "silent", label: "Silent", hint: "Synthetic voice, analysed without sound" },
  { mode: "synth", label: "Play synth", hint: "Synthetic voice through your speakers" },
  { mode: "mic", label: "Microphone", hint: "Your own voice" },
  { mode: "stream", label: "Tab / YouTube", hint: "Share a browser tab with audio (YouTube, Spotify, recordings)" },
];

export function SourceSwitch({ className }: { className?: string }) {
  const sourceMode = useLabStore((s) => s.sourceMode);
  const micStatus = useLabStore((s) => s.micStatus);
  const setSourceMode = useLabStore((s) => s.setSourceMode);

  return (
    <div role="radiogroup" aria-label="Signal source" className={`flex items-center gap-5 ${className ?? ""}`}>
      {SOURCES.map((source) => (
        <button
          key={source.mode}
          type="button"
          role="radio"
          aria-checked={sourceMode === source.mode}
          title={source.hint}
          disabled={micStatus === "requesting"}
          onClick={() => void setSourceMode(source.mode)}
          className="ui-tab min-h-11 text-[13px] font-medium whitespace-nowrap lg:min-h-8"
        >
          {source.label}
        </button>
      ))}
    </div>
  );
}
