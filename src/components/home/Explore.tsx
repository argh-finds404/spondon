import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Trace } from "@/components/instrument/Trace";
import { Reveal } from "@/components/site/Reveal";

function Tile({
  href,
  name,
  text,
  index,
  className,
  children,
}: {
  href: string;
  name: string;
  text: string;
  index: number;
  className: string;
  children?: ReactNode;
}) {
  return (
    <div className={`reveal ${className}`} style={{ "--i": index } as CSSProperties}>
      <Link
        href={href}
        className="group flex h-full min-h-[196px] flex-col justify-between gap-6 rounded-(--radius) border border-line bg-surface p-6 transition-[background-color,border-color,transform] duration-300 ease-(--ease-out) hover:-translate-y-1.5 hover:border-control hover:bg-raised lg:p-7"
      >
        <span>
          <span className="flex items-baseline justify-between gap-4">
            <span className="text-[clamp(1.5rem,2.1vw,1.95rem)] leading-[1.1] font-[600] tracking-[-0.02em] text-ink transition-colors duration-200 group-hover:text-ink">
              {name}
            </span>
            <span
              aria-hidden
              className="text-[22px] text-accent transition-transform duration-300 ease-(--ease-out) group-hover:translate-x-1.5"
            >
              →
            </span>
          </span>
          <span className="t-body mt-2.5 block max-w-[44ch] text-muted transition-colors duration-200 group-hover:text-ink/85">
            {text}
          </span>
        </span>
        {children}
      </Link>
    </div>
  );
}

/** Where to go next: each part of SPONDON has its own page, so the homepage stays clean and focused. */
export function Explore() {
  return (
    <Reveal as="section" id="explore" className="section wrap">
      <div className="grid12 items-end gap-y-4">
        <h2 className="t-head reveal col-span-12 lg:col-span-7">Pick up where your curiosity is.</h2>
        <p className="t-lead reveal col-span-12 text-muted lg:col-span-5" style={{ "--i": 1 } as CSSProperties}>
          Each part of SPONDON has its own room, so no single page has to carry all of it.
        </p>
      </div>

      <div className="grid12 mt-10 items-stretch gap-y-(--gutter)">
        <Tile
          href="/lab"
          index={1}
          name="The lab"
          text="Every instrument at once: your voice, a test signal or another tab."
          className="col-span-12 lg:col-span-6"
        >
          <div data-ui className="overflow-hidden rounded-(--radius-sm) border border-line bg-bg">
            <Trace kind="spectrum" bare label="Live spectrum of the voice now running" className="h-[152px] w-full" />
          </div>
        </Tile>

        <Tile
          href="/experiments"
          index={2}
          name="Experiments"
          text="Break one stage of the analysis and measure what changes."
          className="col-span-12 lg:col-span-6"
        >
          <div data-ui className="overflow-hidden rounded-(--radius-sm) border border-line bg-bg">
            <Trace kind="zplane" bare label="Live poles of the vocal-tract model" className="h-[152px] w-full" />
          </div>
        </Tile>

        <Tile
          href="/classroom"
          index={3}
          name="Classroom"
          text="Seven short units for a first signals course."
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        />

        <Tile
          href="/vowels"
          index={4}
          name="Vowel atlas"
          text="The eight vowels, how they are made, how they sound."
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        />

        <Tile
          href="/compare"
          index={5}
          name="Compare"
          text="Record takes, keep them in this browser, lay one over another."
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        />

        <Tile
          href="/guide"
          index={6}
          name="Guide"
          text="How to use the lab, step by step, and what to do when it looks wrong."
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        />
      </div>
    </Reveal>
  );
}
