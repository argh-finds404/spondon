"use client";

import { useRef } from "react";
import { Prov, type Provenance } from "@/components/instrument/controls";
import type { TraceKind } from "@/components/instrument/draw";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Tilt } from "@/components/site/Tilt";

const INSTRUMENTS: {
  kind: TraceKind;
  name: string;
  provenance: Provenance;
  text: string;
  picture: string;
  value: { label: string; field: ReadoutField; unit?: string };
}[] = [
  {
    kind: "spectrogram",
    name: "Spectrogram",
    provenance: "measured",
    text: "Time runs left to right, frequency upward, loudness as heat. The cyan trails are the formants being tracked.",
    picture: "Scrolling spectrogram of the voice with formant trails",
    value: { label: "Resolution", field: "binHz", unit: "Hz per bin" },
  },
  {
    kind: "scope",
    name: "Oscilloscope",
    provenance: "measured",
    text: "One frame of the wave before and after the window. The dashed curve is the window itself.",
    picture: "The frame before and after the window",
    value: { label: "Frame", field: "frameMs", unit: "ms" },
  },
  {
    kind: "pitchTrack",
    name: "Pitch track",
    provenance: "measured",
    text: "The fundamental over the last four seconds, on a scale where every octave is the same step.",
    picture: "Pitch of the voice over the last four seconds",
    value: { label: "F0", field: "f0", unit: "Hz" },
  },
  {
    kind: "nsdf",
    name: "Pitch detector",
    provenance: "measured",
    text: "How well the wave matches itself at each delay. The first tall peak is one pitch period.",
    picture: "Normalised square difference function with its chosen peak",
    value: { label: "Clarity", field: "clarity" },
  },
  {
    kind: "spectrum",
    name: "Spectrum and envelope",
    provenance: "derived",
    text: "The Fourier spectrum, the smooth linear-prediction envelope over it, and the three resonances it finds.",
    picture: "Magnitude spectrum with the linear-prediction envelope and formant markers",
    value: { label: "F1", field: "f1", unit: "Hz" },
  },
  {
    kind: "zplane",
    name: "Pole plot",
    provenance: "derived",
    text: "The twelve poles of the vocal-tract model. Angle is frequency; closeness to the circle is sharpness.",
    picture: "Poles of the vocal-tract model inside the unit circle",
    value: { label: "F1 pole radius", field: "poleRadius" },
  },
  {
    kind: "vowel",
    name: "Vowel chart",
    provenance: "derived",
    text: "First formant against second: the map of the tongue that phoneticians draw, with the voice moving on it.",
    picture: "Vowel chart with the live position and its trail",
    value: { label: "From target", field: "bark", unit: "Bark" },
  },
  {
    kind: "samples",
    name: "Sample view",
    provenance: "measured",
    text: "The same wave as the computer holds it: one number every twelve-thousandth of a second.",
    picture: "The wave as discrete samples",
    value: { label: "Analysed at", field: "analysisRate", unit: "Hz" },
  },
  {
    kind: "figure",
    name: "Sand figure",
    provenance: "mapped",
    text: "The two formants choose a standing wave on a plate. A picture of the vowel, not a measurement of it.",
    picture: "Chladni figure for the current vowel",
    value: { label: "Plate mode m", field: "modeM" },
  },
];

/** A bench you walk along sideways: nine instruments, all reading the same voice at once. */
export function InstrumentRail() {
  const rail = useRef<HTMLUListElement>(null);
  const step = (direction: number) => {
    const el = rail.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    el.scrollBy({ left: direction * ((card?.offsetWidth ?? 420) + 24), behavior: "smooth" });
  };

  return (
    <section id="instruments" className="on-field bg-field py-[calc(var(--section)/2)] text-field-ink transition-colors duration-300">
      <div className="wrap flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div>
          <h2 className="t-head">Nine instruments, one voice.</h2>
          <p className="t-lead mt-4 max-w-[46ch]">
            Every one of them is running now, on the same frame of sound. Drag the bench sideways.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button type="button" className="btn btn-ink btn-sm min-w-12 px-0" aria-label="Earlier instruments" onClick={() => step(-1)}>
            ←
          </button>
          <button type="button" className="btn btn-ink btn-sm min-w-12 px-0" aria-label="More instruments" onClick={() => step(1)}>
            →
          </button>
        </div>
      </div>

      <ul ref={rail} tabIndex={0} aria-label="Instruments" className="rail mt-10 pt-2 pb-6">
        {INSTRUMENTS.map((instrument) => (
          <li key={instrument.kind} className="w-[min(84vw,440px)]">
            <Tilt max={4}>
              <article data-ui className="ui-panel">
                <header className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-4">
                  <h3 className="text-[16px] font-semibold text-ink">{instrument.name}</h3>
                  <span className="text-[13px] text-muted">
                    <Prov kind={instrument.provenance} />
                  </span>
                </header>
                <Trace kind={instrument.kind} bare label={instrument.picture} className="h-[230px] w-full" />
                <div className="border-t border-line px-4 py-3.5">
                  <p className="min-h-[4.2em] text-[15px] leading-[1.4] text-ink">{instrument.text}</p>
                  <p className="mt-2.5 flex items-baseline justify-between gap-4">
                    <span className="ui-label">{instrument.value.label}</span>
                    <span className="ui-fig text-[15px] text-ink">
                      <Readout field={instrument.value.field} />
                      {instrument.value.unit ? <span className="text-muted"> {instrument.value.unit}</span> : null}
                    </span>
                  </p>
                </div>
              </article>
            </Tilt>
          </li>
        ))}
      </ul>
    </section>
  );
}
