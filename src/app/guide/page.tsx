import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Prov } from "@/components/instrument/controls";
import type { TraceKind } from "@/components/instrument/draw";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "User guide",
  description:
    "How to use SPONDON: start in ten seconds, use your own voice, aim at a vowel, read each instrument, change the analysis, use test signals, analyse another tab, compare takes, and fix common problems.",
};

const TOC = [
  ["start", "Start in ten seconds"],
  ["voice", "Use your own voice"],
  ["aim", "Aim at a vowel"],
  ["instruments", "Read the instruments"],
  ["analysis", "Change the analysis"],
  ["signals", "Test signals"],
  ["tab", "Analyse another tab"],
  ["compare", "Record and compare"],
  ["problems", "When something looks wrong"],
] as const;

function Step({
  id,
  title,
  figure,
  children,
}: {
  id: string;
  title: string;
  figure?: { kind: TraceKind | "plate"; label: string; caption: ReactNode };
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid12 scroll-mt-[calc(var(--nav-h)+24px)] gap-y-6 rounded-(--radius) bg-surface p-6 lg:p-9">
      <div className={`col-span-12 ${figure ? "lg:col-span-6" : "lg:col-span-10"}`}>
        <h2 className="text-[clamp(1.6rem,2.4vw,2.25rem)] leading-[1.1] font-[600] tracking-[-0.025em]">{title}</h2>
        <div className="t-body mt-4 flex flex-col gap-3 text-ink">{children}</div>
      </div>
      {figure && (
        <figure className="col-span-12 lg:col-span-6">
          <div data-ui className="ui-panel bg-bg">
            {figure.kind === "plate" ? (
              <PlateStage showNodalLines className="aspect-[4/3] w-full" />
            ) : (
              <Trace kind={figure.kind} inspect label={figure.label} className="h-[240px] w-full" />
            )}
          </div>
          <figcaption className="t-small mt-3 text-muted">{figure.caption}</figcaption>
        </figure>
      )}
    </section>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <span className="rounded-(--radius-sm) bg-raised px-2 py-0.5 text-[0.9em] font-semibold whitespace-nowrap text-ink">{children}</span>
);

const INSTRUMENTS: [string, "measured" | "derived" | "mapped", string][] = [
  ["Vowel chart", "derived", "F1 down the side, F2 across, both in hertz. Front vowels sit on the left, open vowels at the bottom. The dot is you; its tail is the last two seconds; the ring is the target."],
  ["Figure", "mapped", "The sand plate. F1 chooses one mode number, F2 the other, and the grains settle on the still lines. Drag to turn it. It is a picture of the vowel, not a measurement."],
  ["Spectrum and envelope", "derived", "The grey comb is the Fourier spectrum: one tooth per harmonic of your voice. The cyan curve is the model of your mouth. The orange marks are the formants."],
  ["Z-plane", "derived", "The twelve poles of that model. Each formant is a pole near the circle: its angle is the frequency, its closeness to the circle is how sharp the resonance is."],
  ["Scope", "measured", "One 43 ms frame of the wave, before and after the window. The dashed curve is the window."],
  ["Spectrogram", "measured", "Under Over time. Frequency upward, time left to right, loudness as heat. The cyan trails are the formants being tracked."],
  ["Pitch track", "measured", "Your pitch over the last four seconds, on a scale where every octave is the same height."],
  ["Readings", "measured", "Every number, with a mark that says how it was obtained: a dot for measured, a diamond for derived, a ring for drawn."],
];

export default function GuidePage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 items-end gap-y-6 pt-[calc(var(--section)/2)] pb-12">
          <h1 className="t-head col-span-12 lg:col-span-7">How to use the lab.</h1>
          <div className="col-span-12 lg:col-span-5">
            <p className="t-lead text-ink">
              Nine short sections, from opening the page to reading a pole. You need a browser, and a microphone only
              if you want to use your own voice.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/lab" className="btn btn-sm">
                Open the lab beside this
              </Link>
              <Link href="/classroom" className="link text-[16px] font-medium">
                Or follow a classroom unit
              </Link>
            </div>
          </div>
        </header>

        <div className="wrap grid12 gap-y-6 pb-(--section)">
          <nav aria-label="Sections of the guide" className="col-span-12 lg:col-span-3">
            <ol className="flex flex-wrap gap-2 lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:flex-col lg:gap-0.5">
              {TOC.map(([id, title]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="block rounded-(--radius-sm) px-3 py-2 text-[15px] font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    {title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="col-span-12 flex flex-col gap-4 lg:col-span-9">
            <Step
              id="start"
              title="Start in ten seconds"
              figure={{
                kind: "vowel",
                label: "Vowel chart with the synthetic voice moving across it",
                caption: "Running now: the built-in voice touring the eight vowels.",
              }}
            >
              <p>
                Open the <Link href="/lab" className="link">lab</Link>. It starts at once on a built-in synthetic
                voice that tours all eight vowels, so every instrument is moving before you touch anything. There is
                no sound and no microphone yet.
              </p>
              <p>
                To hear the voice, press <Key>Sound off</Key> next to <Key>Built-in</Key> so it reads{" "}
                <Key>Sound on</Key>. To hold one vowel, press its key under the vowel chart; <Key>Tour all</Key> starts
                the tour again.
              </p>
            </Step>

            <Step
              id="voice"
              title="Use your own voice"
              figure={{
                kind: "pitchTrack",
                label: "Pitch track of the signal now being analysed",
                caption: (
                  <>
                    The pitch track. With your voice on, this line is you: now <Readout field="f0" /> Hz.
                  </>
                ),
              }}
            >
              <p>
                Press <Key>Microphone</Key> and allow the browser to use it. The level meter that appears should move
                when you speak; if it barely moves, raise <Key>Microphone input boost</Key> in the <Key>Source</Key>{" "}
                tab.
              </p>
              <p>
                Hold one vowel steadily for a second or two: “aaa”, “eee”, “ooo”. Vowels work, consonants and whispers
                do not, because the analyser only reads sounds that have a pitch. Sit 15 to 30 cm from the microphone,
                in a quiet room, with the speakers off or on headphones.
              </p>
              <p>
                The microphone only works on a secure page (https, or localhost when you run it yourself). Your voice is
                analysed in the tab and never sent anywhere; see <Link href="/privacy" className="link">privacy</Link>.
              </p>
            </Step>

            <Step
              id="aim"
              title="Aim at a vowel"
              figure={{
                kind: "plate",
                label: "",
                caption: (
                  <>
                    Each vowel draws its own figure. Plate modes now: m <Readout field="modeM" />, n{" "}
                    <Readout field="modeN" />.
                  </>
                ),
              }}
            >
              <p>
                Click a vowel on the chart, or its key below it, to make it the target. The line under the title then
                says how far you are, in Bark, and what to change: open the jaw, close it, bring the tongue forward or
                back.
              </p>
              <p>
                At a match of 80 or more the ring turns green and the lab says you are locked on. Reference values for
                each vowel, and the sound of each one, are in the <Link href="/vowels" className="link">vowel atlas</Link>
                .
              </p>
            </Step>

            <section id="instruments" className="scroll-mt-[calc(var(--nav-h)+24px)] rounded-(--radius) bg-surface p-6 lg:p-9">
              <h2 className="text-[clamp(1.6rem,2.4vw,2.25rem)] leading-[1.1] font-[600] tracking-[-0.025em]">Read the instruments</h2>
              <p className="t-body mt-4 max-w-[64ch] text-ink">
                The tabs above the panels show all of them at once or one at a time, larger.
              </p>
              <dl className="mt-6 grid gap-x-(--gutter) gap-y-5 md:grid-cols-2">
                {INSTRUMENTS.map(([name, kind, text]) => (
                  <div key={name} className="rounded-(--radius-sm) bg-bg p-4">
                    <dt className="text-[17px] font-semibold">
                      <Prov kind={kind}>{name}</Prov>
                    </dt>
                    <dd className="mt-1.5 text-[15px] leading-[1.5] text-ink">{text}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <Step
              id="analysis"
              title="Change the analysis"
              figure={{
                kind: "spectrum",
                label: "Spectrum with envelope and formant markers",
                caption: "Switch the window in the lab and watch this spectrum's skirts change.",
              }}
            >
              <p>
                The window keys above the scope, and the <Key>Analysis</Key> tab, change the analyser itself:
                rectangular, Hamming, Hann or Blackman window; pre-emphasis on or off; the model order from 4 to 24.
              </p>
              <p>
                <Key>Freeze</Key> holds the current frame so you can read it. <Link href="/lab/trace" className="link">Trace a frame</Link> opens the
                eight stages of that frame one by one, with each stage&rsquo;s input and output side by side.
              </p>
              <p>
                The <Link href="/experiments" className="link">experiments</Link> turn one stage at a time off or to an extreme and keep the
                normal result dashed underneath, so you can see exactly what that stage does.
              </p>
            </Step>

            <Step
              id="signals"
              title="Test signals"
              figure={{
                kind: "spectrogram",
                label: "Scrolling spectrogram",
                caption: "The spectrogram, the best view for a sweep.",
              }}
            >
              <p>
                In the <Key>Source</Key> tab, <Key>Built-in source</Key> swaps the voice for a classroom signal: sine,
                square, sawtooth, triangle, two tones, a sweep, white noise or an impulse train, with its frequency on a
                slider. Each one has a spectrum you can predict, which makes them good for checking the instrument, and
                for checking yourself.
              </p>
              <p>
                The <Link href="/classroom" className="link">classroom</Link> page has seven units built on them, each
                with a question and its answer.
              </p>
            </Step>

            <Step id="tab" title="Analyse another tab">
              <p>
                <Key>Tab audio</Key> analyses the sound of another browser tab: a song, a lecture, a video of a singer.
                In the browser&rsquo;s picker choose the tab and switch on <strong>share tab audio</strong>; the video
                is discarded at once and only the sound is analysed. This works in Chrome and Edge on desktop; other
                browsers may not offer tab audio.
              </p>
            </Step>

            <Step id="compare" title="Record and compare">
              <p>
                With the microphone on, <Key>Record 3 seconds</Key> keeps a short clip in memory and loops it through
                the analyser, so you can study one take as long as you like. It is gone when you switch the microphone
                off.
              </p>
              <p>
                For more, <Link href="/compare" className="link">compare</Link> records longer takes or opens audio
                files, saves them in this browser&rsquo;s own storage with your notes, and lays one over another. Saved
                takes stay on this device until you delete them.
              </p>
            </Step>

            <section id="problems" className="scroll-mt-[calc(var(--nav-h)+24px)] rounded-(--radius) bg-surface p-6 lg:p-9">
              <h2 className="text-[clamp(1.6rem,2.4vw,2.25rem)] leading-[1.1] font-[600] tracking-[-0.025em]">When something looks wrong</h2>
              <dl className="mt-6 grid gap-x-(--gutter) gap-y-5 md:grid-cols-2">
                {(
                  [
                    ["The numbers show a dash.", "Nothing voiced is coming in. Hold a vowel louder or closer, or raise the input boost. Consonants, whispers and silence show a dash on purpose."],
                    ["The browser never asked for the microphone.", "The page must be on https or localhost. If you refused once, allow it again from the padlock or site settings beside the address."],
                    ["The formants jump around.", "Hold the vowel steadier and longer, and keep the pitch low and even. Very high voices space the harmonics so widely that the model has little to fit."],
                    ["The dot is far from where I aimed.", "Reference values are averages of adult voices. A child's or a high voice has every formant higher; the formant shift slider shows that effect on the synthetic voice."],
                    ["Jitter seems high.", "It reads about 1.2 to 1.4 times high compared with clinical tools, by the way it is measured. Compare one take with another, not with a clinical norm."],
                    ["The 3D plate is missing or slow.", "Without WebGL the plate is drawn flat instead. Close other heavy tabs, or use the Figure tab alone."],
                  ] as const
                ).map(([q, a]) => (
                  <div key={q} className="rounded-(--radius-sm) bg-bg p-4">
                    <dt className="text-[17px] font-semibold">{q}</dt>
                    <dd className="mt-1.5 text-[15px] leading-[1.5] text-ink">{a}</dd>
                  </div>
                ))}
              </dl>
              <p className="t-body mt-6 text-ink">
                SPONDON is an educational instrument, not a medical device. For a concern about your voice, see a speech
                and language therapist.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
