"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Prov } from "@/components/instrument/controls";
import { FigureGlyph } from "@/components/instrument/FigureGlyph";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Tilt } from "@/components/site/Tilt";
import { nearestVowel, VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { labRuntime, useLabStore } from "@/store/lab-store";
import { playVowel } from "./playVowel";

/** One computer key per vowel, along the home row, in the order of the keys on screen. */
const KEYS = ["a", "s", "d", "f", "g", "h", "j", "k"] as const;

/**
 * A keyboard of vowels. Each key sounds its vowel and holds the voice on it; the big plate redraws
 * itself into that vowel's figure. Left alone, the voice tours all eight and the keys light up in turn
 * as it passes them. The figure is always drawn from the measured formants, never from the key.
 */
export function Hero() {
  const sourceMode = useLabStore((s) => s.sourceMode);
  const micStatus = useLabStore((s) => s.micStatus);
  const micError = useLabStore((s) => s.micError);
  const setSourceMode = useLabStore((s) => s.setSourceMode);
  const selectTarget = useLabStore((s) => s.selectTarget);
  const updateSynth = useLabStore((s) => s.updateSynth);
  const tour = useLabStore((s) => s.synth.tour);
  const targetId = useLabStore((s) => s.targetId);
  const [sound, setSound] = useState(true);
  const section = useRef<HTMLElement>(null);
  const keys = useRef<(HTMLButtonElement | null)[]>([]);
  const live = sourceMode === "mic" || sourceMode === "stream";
  const listening = sourceMode === "mic";

  const press = (index: number) => {
    const v = VOWEL_TARGETS[index];
    selectTarget(v.id, !live);
    if (!live && sound) playVowel(v.id);
    const key = keys.current[index];
    if (key) {
      key.dataset.down = "true";
      setTimeout(() => delete key.dataset.down, 140);
    }
  };
  const pressRef = useRef(press);
  useEffect(() => {
    pressRef.current = press;
  });

  // The key nearest to what the voice is doing now lights up. Written to the DOM, about ten times a second.
  useEffect(() => {
    let frame = 0;
    let shown = "";
    return labRuntime.subscribe((t) => {
      if (frame++ % 6) return;
      const id = t.voiced && t.formants.confidence > 0.05 && t.formants.f1 > 0 ? nearestVowel(t.formants.f1, t.formants.f2).id : "";
      if (id === shown) return;
      shown = id;
      keys.current.forEach((key, i) => {
        if (key) key.dataset.live = String(VOWEL_TARGETS[i].id === id);
      });
    });
  }, []);

  // A S D F G H J K play the keys while the hero is on screen and nothing else has the keyboard.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    let visible = false;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);
    const onKey = (e: KeyboardEvent) => {
      if (!visible || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      const index = KEYS.indexOf(e.key.toLowerCase() as (typeof KEYS)[number]);
      if (index < 0) return;
      e.preventDefault();
      pressRef.current(index);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <section ref={section} className="pt-(--nav-h)">
      <div className="wrap grid12 items-center gap-y-10 pt-[clamp(24px,4svh,64px)] pb-6 lg:pb-8">
        <div className="col-span-12 lg:col-span-6">
          <h1 className="text-[clamp(3rem,6.6vw,7.25rem)] leading-[0.92] font-[640] tracking-[-0.045em] [font-stretch:108%]">
            Every vowel
            <br />
            has a shape.
          </h1>
          <p className="t-lead mt-7 max-w-[34ch] text-ink">
            SPONDON listens to a voice, measures its resonances, and draws the vowel as a figure in sand. Press a key
            to hear one. Sing to draw your own.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/lab" className="btn">
              Open the lab
            </Link>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={micStatus === "requesting"}
              aria-pressed={listening}
              onClick={() => void setSourceMode(listening ? "silent" : "mic")}
            >
              <span className={`mark text-accent ${listening ? "animate-pulse" : ""}`} aria-hidden />
              {micStatus === "requesting" ? "Asking for the microphone" : listening ? "Stop listening" : "Sing into it"}
            </button>
          </div>
          <p className="t-small mt-5 min-h-[1.45em] text-muted" role="status" aria-live="polite">
            {micError ??
              (listening
                ? "Listening. Hold an “aaa” or an “eee” and watch the plate."
                : "No sign-up, nothing to install, nothing uploaded. The microphone waits until you press.")}
          </p>
        </div>

        <figure className="col-span-12 lg:col-span-6">
          <Tilt max={7} className="mx-auto w-full max-w-[min(100%,50svh,540px)] lg:mr-0">
            <div className="relative aspect-square rounded-[28px] bg-accent shadow-[0_10px_0_var(--accent-deep)]">
              <div className="absolute inset-[7%]">
                <Trace
                  kind="figureOnAccent"
                  bare
                  label="The figure of the vowel now being sung, drawn from its first two formants"
                  className="h-full w-full"
                />
              </div>
            </div>
          </Tilt>
          <figcaption className="mx-auto mt-4 flex max-w-[min(100%,50svh,540px)] items-end justify-between gap-6 lg:mr-0">
            <span lang="bn" className="bn text-[clamp(2.5rem,4vw,3.75rem)] leading-none font-medium text-ink">
              <Readout field="vowel" />
            </span>
            <span className="text-right">
              <span className="block text-[14px] text-muted">
                <Prov kind="mapped">Drawn from the formants, live</Prov>
              </span>
              <span className="ui-fig mt-1 block text-[15px] text-ink">
                F1 <Readout field="f1" /> · F2 <Readout field="f2" /> Hz
              </span>
            </span>
          </figcaption>
        </figure>
      </div>

      <div className="wrap pb-[clamp(56px,7vw,112px)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h2 className="text-[17px] font-semibold text-ink">
            The eight vowels <span className="font-normal text-muted">· six Bangla, two English</span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="seg">
              <button type="button" aria-pressed={sound} onClick={() => setSound(!sound)} disabled={live}>
                {sound ? "Sound on" : "Sound off"}
              </button>
              <button type="button" aria-pressed={tour} onClick={() => updateSynth({ tour: true })} disabled={live || tour}>
                {tour ? "Touring" : "Tour all"}
              </button>
            </div>
          </div>
        </div>

        <div role="group" aria-label="Vowel keys" className="grid grid-cols-4 gap-2.5 sm:gap-3 lg:grid-cols-8">
          {VOWEL_TARGETS.map((v, i) => {
            const held = !tour && v.id === targetId;
            return (
              <button
                key={v.id}
                ref={(el) => {
                  keys.current[i] = el;
                }}
                type="button"
                aria-pressed={held}
                aria-label={`${v.label}, /${v.symbol}/. Key ${KEYS[i].toUpperCase()}.`}
                onClick={() => press(i)}
                className="group relative flex min-h-[116px] flex-col justify-between rounded-[18px] bg-surface p-3.5 text-left text-ink shadow-[0_6px_0_var(--edge)] transition-[transform,box-shadow,background-color,color] duration-150 ease-(--ease-out) hover:-translate-y-0.5 hover:shadow-[0_8px_0_var(--edge)] active:translate-y-1 active:shadow-[0_2px_0_var(--edge)] aria-pressed:bg-accent aria-pressed:text-accent-ink aria-pressed:shadow-[0_6px_0_var(--accent-deep)] data-[down=true]:translate-y-1 data-[down=true]:shadow-[0_2px_0_var(--edge)] data-[live=true]:outline-2 data-[live=true]:outline-offset-2 data-[live=true]:outline-accent sm:min-h-[128px]"
              >
                <span className="flex items-start justify-between gap-2">
                  <span lang={v.banglaSymbol ? "bn" : undefined} className="bn text-[clamp(1.9rem,3vw,2.75rem)] leading-none font-medium">
                    {v.banglaSymbol ?? v.symbol}
                  </span>
                  <kbd className="hidden rounded-md bg-raised px-1.5 py-0.5 font-sans text-[12px] font-semibold text-muted group-aria-pressed:bg-accent-ink/15 group-aria-pressed:text-accent-ink sm:inline">
                    {KEYS[i].toUpperCase()}
                  </kbd>
                </span>
                <span className="flex items-end justify-between gap-2">
                  <span className="text-[14px] leading-tight">
                    <span className="whitespace-nowrap">/{v.symbol}/</span>
                    <span className="mt-0.5 hidden text-[12px] opacity-70 sm:block">{v.label.split(",")[0]}</span>
                  </span>
                  <FigureGlyph vowelId={v.id} tone={held ? "field" : "ink"} className="h-9 w-9 flex-none opacity-80 sm:h-11 sm:w-11" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
