"use client";

import Link from "next/link";
import { useState } from "react";
import { FigureGlyph } from "@/components/instrument/FigureGlyph";
import { Reveal } from "@/components/site/Reveal";
import { findVowel, VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";

/** Where the audio goes: nowhere. Said plainly, with the page that proves it one click away. */
export function PrivacyClaim() {
  return (
    <Reveal as="section" id="privacy" className="section wrap grid12 gap-y-8">
      <h2 className="t-head reveal col-span-12 lg:col-span-6">Your voice stays in this tab.</h2>
      <div className="reveal col-span-12 lg:col-span-5 lg:col-start-8" style={{ "--i": 1 } as React.CSSProperties}>
        <p className="t-body text-ink">
          The microphone is asked for only when you choose it. Its samples go into the analyser in memory, are
          overwritten a fraction of a second later, and are never recorded, uploaded or stored. There is no account
          and nothing to install.
        </p>
        <p className="t-body mt-4 text-ink">
          The privacy page lists every host this tab has contacted, live, so you can check the claim instead of
          taking it.
        </p>
        <Link href="/privacy" className="link t-small mt-5 inline-block font-medium">
          How privacy works here
        </Link>
      </div>
    </Reveal>
  );
}

/**
 * A sentence with a blank: the blank is the vowel the lab opens on, and its figure answers beside it.
 * Without script it is still a plain form that opens the lab on the chosen vowel.
 */
export function Closing() {
  const [vowelId, setVowelId] = useState("aa");
  const vowel = findVowel(vowelId);
  return (
    <section className="on-accent bg-accent text-accent-ink">
      <div className="wrap grid12 items-center gap-y-10 py-[calc(var(--section)*0.55)]">
        <form action="/lab" className="col-span-12 lg:col-span-7">
          <h2 className="t-head text-[clamp(2.25rem,6vw,5.5rem)]">
            <label htmlFor="closing-vowel">Open the lab on</label>{" "}
            <select
              id="closing-vowel"
              name="vowel"
              value={vowelId}
              onChange={(e) => setVowelId(e.target.value)}
              className="bn inline-block cursor-pointer appearance-none rounded-(--radius) bg-accent-ink px-[0.28em] pb-[0.04em] align-baseline text-[#f7f4ec]"
            >
              {VOWEL_TARGETS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.banglaSymbol ?? `/${v.symbol}/`}
                </option>
              ))}
            </select>
          </h2>
          <p className="t-lead mt-6 max-w-[40ch]">
            /{vowel.symbol}/, {vowel.label.toLowerCase()}. {vowel.articulation}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <button type="submit" className="btn btn-ink min-h-12 px-6">
              Open the lab
            </button>
            <p className="t-small max-w-[46ch]">
              The synthetic voice starts at once, without sound. The microphone and the speakers wait until you ask
              for them.
            </p>
          </div>
        </form>
        <FigureGlyph
          vowelId={vowelId}
          tone="field"
          className="col-span-12 aspect-square w-full max-w-[420px] lg:col-span-4 lg:col-start-9 lg:justify-self-end"
        />
      </div>
    </section>
  );
}
