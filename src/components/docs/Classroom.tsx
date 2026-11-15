"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Prov } from "@/components/instrument/controls";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { useSourceLabel } from "@/components/site/Navbar";
import { SIGNAL_INFO, type WaveKind } from "@/lib/dsp/signals";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";
import { useLabStore } from "@/store/lab-store";
import type { WindowType } from "@/types/dsp";

interface Unit {
  id: string;
  topic: string;
  title: string;
  goal: string;
  wave: WaveKind;
  hz: number;
  window?: WindowType;
  steps: ReactNode[];
  see: string;
  question: string;
  answer: ReactNode;
  lab: string;
}

const UNITS: Unit[] = [
  {
    id: "sampling",
    topic: "Sampling",
    title: "How many samples make a wave?",
    goal: "See a continuous tone become a list of numbers, and count them.",
    wave: "sine",
    hz: 440,
    steps: [
      "Run a 440 Hz sine here. The scope on the right shows one frame of it.",
      "In the lab, press Trace this frame: its first stage shows the same tone as separate samples.",
      "Count the samples in one period: the analyser keeps about 12,000 samples a second.",
    ],
    see: "About 27 samples in each period of the 440 Hz tone.",
    question: "At the analysis rate of 12 kHz, how many samples fall in one period of a 1 kHz tone? What is the highest frequency the analyser can represent?",
    answer: (
      <>
        12 samples per period (12,000 / 1,000). The highest is the Nyquist frequency, half the rate: 6 kHz. That is
        why the analyser low-pass filters the 48 kHz input before keeping one sample in four.
      </>
    ),
    lab: "/lab?signal=sine&hz=440",
  },
  {
    id: "fourier",
    topic: "Fourier series",
    title: "What is a square wave made of?",
    goal: "Read the harmonic recipe of three classic waves straight off the spectrum.",
    wave: "square",
    hz: 200,
    steps: [
      "Run the square wave. Peaks appear at 200, 600, 1,000 Hz: odd multiples only.",
      "Switch to the sawtooth: the even harmonics fill in.",
      "Switch to the triangle: the same odd harmonics as the square, but they fall away much faster.",
    ],
    see: "Square: odd harmonics at 1/k. Sawtooth: every harmonic at 1/k. Triangle: odd harmonics at 1/k².",
    question: "How far below the fundamental is the third harmonic of a square wave, and of a triangle wave, in dB?",
    answer: (
      <>
        Square: 20 log₁₀(1/3) ≈ −9.5 dB. Triangle: 20 log₁₀(1/9) ≈ −19.1 dB. Hover the spectrum on the right to read
        the peaks and check.
      </>
    ),
    lab: "/lab?signal=square&hz=200",
  },
  {
    id: "leakage",
    topic: "Windows and leakage",
    title: "Can you see a quiet tone next to a loud one?",
    goal: "Watch a window decide whether a weak component is visible at all.",
    wave: "twotone",
    hz: 500,
    window: "rectangular",
    steps: [
      "Run two tones: 500 Hz, and 550 Hz twenty decibels quieter.",
      "With the rectangular window, the skirts of the loud tone spread across its neighbours.",
      "Change to Hann, then to Blackman, with the window keys beside the spectrum.",
    ],
    see: "The 550 Hz tone stands out clearly once the window's sidelobes drop below −20 dB.",
    question: "Why does the rectangular window hide the second tone, and what do you pay for Blackman's clean floor?",
    answer: (
      <>
        A bare cut has sidelobes only {Math.abs(WINDOW_INFO.rectangular.peakSidelobeDb)} dB down, close to the level of
        the weak tone. Blackman pushes them to {WINDOW_INFO.blackman.peakSidelobeDb} dB, but its main lobe is{" "}
        {WINDOW_INFO.blackman.mainLobeBins} bins wide instead of {WINDOW_INFO.rectangular.mainLobeBins}: each peak is
        blurrier, so two close tones are harder to separate.
      </>
    ),
    lab: "/lab?signal=twotone&hz=500&exp=1",
  },
  {
    id: "time-frequency",
    topic: "Time and frequency",
    title: "When does a frequency happen?",
    goal: "Use the spectrogram to see a frequency change over time, which one spectrum cannot show.",
    wave: "sweep",
    hz: 440,
    steps: [
      "Run the sweep: one tone gliding from 100 Hz to 3 kHz and back every two seconds.",
      "The spectrum on the right shows one moment. Open Over time in the lab to see the whole glide.",
      "Compare the white noise: power everywhere, at every moment.",
    ],
    see: "A bright diagonal line climbing and falling in the spectrogram.",
    question: "The frame is 512 samples at 12 kHz. How long is it, and why can't a spectrogram be sharp in both time and frequency?",
    answer: (
      <>
        512 / 12,000 ≈ 42.7 ms, and the bins are 12,000 / 1,024 ≈ 11.7 Hz apart. A longer frame gives finer frequency
        steps but blurs when things happen; a shorter one does the opposite. That trade is the uncertainty principle of
        signal analysis.
      </>
    ),
    lab: "/lab?signal=sweep",
  },
  {
    id: "pitch",
    topic: "Autocorrelation",
    title: "How does a computer find the pitch?",
    goal: "Compare a signal that repeats with one that never does.",
    wave: "impulse",
    hz: 150,
    steps: [
      "Run the impulse train at 150 Hz: the spectrum is a flat comb, one tooth every 150 Hz.",
      "The pitch reading on the right finds 150 Hz with a clarity near 1.",
      "Switch to white noise: the clarity falls and the pitch disappears.",
    ],
    see: "Pitch 150 Hz and clarity close to 1 for the impulses; a dash for the noise.",
    question: "What does the clarity number measure, and why is it low for noise?",
    answer: (
      <>
        It is the height of the normalised self-similarity n(τ) at the chosen lag: how closely the signal matches itself
        one period later. A periodic signal scores near 1. Noise never repeats, so no lag scores well and the frame is
        marked unvoiced.
      </>
    ),
    lab: "/lab?signal=impulse&hz=150",
  },
  {
    id: "source-filter",
    topic: "Linear prediction",
    title: "Where does a vowel live in a spectrum?",
    goal: "Separate the voice's pitch from the shape of the mouth.",
    wave: "voice",
    hz: 140,
    steps: [
      "Run the synthetic voice. The comb of harmonics is the pitch; the cyan envelope over it is the mouth.",
      "In the lab, open Experiment 3 and change the model order from 12 to 4 and to 24.",
      "Then Experiment 4: raise the pitch and watch the comb spread while the envelope stays put.",
    ],
    see: "Three envelope peaks, the formants, that stay where they are whatever the pitch.",
    question: "Why does an order of 4 lose formants, and why does 24 start to follow the individual harmonics?",
    answer: (
      <>
        Each resonance needs a pair of poles, so 4 poles can draw at most two peaks. With 24 there are more poles than
        resonances, and the spare ones fit the harmonic ripple of the source instead of the tract.
      </>
    ),
    lab: "/lab?exp=3",
  },
  {
    id: "poles",
    topic: "The z-plane",
    title: "What does a pole do to a sound?",
    goal: "Move a pole and hear and see the resonance follow it.",
    wave: "voice",
    hz: 140,
    steps: [
      "Open Experiment 5 in the lab and drag the F1 pole around the circle.",
      "Its angle sets the frequency of the resonance; its distance from the circle sets how sharp it is.",
      "Watch the vowel chart and the sand figure answer.",
    ],
    see: "Rotating the pole moves the formant; pushing it toward the circle narrows its bandwidth.",
    question: "A pole sits at radius 0.97 and angle 0.4 rad, at a 12 kHz rate. Which formant frequency and bandwidth is it?",
    answer: (
      <>
        F = θ·fs / 2π = 0.4 × 12,000 / 2π ≈ 764 Hz. B = −ln(r)·fs / π = −ln(0.97) × 12,000 / π ≈ 116 Hz. That is an
        F1 near /ɑː/.
      </>
    ),
    lab: "/lab?exp=5",
  },
];

/** A live corner: whatever the unit loads, these instruments show it. */
function LivePanel() {
  const label = useSourceLabel();
  const windowType = useLabStore((s) => s.analyzerOptions.windowType);
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);
  return (
    <div data-ui className="ui-panel">
      <header className="flex min-h-11 items-center justify-between gap-4 border-b border-line bg-raised px-4">
        <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
          <span className="mark animate-pulse text-accent" aria-hidden />
          {label}
        </span>
        <span className="ui-fig text-[14px] text-ink">
          <Readout field="f0" /> <span className="text-muted">Hz</span>
        </span>
      </header>
      <p className="flex min-h-10 items-center justify-between px-4 text-[13px] font-medium text-ink">
        <Prov kind="measured">Spectrum</Prov>
        <span className="text-[12px] text-muted">Hover to read a peak</span>
      </p>
      <Trace kind="spectrum" inspect label="Spectrum of the signal now loaded" className="h-[220px] w-full" />
      <p className="flex min-h-10 items-center border-t border-line px-4 text-[13px] font-medium text-ink">
        <Prov kind="measured">Scope</Prov>
      </p>
      <Trace kind="scope" label="One frame of the signal before and after the window" className="h-[150px] w-full" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <div role="radiogroup" aria-label="Window" className="seg">
          {WINDOW_TYPES.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={windowType === w} onClick={() => updateOptions({ windowType: w })}>
              {WINDOW_INFO[w].label}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted">
          Clarity <span className="ui-fig text-ink"><Readout field="clarity" /></span>
        </span>
      </div>
    </div>
  );
}

export function Classroom() {
  const [running, setRunning] = useState<string | null>(null);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const setSourceMode = useLabStore((s) => s.setSourceMode);
  const updateSynth = useLabStore((s) => s.updateSynth);
  const updateOptions = useLabStore((s) => s.updateAnalyzerOptions);

  const run = (unit: Unit) => {
    if (sourceMode === "mic" || sourceMode === "stream") void setSourceMode("silent");
    updateSynth(unit.wave === "voice" ? { wave: "voice", f0Hz: unit.hz } : { wave: unit.wave, waveHz: unit.hz });
    if (unit.window) updateOptions({ windowType: unit.window });
    setRunning(unit.id);
  };

  return (
    <div className="wrap grid12 gap-y-10 pb-(--section)">
      <aside className="col-span-12 lg:order-2 lg:col-span-5 lg:col-start-8">
        <div className="lg:sticky lg:top-[calc(var(--nav-h)+20px)]">
          <LivePanel />
          <p className="t-small mt-4 text-muted">
            Every unit loads its signal into this panel and into the lab at the same time. Nothing is a recording: the
            signals are computed in the tab, and their spectra are known in advance, so you can check the instrument as
            much as it checks you.
          </p>
        </div>
      </aside>

      <ol className="col-span-12 flex flex-col gap-4 lg:order-1 lg:col-span-7">
        {UNITS.map((unit) => {
          const on = running === unit.id;
          return (
            <li key={unit.id} id={unit.id} className={`scroll-mt-[calc(var(--nav-h)+20px)] rounded-(--radius) p-6 transition-colors duration-300 lg:p-8 ${on ? "bg-raised" : "bg-surface"}`}>
              <p className="text-[14px] font-semibold text-accent">{unit.topic}</p>
              <h2 className="mt-1 text-[clamp(1.6rem,2.4vw,2.25rem)] leading-[1.1] font-[600] tracking-[-0.025em]">{unit.title}</h2>
              <p className="t-body mt-3 text-ink">{unit.goal}</p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-sm" onClick={() => run(unit)} aria-pressed={on}>
                  {on ? "Running here" : "Run it here"}
                </button>
                <Link href={unit.lab} className="btn btn-quiet btn-sm">
                  Open in the lab
                </Link>
                <span className="text-[14px] text-muted">
                  {unit.wave === "voice" ? "Synthetic voice" : SIGNAL_INFO[unit.wave].label}
                  {unit.wave === "sweep" || unit.wave === "noise" ? "" : `, ${unit.hz} Hz`}
                </span>
              </div>

              <ol className="t-body mt-6 flex list-decimal flex-col gap-2 pl-6 text-ink marker:font-semibold marker:text-accent">
                {unit.steps.map((step, k) => (
                  <li key={k}>{step}</li>
                ))}
              </ol>
              <p className="t-body mt-5 text-ink">
                <span className="font-semibold">What you should see.</span> {unit.see}
              </p>

              <details className="group mt-5 rounded-(--radius-sm) bg-bg p-4">
                <summary className="cursor-pointer list-none text-[16px] font-semibold text-ink">
                  <span className="mr-2 inline-block text-accent transition-transform duration-200 group-open:rotate-90">→</span>
                  {unit.question}
                </summary>
                <p className="t-body mt-3 text-ink">{unit.answer}</p>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
