"use client";

import { useEffect, useRef } from "react";
import { chladniModes } from "@/lib/chladni";
import { nearestVowel, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { WINDOW_INFO } from "@/lib/dsp/windows";
import { labRuntime } from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";

const NONE = "—";
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const modes = { m: 0, n: 0 };

/** Nearest equal-tempered note and the offset from it in cents, A4 = 440 Hz. */
export function noteOf(hz: number): string {
  if (!(hz > 0)) return NONE;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  return `${NOTES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1} ${cents < 0 ? "−" : "+"}${Math.abs(cents)}¢`;
}

const hasFormants = (t: DSPFrameTelemetry) => t.formants.confidence > 0.05 && t.formants.f1 > 0;
const hz = (v: number, ok: boolean) => (ok && v > 0 ? Math.round(v).toString() : NONE);

function formantPole(t: DSPFrameTelemetry, index: number) {
  for (const p of t.zPlanePoles) if (p.formantIndex === index && p.im >= 0) return p;
  return null;
}

/** Every live number on the site is one of these: a field of the engine's telemetry, formatted. */
const FIELDS = {
  f0: (t) => (t.voiced ? t.stability.f0Hz.toFixed(1) : NONE),
  note: (t) => (t.voiced ? noteOf(t.stability.f0Hz) : NONE),
  period: (t) => (t.voiced ? (1000 / t.stability.f0Hz).toFixed(2) : NONE),
  clarity: (t) => t.stability.pitchConfidence.toFixed(2),
  f1: (t) => hz(t.formants.f1, hasFormants(t)),
  f2: (t) => hz(t.formants.f2, hasFormants(t)),
  f3: (t) => hz(t.formants.f3, hasFormants(t)),
  b1: (t) => hz(t.formants.b1, hasFormants(t)),
  b2: (t) => hz(t.formants.b2, hasFormants(t)),
  b3: (t) => hz(t.formants.b3, hasFormants(t)),
  jitter: (t) => (t.voiced ? t.stability.jitterPercent.toFixed(2) : NONE),
  shimmer: (t) => (t.voiced ? t.stability.shimmerDb.toFixed(2) : NONE),
  level: (t) => (t.stability.rmsDb > -119 ? t.stability.rmsDb.toFixed(1) : NONE),
  syllables: (t) => t.stability.syllablesPerSec.toFixed(1),
  vowel: (t) => (hasFormants(t) ? vowelGlyph(nearestVowel(t.formants.f1, t.formants.f2)) : NONE),
  bark: (t) => (hasFormants(t) ? t.activeTargetMatch.distanceBark.toFixed(2) : NONE),
  score: (t) => (hasFormants(t) ? Math.round(t.activeTargetMatch.convergenceScore).toString() : NONE),
  guidance: (t) => t.activeTargetMatch.guidance,
  modeM: (t) => (hasFormants(t) ? chladniModes(t.formants.f1, t.formants.f2, modes).m.toFixed(2) : NONE),
  modeN: (t) => (hasFormants(t) ? chladniModes(t.formants.f1, t.formants.f2, modes).n.toFixed(2) : NONE),
  sampleRate: (t) => Math.round(t.sampleRate).toLocaleString("en-US"),
  analysisRate: (t) => Math.round(t.analysisRate).toLocaleString("en-US"),
  window: (t) => WINDOW_INFO[t.windowType].label,
  poleRadius: (t) => formantPole(t, 1)?.magnitude.toFixed(3) ?? NONE,
  poleAngle: (t) => formantPole(t, 1)?.angleRad.toFixed(3) ?? NONE,
  order: (t) => t.lpcCoefficients.length.toString(),
  binHz: (t) => (t.analysisRate / (2 * t.fftMagnitudeDb.length)).toFixed(1),
  frameMs: (t) => ((1000 * t.timeDomainRaw.length) / t.analysisRate).toFixed(1),
  regime: (t) => t.regime?.label ?? NONE,
  regimeDetail: (t) => t.regime?.detail ?? NONE,
  centroid: (t) => (t.regime && t.regime.spectralCentroidHz > 0 ? Math.round(t.regime.spectralCentroidHz).toString() : NONE),
  flatness: (t) => (t.regime && t.stability.rmsDb > -58 ? (t.regime.spectralFlatness * 100).toFixed(0) : NONE),
  tractLength: (t) => (t.regime && t.regime.vocalTractLengthCm > 0 ? t.regime.vocalTractLengthCm.toFixed(1) : NONE),
  glideSpeed: (t) => (t.regime && t.regime.trajectorySpeedHzPerSec > 25 ? Math.round(t.regime.trajectorySpeedHzPerSec).toString() : "0"),
  cepstralF0: (t) => (t.regime && t.regime.cepstralF0Hz > 0 ? t.regime.cepstralF0Hz.toFixed(1) : NONE),
  antiZero: (t) => (t.regime && t.regime.antiResonanceHz > 0 ? Math.round(t.regime.antiResonanceHz).toString() : NONE),
} satisfies Record<string, (t: DSPFrameTelemetry) => string>;

export type ReadoutField = keyof typeof FIELDS;

/** Digits that change sixty times a second cannot be read; a bench meter refreshes about ten. */
const EVERY = 6;

export function Readout({ field, className }: { field: ReadoutField; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let shown = "";
    return labRuntime.subscribe((t) => {
      if (frame++ % EVERY !== 0) return;
      const text = FIELDS[field](t);
      if (text !== shown) {
        shown = text;
        el.textContent = text;
      }
    });
  }, [field]);

  return (
    <span ref={ref} className={className}>
      {NONE}
    </span>
  );
}
