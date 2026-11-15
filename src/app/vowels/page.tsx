import type { Metadata } from "next";
import Link from "next/link";
import { Prov } from "@/components/instrument/controls";
import { FigureGlyph } from "@/components/instrument/FigureGlyph";
import { HearButton } from "@/components/instrument/HearButton";
import { Trace } from "@/components/instrument/Trace";
import { Footer } from "@/components/site/Footer";
import { chladniModes } from "@/lib/chladni";
import { hzToBark, VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";

export const metadata: Metadata = {
  title: "Vowel atlas",
  description:
    "Six Bangla vowels and two English ones: where each sits on the F1/F2 chart, how the mouth makes it, how it sounds, and the Chladni figure SPONDON draws for it.",
};

export default function VowelsPage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 gap-y-10 pt-[calc(var(--section)/2)] pb-16">
          <div className="col-span-12 lg:col-span-5">
            <h1 className="t-head">The vowel atlas.</h1>
            <p className="t-lead mt-6 max-w-[34ch] text-ink">
              Six Bangla vowels and two English ones. Each has two resonances that place it, a mouth shape that makes
              it, and a figure of its own.
            </p>
            <p className="t-small mt-6 max-w-[52ch] text-muted">
              <Prov kind="reference">
                The formant values are typical adult figures from the phonetics literature, rounded.
              </Prov>{" "}
              They are a place to aim for, not a norm for any one speaker.
            </p>
          </div>
          <figure className="col-span-12 lg:col-span-6 lg:col-start-7">
            <div data-ui className="ui-panel">
              <Trace
                kind="vowel"
                label="Vowel chart: first formant against second, with the eight reference vowels and the live position of the synthetic voice"
                className="h-[300px] w-full lg:h-[380px]"
              />
            </div>
            <figcaption className="t-small mt-3 text-muted">
              The chart is a map of the tongue: front vowels on the left, open vowels at the bottom. The moving point is
              the synthetic voice, touring all eight.
            </figcaption>
          </figure>
        </header>

        <ol className="wrap flex flex-col gap-3 pb-(--section)">
          {VOWEL_TARGETS.map((v) => {
            const modes = chladniModes(v.targetF1, v.targetF2);
            return (
              <li key={v.id} id={v.id} className="grid12 items-center gap-y-6 rounded-(--radius) bg-surface p-5 lg:p-8">
                <p
                  lang={v.banglaSymbol ? "bn" : undefined}
                  aria-hidden
                  className="bn col-span-4 text-[clamp(4.5rem,11vw,9.5rem)] leading-[0.9] font-medium text-ink lg:col-span-2"
                >
                  {v.banglaSymbol ?? v.symbol}
                </p>
                <div className="col-span-8 lg:col-span-4">
                  <h2 className="t-lead font-semibold text-ink">
                    /{v.symbol}/ <span className="font-[450]">{v.label}</span>
                  </h2>
                  <p className="t-body mt-2 max-w-[38ch] text-ink">{v.articulation}</p>
                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <HearButton vowelId={v.id} label={`Hear ${v.label}`} />
                    <Link href={`/lab?vowel=${v.id}`} className="link t-small font-medium">
                      Practise it in the lab
                    </Link>
                  </div>
                </div>
                <dl data-ui className="col-span-7 grid grid-cols-3 gap-x-4 gap-y-4 lg:col-span-3">
                  {(
                    [
                      ["F1", v.targetF1],
                      ["F2", v.targetF2],
                      ["F3", v.targetF3],
                    ] as const
                  ).map(([name, hz]) => (
                    <div key={name}>
                      <dt className="ui-label">
                        <Prov kind="reference">{name}</Prov>
                      </dt>
                      <dd className="ui-fig mt-0.5 text-[15px] text-ink">
                        {hz} <span className="text-[12px] text-muted">Hz</span>
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="ui-label">Bark</dt>
                    <dd className="ui-fig mt-0.5 text-[13px] text-ink">
                      {hzToBark(v.targetF1).toFixed(1)}, {hzToBark(v.targetF2).toFixed(1)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="ui-label">
                      <Prov kind="mapped">Plate modes</Prov>
                    </dt>
                    <dd className="ui-fig mt-0.5 text-[13px] text-ink">
                      m {modes.m.toFixed(2)} · n {modes.n.toFixed(2)}
                    </dd>
                  </div>
                </dl>
                <FigureGlyph vowelId={v.id} className="col-span-5 aspect-square w-full lg:col-span-3" />
              </li>
            );
          })}
        </ol>
      </main>
      <Footer />
    </>
  );
}
