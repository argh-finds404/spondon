"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Prov, type Provenance } from "@/components/instrument/controls";
import type { TraceKind } from "@/components/instrument/draw";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";

interface Stage {
  word: string;
  kind: TraceKind;
  picture: string;
  text: string;
  provenance: Provenance;
  values: { label: string; field: ReadoutField; unit?: string; bangla?: boolean }[];
}

/** One frame of voice, followed through the chain. Each stage shows the engine's own data for it. */
const STAGES: Stage[] = [
  {
    word: "Voice",
    kind: "voice",
    picture: "Waveform of the voice",
    text: "It starts as pressure in the air. By default the voice is synthetic: a pulse train through three resonators, so the instrument runs without asking for anything.",
    provenance: "measured",
    values: [{ label: "Level", field: "level", unit: "dB FS" }],
  },
  {
    word: "PCM",
    kind: "samples",
    picture: "The same wave as discrete samples",
    text: "The browser hands over a stream of samples. A low-pass filter and a decimator keep one in four: enough bandwidth for three formants, a quarter of the arithmetic.",
    provenance: "measured",
    values: [
      { label: "Sampled at", field: "sampleRate", unit: "Hz" },
      { label: "Analysed at", field: "analysisRate", unit: "Hz" },
    ],
  },
  {
    word: "Window",
    kind: "window",
    picture: "The frame before and after the window",
    text: "A frame of 512 samples is cut out and tapered towards its ends, so the cut itself does not smear across the spectrum. The dashed curve is the window.",
    provenance: "measured",
    values: [
      { label: "Window", field: "window" },
      { label: "Frame", field: "frameMs", unit: "ms" },
    ],
  },
  {
    word: "FFT",
    kind: "fft",
    picture: "Magnitude spectrum of the frame",
    text: "A 1,024-point Fourier transform turns the frame into 512 magnitudes between 0 and 6 kHz. The comb of peaks is the harmonics of the voice.",
    provenance: "measured",
    values: [{ label: "Resolution", field: "binHz", unit: "Hz per bin" }],
  },
  {
    word: "F0",
    kind: "pitch",
    picture: "The wave with one mark per pitch period",
    text: "The McLeod pitch method looks for the lag at which the wave best repeats. One over that period is the fundamental: the note you would sing back.",
    provenance: "measured",
    values: [
      { label: "F0", field: "f0", unit: "Hz" },
      { label: "Note", field: "note" },
      { label: "Period", field: "period", unit: "ms" },
    ],
  },
  {
    word: "LPC",
    kind: "lpc",
    picture: "Spectrum with the linear-prediction envelope over it",
    text: "Linear prediction fits an all-pole filter to the frame. Twelve coefficients, solved by the Levinson-Durbin recursion, give the smooth envelope: the vocal tract without the harmonics.",
    provenance: "derived",
    values: [{ label: "Model order", field: "order", unit: "poles" }],
  },
  {
    word: "Formants",
    kind: "formants",
    picture: "The envelope with its first three peaks marked",
    text: "The peaks of that envelope are the formants, the resonances of the mouth and throat. The first two are enough to tell most vowels apart.",
    provenance: "derived",
    values: [
      { label: "F1", field: "f1", unit: "Hz" },
      { label: "F2", field: "f2", unit: "Hz" },
      { label: "F3", field: "f3", unit: "Hz" },
    ],
  },
  {
    word: "Z-plane",
    kind: "zplane",
    picture: "Poles of the model inside the unit circle",
    text: "Each formant is a pair of poles inside the unit circle. The angle of a pole is its frequency; how close it sits to the circle is how sharp the resonance is.",
    provenance: "derived",
    values: [
      { label: "F1 pole radius", field: "poleRadius" },
      { label: "angle", field: "poleAngle", unit: "rad" },
    ],
  },
  {
    word: "Vowel",
    kind: "vowel",
    picture: "Vowel chart with the live position and its trail",
    text: "F1 against F2 puts the sound on the vowel chart that phoneticians draw. Distance to each of eight reference vowels is taken on the Bark scale, the way an ear would judge it.",
    provenance: "derived",
    values: [
      { label: "Nearest", field: "vowel", bangla: true },
      { label: "From target", field: "bark", unit: "Bark" },
    ],
  },
  {
    word: "Figure",
    kind: "figure",
    picture: "Chladni figure for the current vowel",
    text: "Last, a drawing rule: F1 and F2 choose the two mode numbers of a standing wave on a square plate, and sand gathers where the plate would stay still. A picture of the vowel, not a measurement of it.",
    provenance: "mapped",
    values: [
      { label: "m, from F1", field: "modeM" },
      { label: "n, from F2", field: "modeN" },
    ],
  },
];

const STEP_SVH = 42;

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function StageValues({ stage }: { stage: Stage }) {
  return (
    <dl data-ui className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
      <div>
        <dt className="ui-label">Kind</dt>
        <dd className="mt-0.5 text-[13px] text-ink">
          <Prov kind={stage.provenance} />
        </dd>
      </div>
      {stage.values.map((value) => (
        <div key={value.field}>
          <dt className="ui-label">{value.label}</dt>
          <dd className={`mt-0.5 text-[13px] text-ink ${value.bangla ? "bn text-[15px] leading-[18px]" : "ui-fig"}`}>
            <Readout field={value.field} />
            {value.unit ? ` ${value.unit}` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The signal chain as a drum of ten words that the scroll turns, like the selector of a bench
 * instrument. Beside it, the stage that faces you: its live trace, what it does, its numbers.
 * Without script, or under reduced motion, the same ten stages are a plain ordered list.
 */
export function SignalChain() {
  const pinned = useSyncExternalStore(
    subscribeMotion,
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const sectionRef = useRef<HTMLElement>(null);
  const drumRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!pinned) return;
    const section = sectionRef.current;
    const drum = drumRef.current;
    if (!section || !drum) return;
    let raf = 0;
    let shown = -1;
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const turn = Math.min(1, Math.max(0, -rect.top / Math.max(1, travel))) * (STAGES.length - 1);
      drum.style.setProperty("--turn", turn.toFixed(4));
      const index = Math.round(turn);
      if (index !== shown) {
        shown = index;
        setActive(index);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pinned]);

  if (!pinned) {
    return (
      <section ref={sectionRef} id="chain" className="section wrap">
        <h2 className="t-head">One frame, ten stages.</h2>
        <ol className="mt-12 flex flex-col gap-16">
          {STAGES.map((stage) => (
            <li key={stage.word} className="grid12 gap-y-5">
              <h3 className="t-head col-span-12 lg:col-span-4">{stage.word}</h3>
              <div data-ui className="ui-panel col-span-12 lg:col-span-4">
                <Trace kind={stage.kind} bare label={stage.picture} className="h-44 w-full" />
              </div>
              <div className="col-span-12 lg:col-span-4">
                <p className="t-body">{stage.text}</p>
                <StageValues stage={stage} />
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const stage = STAGES[active];

  return (
    <section
      ref={sectionRef}
      id="chain"
      style={{ height: `calc(100svh + ${(STAGES.length - 1) * STEP_SVH}svh)` }}
      className="relative"
    >
      <div className="wrap sticky top-0 flex h-svh flex-col overflow-hidden pt-[calc(var(--nav-h)+20px)] pb-6 lg:pb-10">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="t-lead font-semibold">One frame, ten stages.</h2>
          <p className="t-small hidden text-muted sm:block">Scroll to follow a frame of voice through the instrument.</p>
        </div>

        <div className="grid12 min-h-0 flex-1 items-center gap-y-4">
          <div aria-hidden className="drum-scene col-span-12 py-[1.1em] text-[19vw] sm:text-[15vw] lg:col-span-7 lg:text-[min(11.2vw,19svh)]">
            <div ref={drumRef} className="drum font-semibold tracking-[-0.04em] [font-stretch:108%]">
              {STAGES.map((s, k) => (
                <span key={s.word} className="drum-face" data-active={k === active} style={{ "--k": k } as React.CSSProperties}>
                  {s.word}
                </span>
              ))}
            </div>
          </div>

          <div className="col-span-12 self-start lg:col-span-5 lg:self-center">
            <div data-ui className="ui-panel">
              <Trace kind={stage.kind} bare={stage.kind !== "spectrum"} label={stage.picture} className="h-[22svh] w-full lg:h-[34svh]" />
            </div>
            <ol className="mt-5 grid">
              {STAGES.map((s, k) => (
                <li
                  key={s.word}
                  className={`col-start-1 row-start-1 transition-opacity duration-300 ${k === active ? "opacity-100" : "pointer-events-none opacity-0"}`}
                >
                  <h3 className="sr-only">{s.word}</h3>
                  <p className="t-body max-w-[52ch] text-ink">{s.text}</p>
                  <StageValues stage={s} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
