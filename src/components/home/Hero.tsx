import Link from "next/link";
import { Prov } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Tilt } from "@/components/site/Tilt";

/**
 * The first screen is the instrument, running. Three of its panels stand in space on an orange
 * stage: the spectrum on the left wing, the sand plate in the middle, the vowel chart on the right.
 * All three are live, driven by the built-in synthetic voice, and lean toward the pointer.
 */
export function Hero() {
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

        <div className="deck col-span-12 lg:col-span-7">
          <Tilt max={5} className="relative grid grid-cols-2 items-center gap-3 lg:grid-cols-[1fr_1.55fr_1fr] lg:gap-0">
            {/* The stage: one flat slab of orange, behind everything. */}
            <div
              aria-hidden
              className="absolute inset-x-[10%] top-[10%] -bottom-[4%] hidden rounded-(--radius) bg-accent lg:block"
              style={{ transform: "translateZ(-240px)" }}
            />

            <div data-ui className="ui-panel deck-wing-l order-2 lg:order-none">
              <p className="flex min-h-10 items-center border-b border-line px-3 text-[13px] font-medium text-ink">
                <Prov kind="derived">Spectrum</Prov>
              </p>
              <Trace kind="spectrum" bare label="Spectrum of the current frame with its envelope and formants" className="h-36 w-full lg:h-[26svh]" />
            </div>

            <div data-ui className="ui-panel order-1 col-span-2 lg:order-none lg:col-span-1" style={{ transform: "translateZ(40px)" }}>
              <PlateStage className="aspect-square w-full" />
              <dl className="grid grid-cols-4 border-t border-line">
                {(
                  [
                    ["measured", "F0", "f0", " Hz"],
                    ["derived", "F1", "f1", " Hz"],
                    ["derived", "F2", "f2", " Hz"],
                  ] as const
                ).map(([kind, name, field, unit]) => (
                  <div key={name} className="px-2.5 py-3 sm:px-3.5">
                    <dt className="ui-label">
                      <Prov kind={kind}>{name}</Prov>
                    </dt>
                    <dd className="ui-fig mt-1 text-[13px] whitespace-nowrap text-ink sm:text-[15px]">
                      <Readout field={field} />
                      {unit}
                    </dd>
                  </div>
                ))}
                <div className="px-2.5 py-3 sm:px-3.5">
                  <dt className="ui-label">
                    <Prov kind="mapped">Vowel</Prov>
                  </dt>
                  <dd lang="bn" className="bn mt-1 text-[18px] leading-[20px] text-ink">
                    <Readout field="vowel" />
                  </dd>
                </div>
              </dl>
            </div>

            <div data-ui className="ui-panel deck-wing-r order-3 lg:order-none">
              <p className="flex min-h-10 items-center border-b border-line px-3 text-[13px] font-medium text-ink">
                <Prov kind="derived">Vowel chart</Prov>
              </p>
              <Trace kind="vowel" bare label="Vowel chart with the live position of the voice" className="h-36 w-full lg:h-[26svh]" />
            </div>
          </Tilt>
        </div>
      </div>
    </section>
  );
}
