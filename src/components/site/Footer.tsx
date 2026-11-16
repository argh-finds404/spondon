import Link from "next/link";
import { Mark } from "@/components/brand/Logo";
import { Readout } from "@/components/instrument/Readout";
import { ThemeToggle } from "@/components/site/ThemeToggle";

export const REPO_URL = "https://github.com/argh-finds404/spondon";

const COLUMNS = [
  {
    title: "The instrument",
    links: [
      { href: "/lab", label: "Open the lab" },
      { href: "/experiments", label: "Experiments" },
      { href: "/lab/trace", label: "Trace a frame" },
      { href: "/vowels", label: "Vowel atlas" },
      { href: "/compare", label: "Compare takes & files" },
      { href: "/lab?signal=square", label: "Test signals" },
    ],
  },
  {
    title: "Learn with it",
    links: [
      { href: "/guide", label: "User guide" },
      { href: "/classroom", label: "Classroom" },
      { href: "/method", label: "Method, stage by stage" },
    ],
  },
  {
    title: "Build on it",
    links: [
      { href: "/developers", label: "HTTP API" },
      { href: REPO_URL, label: "Source on GitHub" },
    ],
  },
  {
    title: "About",
    links: [
      { href: "/archive", label: "Archive and picture credits" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
] as const;

/**
 * The close of every page, on the opposite field: what the instrument is reading right now,
 * where everything is, and the name cut large with its orange shadow.
 */
export function Footer() {
  return (
    <footer className="on-field bg-field text-field-ink transition-colors duration-300">
      <div className="wrap grid12 gap-y-12 pt-14 lg:pt-20">
        <div className="col-span-12 lg:col-span-4">
          <p className="flex items-center gap-3">
            <Mark size={44} cut="var(--field)" />
            <span className="text-[26px] leading-none font-[650] tracking-[0.01em] [font-stretch:114%]">SPONDON</span>
            <span lang="bn" className="bn text-[24px] leading-none text-field-muted">
              স্পন্দন
            </span>
          </p>
          <p className="t-body mt-5 max-w-[34ch]">
            A voice laboratory in a browser tab. It measures pitch, formants and poles, live, and draws each vowel as a
            figure in sand.
          </p>
          <dl data-ui className="mt-7 inline-grid grid-cols-[auto_auto] gap-x-5 gap-y-1.5 rounded-(--radius) bg-field-ink px-5 py-4 text-field">
            <dt className="text-[13px] opacity-70">Reading now</dt>
            <dd className="ui-fig text-right text-[14px]">
              <Readout field="f0" /> Hz
            </dd>
            <dt className="text-[13px] opacity-70">Nearest vowel</dt>
            <dd lang="bn" className="bn text-right text-[17px] leading-none">
              <Readout field="vowel" />
            </dd>
            <dt className="text-[13px] opacity-70">First formants</dt>
            <dd className="ui-fig text-right text-[14px]">
              <Readout field="f1" /> · <Readout field="f2" /> Hz
            </dd>
          </dl>
        </div>

        <div className="col-span-12 grid grid-cols-2 gap-x-(--gutter) gap-y-10 sm:grid-cols-4 lg:col-span-7 lg:col-start-6">
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-[15px] font-semibold">{column.title}</h2>
              <ul className="mt-3 flex flex-col text-[16px]">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith("http") ? (
                      <a href={link.href} rel="noreferrer" className="link inline-flex min-h-10 items-center">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="link inline-flex min-h-10 items-center">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="wrap mt-14 lg:mt-20">
        {/* The name, with a solid orange shadow: one offset copy, no blur. */}
        <svg viewBox="0 0 1000 168" className="block w-full" role="img" aria-label="SPONDON">
          <g fontSize="196" fontWeight="700" style={{ fontStretch: "110%" }}>
            <text x="9" y="158" textLength="991" lengthAdjust="spacingAndGlyphs" fill="var(--accent)">
              SPONDON
            </text>
            <text x="0" y="149" textLength="991" lengthAdjust="spacingAndGlyphs" fill="currentColor">
              SPONDON
            </text>
          </g>
        </svg>
      </div>

      <div className="wrap flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pt-8 pb-8">
        <p className="t-small max-w-[78ch] text-field-muted">
          <span lang="bn" className="bn text-field-ink">
            স্পন্দন
          </span>{" "}
          means pulse. An educational instrument for looking at speech; not a medical device, and it gives no
          diagnosis. Archive photographs are credited on the Archive page, several under CC BY-SA 4.0.
        </p>
        <div className="flex items-center gap-4">
          <a href="#content" className="link t-small font-medium">
            Back to the top
          </a>
          <ThemeToggle className="bg-field-ink! text-field! hover:opacity-85" />
        </div>
      </div>
    </footer>
  );
}
