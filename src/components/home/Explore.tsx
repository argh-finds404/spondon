import Link from "next/link";
import type { ReactNode } from "react";
import { FigureGlyph } from "@/components/instrument/FigureGlyph";
import { Trace } from "@/components/instrument/Trace";
import { Reveal } from "@/components/site/Reveal";

function Tile({
  href,
  name,
  text,
  className,
  children,
}: {
  href: string;
  name: string;
  text: string;
  className: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`reveal group flex min-h-[220px] flex-col justify-between gap-6 rounded-(--radius) bg-surface p-6 transition-[background-color,transform] duration-200 ease-(--ease-out) hover:-translate-y-1 hover:bg-raised lg:p-7 ${className}`}
    >
      <span>
        <span className="flex items-baseline justify-between gap-4">
          <span className="text-[clamp(1.5rem,2.2vw,2rem)] leading-[1.1] font-[600] tracking-[-0.02em] text-ink">{name}</span>
          <span aria-hidden className="text-[22px] text-accent transition-transform duration-200 group-hover:translate-x-1">
            →
          </span>
        </span>
        <span className="t-body mt-2 block max-w-[46ch] text-muted">{text}</span>
      </span>
      {children}
    </Link>
  );
}

/** Where to go next: each part of SPONDON has its own page, so no page has to carry all of it. */
export function Explore() {
  return (
    <Reveal as="section" id="explore" className="section wrap">
      <h2 className="t-head reveal max-w-[16ch]">Pick up where your curiosity is.</h2>
      <div className="grid12 mt-10 gap-y-(--gutter)">
        <Tile href="/lab" name="The lab" text="Every instrument at once: your voice, a test signal or another tab." className="col-span-12 lg:col-span-7">
          <div data-ui className="overflow-hidden rounded-(--radius-sm) bg-bg">
            <Trace kind="spectrum" bare label="Live spectrum of the voice now running" className="h-[150px] w-full" />
          </div>
        </Tile>
        <Tile href="/experiments" name="Experiments" text="Break one stage of the analysis and measure what changes." className="col-span-12 lg:col-span-5">
          <div data-ui className="overflow-hidden rounded-(--radius-sm) bg-bg">
            <Trace kind="zplane" bare label="Live poles of the vocal-tract model" className="h-[150px] w-full" />
          </div>
        </Tile>
        <Tile href="/classroom" name="Classroom" text="Seven short units for a first signals course." className="col-span-12 sm:col-span-6 lg:col-span-3" />
        <Tile href="/vowels" name="Vowel atlas" text="The eight vowels, how they are made, how they sound." className="col-span-12 sm:col-span-6 lg:col-span-3">
          <FigureGlyph vowelId="ii" className="h-16 w-16" />
        </Tile>
        <Tile href="/compare" name="Compare" text="Record takes, keep them in this browser, lay one over another." className="col-span-12 sm:col-span-6 lg:col-span-3" />
        <Tile href="/guide" name="Guide" text="How to use the lab, step by step, and what to do when it looks wrong." className="col-span-12 sm:col-span-6 lg:col-span-3" />
      </div>
    </Reveal>
  );
}
