import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { RoundTrip } from "@/components/docs/RoundTrip";
import { Footer } from "@/components/site/Footer";
import { VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";

export const metadata: Metadata = {
  title: "HTTP API",
  description:
    "Three endpoints over the same engine as the lab: the vowel targets as JSON, a synthetic vowel as WAV, and formant, pitch and jitter analysis of a recording. No key, nothing stored.",
};

const ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const IDS = VOWEL_TARGETS.map((v) => v.id).join(", ");

function Endpoint({ id, method, path, children }: { id: string; method: string; path: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-[calc(var(--nav-h)+24px)] py-12 first:pt-0">
      <h2 className="t-lead font-semibold text-ink">
        <span className="ui-fig mr-3 text-[0.8em] text-muted">{method}</span>
        <code className="bg-transparent! p-0!">{path}</code>
      </h2>
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table data-ui className="w-full min-w-[520px] text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="py-2 pr-5 font-normal last:pr-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line align-top text-ink last:border-0">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="ui-fig py-2 pr-5 font-normal whitespace-nowrap">
                    {cell}
                  </th>
                ) : (
                  <td key={j} className="py-2 pr-5 last:pr-0">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const P = ({ children }: { children: ReactNode }) => <p className="t-body max-w-[68ch] text-ink">{children}</p>;

export default function DevelopersPage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 gap-y-10 pt-[calc(var(--section)/2)] pb-16">
          <div className="col-span-12 lg:col-span-6">
            <h1 className="t-head">The same engine, over HTTP.</h1>
            <p className="t-lead mt-6 max-w-[40ch] text-ink">
              The lab does its work in your tab. For scripts and notebooks, the analyser and the synthetic voice
              behind it answer three plain endpoints.
            </p>
            <p className="t-body mt-5 max-w-[56ch] text-ink">
              No key and no account. Any origin may call them. Nothing you send is stored or logged by the
              application. Base URL: <code>{ORIGIN}</code>
            </p>
          </div>
          <div className="col-span-12 lg:col-span-5 lg:col-start-8">
            <RoundTrip />
          </div>
        </header>

        <div className="wrap grid12 gap-y-8 pb-(--section)">
          <nav aria-label="Endpoints" className="col-span-12 lg:col-span-3">
            <ul className="t-small flex flex-wrap gap-x-6 text-ink lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:flex-col">
              {[
                ["#vowels", "GET /api/vowels"],
                ["#synth", "GET /api/synth"],
                ["#analyze", "POST /api/analyze"],
                ["#errors", "Errors and limits"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="link inline-flex min-h-9 items-center">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="col-span-12 min-w-0 lg:col-span-9">
            <Endpoint id="vowels" method="GET" path="/api/vowels">
              <P>
                The eight reference vowels the lab aims at: symbol, formants, how the mouth makes it, its place on the
                Bark scale and the plate modes its figure is drawn with.
              </P>
              <CodeBlock title="Request" code={`curl ${ORIGIN}/api/vowels`} />
              <CodeBlock
                title="Response, first of eight"
                code={`{
  "vowels": [
    {
      "id": "aa",
      "symbol": "ɑː",
      "banglaSymbol": "আ",
      "label": "Low back unrounded",
      "targetF1": 750,
      "targetF2": 1180,
      "targetF3": 2540,
      "toleranceHz": 110,
      "articulation": "Drop the jaw wide; keep the tongue low and relaxed.",
      "bark": { "f1": 6.89, "f2": 9.545 },
      "modes": { "m": 3.2, "n": 5.637 }
    }
  ]
}`}
              />
            </Endpoint>

            <Endpoint id="synth" method="GET" path="/api/synth">
              <P>
                One synthetic vowel as a 16-bit mono WAV: a pulse train through three resonators set to the
                vowel&rsquo;s formants. The same parameters always return the same bytes, so responses are cached
                for good.
              </P>
              <Table
                caption="Query parameters of /api/synth"
                head={["Parameter", "Default", "Allowed"]}
                rows={[
                  ["vowel", "aa", IDS],
                  ["f0", "140", "60 to 400 Hz, the pitch"],
                  ["jitter", "0.4", "0 to 5 %, cycle-to-cycle variation of the period"],
                  ["shimmer", "0", "0 to 3 dB, cycle-to-cycle variation of the level"],
                  ["duration", "1.5", "0.1 to 5 seconds"],
                  ["rate", "16000", "8000, 16000, 22050, 24000, 32000, 44100 or 48000 Hz"],
                ]}
              />
              <CodeBlock
                title="Request"
                code={`curl -o ii.wav "${ORIGIN}/api/synth?vowel=ii&f0=180&duration=1.5&rate=16000"`}
              />
            </Endpoint>

            <Endpoint id="analyze" method="POST" path="/api/analyze">
              <P>
                Send a recording, get its measurements. The body is a WAV file: PCM at 8, 16, 24 or 32 bits, or
                32-bit float, with any number of channels (they are averaged). It is run through the lab&rsquo;s
                analyser one frame every 10 ms. Add <code>?target=</code> with a vowel id to score the recording
                against that vowel.
              </P>
              <CodeBlock
                title="Request"
                code={`curl -X POST -H "Content-Type: audio/wav" --data-binary @ii.wav \\
  "${ORIGIN}/api/analyze?target=ii"`}
              />
              <CodeBlock
                title="Response for the file made above"
                code={`{
  "sampleRate": 16000,
  "durationSec": 1.5,
  "hopMs": 10,
  "frames": [
    { "t": 0.01, "f0": 0, "f1": 0, "f2": 0, "f3": 0, "voiced": false },
    { "t": 0.5, "f0": 180, "f1": 294, "f2": 2302, "f3": 2936, "voiced": true }
  ],
  "summary": {
    "voicedFraction": 0.993,
    "f0Hz": 180,
    "f1Hz": 295,
    "f2Hz": 2301,
    "f3Hz": 2939,
    "jitterPercent": 0.598,
    "shimmerDb": 0.051,
    "nearestVowel": "ii",
    "target": { "id": "ii", "distanceBark": 0.17, "convergenceScore": 98.6 }
  }
}`}
              />
              <Table
                caption="Fields of the /api/analyze response"
                head={["Field", "Meaning"]}
                rows={[
                  ["frames[].t", "Seconds from the start of the file to the end of the frame's window."],
                  ["frames[].f0", "Pitch in Hz; 0 where the frame is unvoiced."],
                  ["frames[].f1, f2, f3", "Formants in Hz; 0 where none was tracked."],
                  ["summary.voicedFraction", "Share of frames that were voiced, 0 to 1."],
                  ["summary.f0Hz … f3Hz", "Medians over the frames that carry a value; 0 if none do."],
                  [
                    "summary.jitterPercent, shimmerDb",
                    "Medians of the rolling cycle-to-cycle readings. They run about 1.2 to 1.4 times high; see the method page.",
                  ],
                  ["summary.nearestVowel", "The id of the closest reference vowel on the Bark scale, or null."],
                  ["summary.target", "Only with ?target=: Bark distance from it and a 0 to 100 match."],
                ]}
              />
              <P>
                The response above shows two frames of 150: the first, before the voice has been heard, and one from
                the middle. The numbers are what the analyser returned for that file; run the panel at the top of
                the page to see it happen.
              </P>
            </Endpoint>

            <section id="errors" className="scroll-mt-[calc(var(--nav-h)+24px)] py-12">
              <h2 className="t-lead font-semibold text-ink">Errors and limits</h2>
              <div className="mt-5 flex flex-col gap-5">
                <P>
                  Every error is JSON of the form <code>{`{ "error": "…" }`}</code> with one of these statuses.
                </P>
                <Table
                  caption="Error statuses"
                  head={["Status", "When"]}
                  rows={[
                    ["400", "A parameter is out of range, the vowel id is unknown, the body is not a readable WAV, or the recording is shorter than 0.1 s."],
                    ["413", "The body is over 4 MB, or the recording is longer than 30 s."],
                    ["415", "The Content-Type is not audio/wav (audio/x-wav and application/octet-stream are also accepted)."],
                  ]}
                />
                <P>
                  There is no rate limit in the application itself and no uptime promise: this is a small public
                  endpoint, so be gentle with it. For anything heavy, the analyser is a few hundred lines of
                  dependency-free TypeScript in the repository and runs anywhere.
                </P>
                <P>
                  <code>/api/analyze</code> is the one place audio leaves a device, and only when you send it. The lab
                  never calls it. More on the <Link href="/privacy" className="link">privacy page</Link>.
                </P>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
