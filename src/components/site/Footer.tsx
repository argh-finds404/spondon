import Link from "next/link";

export const REPO_URL = "https://github.com/argh-finds404/spondon";

const COLUMNS = [
  {
    title: "The instrument",
    links: [
      { href: "/lab", label: "Open the lab" },
      { href: "/vowels", label: "Vowel atlas" },
    ],
  },
  {
    title: "How it works",
    links: [
      { href: "/method", label: "Method, stage by stage" },
      { href: "/developers", label: "HTTP API" },
    ],
  },
  {
    title: "Where it comes from",
    links: [
      { href: "/archive", label: "Archive and image credits" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
  {
    title: "Source",
    links: [{ href: REPO_URL, label: "GitHub repository" }],
  },
] as const;

export function Footer() {
  return (
    <footer className="on-field grid min-h-[min(100svh,860px)] grid-rows-[auto_1fr_auto] bg-field text-field-ink">
      <div className="wrap grid12 gap-y-10 pt-10">
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="col-span-6 md:col-span-3">
            <h2 className="t-small font-semibold">{column.title}</h2>
            <ul className="t-small mt-2 flex flex-col text-field-muted">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("http") ? (
                    <a href={link.href} rel="noreferrer" className="link inline-flex min-h-8 items-center">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="link inline-flex min-h-8 items-center">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div aria-hidden className="min-h-[14svh]" />
      <div className="wrap pb-6">
        <svg viewBox="0 0 1000 148" className="block w-full" role="img" aria-label="SPONDON">
          <text
            x="0"
            y="143"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            fontSize="196"
            fontWeight="700"
            fill="currentColor"
            style={{ fontStretch: "110%" }}
          >
            SPONDON
          </text>
        </svg>
        <p className="t-small mt-5 max-w-[92ch] text-field-muted">
          <span lang="bn" className="bn text-field-ink">
            স্পন্দন
          </span>{" "}
          means pulse. SPONDON is an educational instrument for looking at speech; it is not a medical device and gives
          no diagnosis. Archive photographs are credited on the Archive page, several under CC BY-SA 4.0.
        </p>
      </div>
    </footer>
  );
}
