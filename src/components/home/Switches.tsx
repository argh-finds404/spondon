"use client";

import type { ReactNode } from "react";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Reveal } from "@/components/site/Reveal";
import { WINDOW_INFO } from "@/lib/dsp/windows";
import { useLabStore } from "@/store/lab-store";

function Band({
  sentence,
  on,
  onToggle,
  children,
}: {
  sentence: string;
  on: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`transition-colors duration-300 ${on ? "on-field bg-field text-field-ink" : "bg-bg text-muted"}`}
    >
      <div className="wrap flex min-h-[132px] items-center justify-between gap-6 py-6 lg:min-h-[20svh]">
        <div className="min-w-0">
          <h3 className="text-[clamp(1.5rem,3.3vw,3.25rem)] leading-[1.05] font-[560] tracking-[-0.03em] [font-stretch:106%]">
            {sentence}
          </h3>
          <p
            className={`t-small mt-3 max-w-[78ch] text-field-muted transition-opacity duration-300 ${on ? "opacity-100" : "h-0 overflow-hidden opacity-0"}`}
            aria-hidden={!on}
          >
            {children}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={sentence}
          onClick={onToggle}
          className={`relative h-11 w-[84px] flex-none rounded-(--radius) transition-colors duration-200 active:scale-[0.97] ${on ? "bg-field-ink" : "bg-control"}`}
        >
          <span
            className={`absolute top-1.5 left-1.5 h-8 w-8 rounded-(--radius) transition-transform duration-200 ease-(--ease-out) ${on ? "translate-x-10 bg-accent" : "bg-ink"}`}
          />
        </button>
      </div>
    </div>
  );
}

/**
 * Sentences with switches. Each one is a real setting of the analyser that is running on this page:
 * flip it and the spectrum above, and every readout on the site, answers.
 */
export function Switches() {
  const options = useLabStore((s) => s.analyzerOptions);
  const update = useLabStore((s) => s.updateAnalyzerOptions);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const setSourceMode = useLabStore((s) => s.setSourceMode);
  const hamming = options.windowType !== "rectangular";
  const emphasis = options.preEmphasis > 0;
  const twelve = options.lpcOrder >= 12;
  const aloud = sourceMode === "synth";
  const window = WINDOW_INFO[options.windowType];
  const bare = WINDOW_INFO.rectangular;

  return (
    <section id="settings">
      <Reveal className="wrap grid12 gap-y-8 pt-[calc(var(--section)/2)] pb-12">
        <div className="col-span-12 lg:col-span-5">
          <h2 className="t-head reveal">A lab, so you can change it.</h2>
          <p className="t-lead reveal mt-6 max-w-[36ch] text-ink" style={{ "--i": 1 } as React.CSSProperties}>
            These are the analyser&rsquo;s own settings, not a demo of them. Flip one and watch the spectrum answer.
          </p>
        </div>
        <div data-ui className="ui-panel reveal col-span-12 lg:col-span-7" style={{ "--i": 2 } as React.CSSProperties}>
          <Trace
            kind="spectrum"
            inspect
            label="Magnitude spectrum of the current frame with the linear-prediction envelope and the first three formants"
            className="h-[240px] w-full lg:h-[300px]"
          />
        </div>
      </Reveal>

      <Band
        sentence="Taper each frame with a Hamming window"
        on={hamming}
        onToggle={() => update({ windowType: hamming ? "rectangular" : "hamming" })}
      >
        {window.label} window: highest sidelobe {window.peakSidelobeDb.toFixed(1)} dB, against{" "}
        {bare.peakSidelobeDb.toFixed(1)} dB for a bare cut. The price is a main lobe {window.mainLobeBins} bins wide
        instead of {bare.mainLobeBins}.
      </Band>
      <Band
        sentence="Lift the highs before the model"
        on={emphasis}
        onToggle={() => update({ preEmphasis: emphasis ? 0 : 0.97 })}
      >
        y[n] = x[n] &minus; 0.97 x[n&minus;1] flattens the tilt of the voice, so the poles go to resonances and not to
        the slope. Now: F1 <Readout field="f1" /> Hz, F2 <Readout field="f2" /> Hz.
      </Band>
      <Band
        sentence="Fit the tract with twelve poles"
        on={twelve}
        onToggle={() => update({ lpcOrder: twelve ? 6 : 12 })}
      >
        Six pole pairs: three for the formants, three for the overall shape of the spectrum. With six poles the third
        formant is usually lost. Now: <Readout field="order" /> poles, F3 <Readout field="f3" /> Hz.
      </Band>
      <Band
        sentence="Play the synthetic voice aloud"
        on={aloud}
        onToggle={() => void setSourceMode(aloud ? "silent" : "synth")}
      >
        Playing at <Readout field="f0" /> Hz through your speakers, and read back from the audio graph exactly as a
        microphone would be.
      </Band>
    </section>
  );
}
