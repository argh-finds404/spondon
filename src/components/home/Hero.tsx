"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Prov } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";

type DeckSlot = 0 | 1 | 2;

const STATIONS = [
  { id: "figure", index: "01", label: "Sand figure" },
  { id: "spectrum", index: "02", label: "Spectrum & poles" },
  { id: "vowel", index: "03", label: "Vowel chart" },
] as const;

const AUTO_ADVANCE_MS = 3800;

/**
 * 3D orbital coordinates for the 3-card instrument carousel:
 * - rel === 0: Front center stage at exact Z = 0 (1:1 native pixel resolution, zero bitmap magnification blur)
 * - rel === 1: Right wing recessed in negative Z (-175px) and angled inward (-25deg)
 * - rel === 2: Left wing recessed in negative Z (-175px) and angled inward (+25deg)
 */
function slotStyle(rel: DeckSlot): React.CSSProperties {
  if (rel === 0) {
    return {
      transform: "translate3d(0%, 0px, 0px) rotateY(0deg)",
      zIndex: 30,
      opacity: 1,
    };
  }
  if (rel === 1) {
    return {
      transform: "translate3d(44%, 10px, -175px) rotateY(-25deg)",
      zIndex: 15,
      opacity: 0.95,
    };
  }
  return {
    transform: "translate3d(-44%, 10px, -175px) rotateY(25deg)",
    zIndex: 15,
    opacity: 0.95,
  };
}

/**
 * The first screen is the instrument, running. Three live instrument modules revolve
 * in 3D space on an orange stage:
 *   01 · Chladni sand plate (supersampled 3D standing-wave simulation + live F0/F1/F2/Vowel readouts)
 *   02 · Calibrated Fourier spectrum, 12-pole LPC envelope, Z-plane roots & NSDF pitch detector
 *   03 · Calibrated F1 × F2 vowel quadrilateral & glottal pitch-period waveform
 */
export function Hero() {
  const [activeIndex, setActiveIndex] = useState<DeckSlot>(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => ((prev + 1) % 3) as DeckSlot);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  const step = (delta: number) => {
    setActiveIndex((prev) => (((prev + delta + 3) % 3) as DeckSlot));
  };

  return (
    <section className="wrap overflow-hidden pt-(--nav-h)">
      <div className="grid12 items-center gap-y-10 py-10 lg:min-h-[calc(100svh-var(--nav-h))] lg:py-8">
        <div className="col-span-12 lg:col-span-5">
          <h1 className="text-[clamp(2.75rem,5.4vw,5.9rem)] leading-[0.95] font-[620] tracking-[-0.038em] [font-stretch:108%]">
            Speak a vowel.
            <br />
            See its figure.
          </h1>
          <p className="t-lead mt-7 max-w-[30ch] text-ink">
            An acoustic laboratory in a browser tab. It measures the pitch, formants and poles of a voice, live, and
            draws each vowel as a figure in sand.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <Link href="/lab" className="btn">
              Open the lab
            </Link>
            <Link href="/guide" className="link text-[17px] font-medium">
              Take the two-minute tour
            </Link>
          </div>
          <p className="t-small mt-9 max-w-[44ch] text-muted">
            What you see is a built-in synthetic voice touring eight vowels. No microphone and no sound until you ask.
          </p>
        </div>

        <div
          className="col-span-12 lg:col-span-7"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="deck relative mx-auto w-full max-w-[780px]">
            {/* 3D Revolving Carousel Stage */}
            <div
              role="region"
              aria-roledescription="carousel"
              aria-label="Live revolving acoustic instruments"
              className="relative h-[452px] w-full [transform-style:preserve-3d] sm:h-[476px]"
            >
              {/* Architectural Orange Stage Slab behind the 3D revolving carousel */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-[7%] top-[9%] bottom-[5%] hidden rounded-(--radius) border border-accent-deep bg-accent lg:block"
                style={{
                  transform: "translateZ(-250px)",
                  boxShadow: "0 7px 0 var(--accent-deep)",
                }}
              >
                <div className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold tracking-wider text-accent-ink uppercase">
                  <span>SPONDON · LIVE ACOUSTIC BENCH</span>
                  <span className="ui-fig">MODULE 0{activeIndex + 1} / 03</span>
                </div>
              </div>

              {/* ── MODULE 01: 3D CHLADNI SAND PLATE ────────────────────────── */}
              {(() => {
                const idx: DeckSlot = 0;
                const rel = (((idx - activeIndex + 3) % 3) as DeckSlot);
                const isFront = rel === 0;
                return (
                  <article
                    data-ui
                    aria-hidden={!isFront}
                    onClick={!isFront ? () => setActiveIndex(idx) : undefined}
                    style={{
                      ...slotStyle(rel),
                      boxShadow: isFront ? "0 7px 0 var(--edge)" : "0 5px 0 var(--edge)",
                    }}
                    className={`ui-panel absolute inset-x-0 top-1 mx-auto flex h-[436px] w-[min(92%,424px)] flex-col bg-surface transition-[transform,opacity,box-shadow] duration-700 ease-(--ease-out) sm:h-[460px] ${
                      isFront ? "cursor-default border-control/60" : "cursor-pointer select-none hover:border-accent"
                    }`}
                  >
                    <header className="flex min-h-10 items-center justify-between gap-2 border-b border-line bg-raised px-3.5">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        <span className="ui-fig text-[11px] font-bold text-accent">01</span>
                        <Prov kind="mapped">Figure in sand</Prov>
                      </span>
                      <span className="ui-fig text-[12px] text-muted">
                        m <Readout field="modeM" /> · n <Readout field="modeN" />
                      </span>
                    </header>

                    {/* Dark anodized plate chamber so the 3D brass & sand plate has crisp physical contrast */}
                    <div className="relative flex-1 bg-[#0b0c10]">
                      <PlateStage showNodalLines className="h-full w-full" />
                      <div className="pointer-events-none absolute inset-x-3 top-2 flex items-center justify-between text-[11px] text-[#9c9ca8]">
                        <span className="ui-fig">C(x, y) = 0</span>
                        <span className="ui-fig">16 000 grains</span>
                      </div>
                    </div>

                    <dl className="grid grid-cols-4 divide-x divide-line border-t border-line bg-surface">
                      {(
                        [
                          ["measured", "F0", "f0", " Hz"],
                          ["derived", "F1", "f1", " Hz"],
                          ["derived", "F2", "f2", " Hz"],
                        ] as const
                      ).map(([kind, name, field, unit]) => (
                        <div key={name} className="px-2.5 py-2.5 sm:px-3">
                          <dt className="ui-label text-[11px]">
                            <Prov kind={kind}>{name}</Prov>
                          </dt>
                          <dd className="ui-fig mt-0.5 text-[13px] font-medium whitespace-nowrap text-ink sm:text-[14px]">
                            <Readout field={field} />
                            {unit}
                          </dd>
                        </div>
                      ))}
                      <div className="px-2.5 py-2.5 sm:px-3">
                        <dt className="ui-label text-[11px]">
                          <Prov kind="mapped">Vowel</Prov>
                        </dt>
                        <dd lang="bn" className="bn mt-0.5 text-[17px] leading-[19px] font-medium text-ink">
                          <Readout field="vowel" />
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })()}

              {/* ── MODULE 02: SPECTRUM, LPC ENVELOPE & Z-PLANE POLES ──────── */}
              {(() => {
                const idx: DeckSlot = 1;
                const rel = (((idx - activeIndex + 3) % 3) as DeckSlot);
                const isFront = rel === 0;
                return (
                  <article
                    data-ui
                    aria-hidden={!isFront}
                    onClick={!isFront ? () => setActiveIndex(idx) : undefined}
                    style={{
                      ...slotStyle(rel),
                      boxShadow: isFront ? "0 7px 0 var(--edge)" : "0 5px 0 var(--edge)",
                    }}
                    className={`ui-panel absolute inset-x-0 top-1 mx-auto flex h-[436px] w-[min(92%,424px)] flex-col bg-surface transition-[transform,opacity,box-shadow] duration-700 ease-(--ease-out) sm:h-[460px] ${
                      isFront ? "cursor-default border-control/60" : "cursor-pointer select-none hover:border-accent"
                    }`}
                  >
                    <header className="flex min-h-10 items-center justify-between gap-2 border-b border-line bg-raised px-3.5">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        <span className="ui-fig text-[11px] font-bold text-accent">02</span>
                        <Prov kind="derived">Spectrum &amp; poles</Prov>
                      </span>
                      <span className="ui-fig text-[12px] text-muted">1024-pt FFT · LPC(12)</span>
                    </header>

                    <div className="relative flex-1 border-b border-line p-1.5">
                      <Trace
                        kind="spectrum"
                        label="Spectrum of the current frame with its LPC envelope and formants"
                        className="h-full w-full"
                      />
                    </div>

                    <div className="grid h-[132px] grid-cols-2 divide-x divide-line border-b border-line">
                      <div className="flex flex-col">
                        <div className="flex items-center justify-between px-2.5 pt-1.5 text-[11px] text-muted">
                          <span>Z-plane roots</span>
                          <span className="ui-fig text-ink">
                            r <Readout field="poleRadius" />
                          </span>
                        </div>
                        <Trace
                          kind="zplane"
                          bare
                          label="Poles of the vocal-tract model inside the unit circle"
                          className="flex-1 w-full"
                        />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center justify-between px-2.5 pt-1.5 text-[11px] text-muted">
                          <span>Pitch NSDF</span>
                          <span className="ui-fig text-ink">
                            <Readout field="clarity" />
                          </span>
                        </div>
                        <Trace
                          kind="nsdf"
                          bare
                          label="Normalised square difference function with chosen peak"
                          className="flex-1 w-full"
                        />
                      </div>
                    </div>

                    <dl className="grid grid-cols-4 divide-x divide-line bg-surface">
                      {(
                        [
                          ["derived", "F1", "f1", " Hz"],
                          ["derived", "F2", "f2", " Hz"],
                          ["derived", "F3", "f3", " Hz"],
                          ["measured", "Level", "level", " dB"],
                        ] as const
                      ).map(([kind, name, field, unit]) => (
                        <div key={name} className="px-2.5 py-2.5 sm:px-3">
                          <dt className="ui-label text-[11px]">
                            <Prov kind={kind}>{name}</Prov>
                          </dt>
                          <dd className="ui-fig mt-0.5 text-[13px] font-medium whitespace-nowrap text-ink sm:text-[14px]">
                            <Readout field={field} />
                            {unit}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                );
              })()}

              {/* ── MODULE 03: VOWEL CHART & GLOTTAL PITCH PERIODS ─────────── */}
              {(() => {
                const idx: DeckSlot = 2;
                const rel = (((idx - activeIndex + 3) % 3) as DeckSlot);
                const isFront = rel === 0;
                return (
                  <article
                    data-ui
                    aria-hidden={!isFront}
                    onClick={!isFront ? () => setActiveIndex(idx) : undefined}
                    style={{
                      ...slotStyle(rel),
                      boxShadow: isFront ? "0 7px 0 var(--edge)" : "0 5px 0 var(--edge)",
                    }}
                    className={`ui-panel absolute inset-x-0 top-1 mx-auto flex h-[436px] w-[min(92%,424px)] flex-col bg-surface transition-[transform,opacity,box-shadow] duration-700 ease-(--ease-out) sm:h-[460px] ${
                      isFront ? "cursor-default border-control/60" : "cursor-pointer select-none hover:border-accent"
                    }`}
                  >
                    <header className="flex min-h-10 items-center justify-between gap-2 border-b border-line bg-raised px-3.5">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        <span className="ui-fig text-[11px] font-bold text-accent">03</span>
                        <Prov kind="derived">Vowel chart</Prov>
                      </span>
                      <span className="ui-fig text-[12px] text-muted">
                        <Readout field="bark" /> Bark from target
                      </span>
                    </header>

                    <div className="relative flex-1 border-b border-line p-1.5">
                      <Trace
                        kind="vowel"
                        label="Vowel chart with eight reference vowels and live position"
                        className="h-full w-full"
                      />
                    </div>

                    <div className="flex h-[106px] flex-col border-b border-line">
                      <div className="flex items-center justify-between px-3 pt-1.5 text-[11px] text-muted">
                        <span>Glottal wave &amp; T0 periods</span>
                        <span className="ui-fig text-ink">
                          T0 <Readout field="period" /> ms
                        </span>
                      </div>
                      <Trace
                        kind="pitch"
                        bare
                        label="Time-domain voice wave with glottal pitch period markers"
                        className="flex-1 w-full"
                      />
                    </div>

                    <dl className="grid grid-cols-4 divide-x divide-line bg-surface">
                      <div className="px-2.5 py-2.5 sm:px-3">
                        <dt className="ui-label text-[11px]">
                          <Prov kind="mapped">Vowel</Prov>
                        </dt>
                        <dd lang="bn" className="bn mt-0.5 text-[17px] leading-[19px] font-medium text-ink">
                          <Readout field="vowel" />
                        </dd>
                      </div>
                      <div className="px-2.5 py-2.5 sm:px-3">
                        <dt className="ui-label text-[11px]">
                          <Prov kind="measured">Pitch</Prov>
                        </dt>
                        <dd className="ui-fig mt-0.5 text-[13px] font-medium whitespace-nowrap text-ink sm:text-[14px]">
                          <Readout field="f0" /> Hz
                        </dd>
                      </div>
                      <div className="px-2.5 py-2.5 sm:px-3">
                        <dt className="ui-label text-[11px]">
                          <Prov kind="measured">Period</Prov>
                        </dt>
                        <dd className="ui-fig mt-0.5 text-[13px] font-medium whitespace-nowrap text-ink sm:text-[14px]">
                          <Readout field="period" /> ms
                        </dd>
                      </div>
                      <div className="px-2.5 py-2.5 sm:px-3">
                        <dt className="ui-label text-[11px]">
                          <Prov kind="derived">Match</Prov>
                        </dt>
                        <dd className="ui-fig mt-0.5 text-[13px] font-medium whitespace-nowrap text-ink sm:text-[14px]">
                          <Readout field="score" /> / 100
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })()}
            </div>

            {/* Tactile Carousel Switcher Bar */}
            <div data-ui className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div role="tablist" aria-label="Carousel modules" className="seg">
                {STATIONS.map((st, i) => (
                  <button
                    key={st.id}
                    type="button"
                    role="tab"
                    aria-selected={activeIndex === i}
                    onClick={() => setActiveIndex(i as DeckSlot)}
                  >
                    <span className="ui-fig mr-1.5 opacity-65">{st.index}</span>
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Previous module"
                  onClick={() => step(-1)}
                  className="btn btn-quiet btn-sm min-w-10 px-0!"
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Next module"
                  onClick={() => step(1)}
                  className="btn btn-quiet btn-sm min-w-10 px-0!"
                >
                  →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
