"use client";

import type { ReactNode } from "react";
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
      <div role="group" aria-label="Vowel" className="grid grid-cols-4 gap-1 sm:grid-cols-9">
        {VOWEL_TARGETS.map((v) => {
          const pressed = !tour && v.id === targetId;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={pressed}
              aria-label={`${v.label} ${v.symbol}`}
              onClick={() => selectTarget(v.id, !liveInput)}
              className="group flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-(--radius-sm) bg-raised transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.96]"
            >
              <span
                lang={v.banglaSymbol ? "bn" : undefined}
                className="ui-tab bn min-h-0! pb-1 text-[24px] leading-none font-medium"
                data-on={pressed}
              >
                {v.banglaSymbol ?? v.symbol}
              </span>
              <span className="text-[13px] text-muted">/{v.symbol}/</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={tour}
          disabled={liveInput}
          onClick={() => updateSynth({ tour: !tour })}
          className="col-span-4 flex min-h-11 items-center justify-center rounded-(--radius-sm) bg-raised transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.96] disabled:opacity-45 sm:col-span-1 sm:min-h-16"
        >
          <span className="ui-tab min-h-6! text-[13px] font-medium" data-on={tour}>
            Tour all
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Where the signal comes from. "Built-in" is the synthetic voice or a test signal, computed in the tab;
 * the other two ask the browser for a live input. Sound is a separate key, because the built-in
 * source is analysed silently until you want to hear it.
 */
export function SourceSwitch({ className }: { className?: string }) {
  const sourceMode = useLabStore((s) => s.sourceMode);
  const micStatus = useLabStore((s) => s.micStatus);
  const setSourceMode = useLabStore((s) => s.setSourceMode);
  const builtIn = sourceMode === "silent" || sourceMode === "synth";
  const aloud = sourceMode === "synth";
  const busy = micStatus === "requesting";

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <div role="radiogroup" aria-label="Signal source" className="seg">
        <button
          type="button"
          role="radio"
          aria-checked={builtIn}
          disabled={busy}
          onClick={() => {
            if (!builtIn) void setSourceMode("silent");
          }}
        >
          Built-in
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={sourceMode === "mic"}
          data-hot={sourceMode === "mic"}
          disabled={busy}
          onClick={() => void setSourceMode(sourceMode === "mic" ? "silent" : "mic")}
        >
          Microphone
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={sourceMode === "stream"}
          data-hot={sourceMode === "stream"}
          disabled={busy}
          title="Analyse the sound of another browser tab"
          onClick={() => void setSourceMode(sourceMode === "stream" ? "silent" : "stream")}
        >
          Tab audio
        </button>
      </div>
      {builtIn && (
        <div className="seg">
          <button
            type="button"
            aria-pressed={aloud}
            title="Play the built-in source through your speakers"
            onClick={() => void setSourceMode(aloud ? "silent" : "synth")}
          >
            {aloud ? "Sound on" : "Sound off"}
          </button>
        </div>
      )}
    </div>
  );
}
