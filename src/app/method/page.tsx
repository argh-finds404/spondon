import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { abs, Eq, frac, gap, hat, m, paren, sqrt, sub, sum, sup, text } from "@/components/docs/math";
import { Prov, type Provenance } from "@/components/instrument/controls";
import type { TraceKind } from "@/components/instrument/draw";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { Footer, REPO_URL } from "@/components/site/Footer";
import { WINDOW_INFO, WINDOW_TYPES } from "@/lib/dsp/windows";

export const metadata: Metadata = {
  title: "Method",
  description:
    "How SPONDON turns a frame of voice into a vowel and a figure: decimation, windowing, the FFT, pitch by the McLeod method, linear prediction, poles and formants, jitter, Bark distance. With the equations and a live trace for each stage.",
};

type Value = { label: string; field: ReadoutField; unit?: string };

function Stage({
  id,
  title,
  kind,
  trace,
  picture,
  values,
  plate,
  children,
}: {
  id: string;
  title: string;
  kind: Provenance;
  trace?: TraceKind;
  picture: string;
  values: Value[];
  plate?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className="wrap grid12 gap-y-8 py-[calc(var(--section)/3)]">
      <div className="col-span-12 lg:col-span-6">
        <h2 className="t-head">{title}</h2>
        <div className="mt-6 flex max-w-[62ch] flex-col gap-4">{children}</div>
      </div>
      <div className="col-span-12 lg:col-span-5 lg:col-start-8">
        <div data-ui className="ui-panel lg:sticky lg:top-[calc(var(--nav-h)+24px)]">
          {plate ? (
            <PlateStage showNodalLines className="aspect-square w-full" />
          ) : (
            <Trace kind={trace ?? "voice"} inspect label={picture} className="h-[240px] w-full lg:h-[300px]" />
          )}
          <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-line px-3 py-3">
            <div>
              <dt className="ui-label">Kind</dt>
              <dd className="mt-0.5 text-[13px] text-ink">
                <Prov kind={kind} />
              </dd>
            </div>
            {values.map((v) => (
              <div key={v.field}>
                <dt className="ui-label">{v.label}</dt>
                <dd className="ui-fig mt-0.5 text-[13px] text-ink">
                  <Readout field={v.field} />
                  {v.unit ? ` ${v.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

const P = ({ children }: { children: ReactNode }) => <p className="t-body text-ink">{children}</p>;

const STAGES = [
  ["capture", "Capture and decimate"],
  ["pitch", "Pitch"],
  ["window", "Pre-emphasis and window"],
  ["spectrum", "Spectrum"],
  ["lpc", "Linear prediction"],
  ["poles", "Poles and formants"],
  ["stability", "Jitter and shimmer"],
  ["vowel", "Vowel distance"],
  ["figure", "The figure"],
  ["checks", "How it is checked"],
] as const;

export default function MethodPage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 gap-y-10 pt-[calc(var(--section)/2)] pb-10">
          <div className="col-span-12 lg:col-span-7">
            <h1 className="t-head">From a frame of voice to a figure.</h1>
            <p className="t-lead mt-6 max-w-[44ch] text-ink">
              Sixty times a second SPONDON takes the newest stretch of sound and runs it through the chain below. Each
              stage has its equation and a live trace of the signal passing through it right now.
            </p>
            <p className="t-body mt-5 max-w-[58ch] text-ink">
              If you are taking a first course in signal processing, each stage is one chapter of it: sampling and
              decimation, windows and leakage, the DFT, autocorrelation, all-pole models, the z-plane.
            </p>
          </div>
          <nav aria-label="Stages" className="col-span-12 lg:col-span-4 lg:col-start-9">
            <ol className="t-small grid grid-cols-2 gap-x-6 text-ink lg:grid-cols-1">
              {STAGES.map(([id, title]) => (
                <li key={id}>
                  <a href={`#${id}`} className="link inline-flex min-h-9 items-center">
                    {title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <Stage
          id="capture"
          title="Capture and decimate"
          kind="measured"
          trace="samples"
          picture="The incoming wave as discrete samples"
          values={[
            { label: "Sampled at", field: "sampleRate", unit: "Hz" },
            { label: "Analysed at", field: "analysisRate", unit: "Hz" },
          ]}
        >
          <P>
            The browser delivers audio at 44.1 or 48 kHz. The resonances that tell vowels apart all lie below about
            4 kHz, so the signal is low-pass filtered and only every fourth sample is kept. A 6 kHz bandwidth is
            plenty for three formants, and everything after this costs a quarter as much.
          </P>
          <Eq
            label="y of n equals the sum over k of h of k times x of n D minus k"
            ml={m("y[n] =") + sum(m("k"), "") + m("h[k] x[nD − k]")}
          />
          <P>
            The filter h is a 49-tap sinc shaped by a Hamming window, cut off at 90% of the new Nyquist frequency so
            that nothing above it folds back.
          </P>
        </Stage>

        <Stage
          id="pitch"
          title="Pitch"
          kind="measured"
          trace="pitch"
          picture="The wave with a mark at each pitch period"
          values={[
            { label: "F0", field: "f0", unit: "Hz" },
            { label: "Note", field: "note" },
            { label: "Period", field: "period", unit: "ms" },
            { label: "Clarity", field: "clarity" },
          ]}
        >
          <P>
            A voiced sound repeats. The McLeod pitch method measures how well 85 ms of signal matches itself shifted
            by a lag τ, normalised so that a perfect repeat scores 1 whatever the loudness.
          </P>
          <Eq
            label="n of tau equals twice the sum of x j times x j plus tau, over the sum of x j squared plus x j plus tau squared"
            ml={
              m("n(τ) =") +
              frac(m("2") + sum(m("j"), "") + m("x[j] x[j + τ]"), sum(m("j"), "") + paren(sup(m("x[j]"), m("2")) + m("+") + sup(m("x[j + τ]"), m("2"))))
            }
          />
          <P>
            The pitch period is the first peak of n(τ) that comes within 90% of the highest one, refined to a fraction
            of a sample by fitting a parabola through its neighbours. Taking the first such peak and not the highest
            is what stops the reading dropping an octave. The search covers 75 to 450 Hz, and the height of the peak
            is reported as clarity: below 0.6 the frame is treated as unvoiced.
          </P>
        </Stage>

        <Stage
          id="window"
          title="Pre-emphasis and window"
          kind="measured"
          trace="scope"
          picture="The frame before and after the window"
          values={[
            { label: "Window", field: "window" },
            { label: "Frame", field: "frameMs", unit: "ms" },
          ]}
        >
          <P>
            A voice loses about 6 dB per octave towards high frequencies. A one-tap filter lifts the highs back so
            that the model in the next stages spends its effort on resonances, not on the slope.
          </P>
          <Eq label="y of n equals x of n minus 0.97 times x of n minus 1" ml={m("y[n] = x[n] − 0.97 x[n − 1]")} />
          <P>
            Then 512 samples are cut out and multiplied by a window. Cutting a signal off abruptly smears each
            frequency across its neighbours; tapering the ends trades that leakage for a wider main lobe.
          </P>
          <Eq
            label="Hamming window: w of n equals 0.54 minus 0.46 cosine of 2 pi n over N minus 1"
            ml={m("w[n] = 0.54 − 0.46 cos") + paren(frac(m("2πn"), m("N − 1")))}
          />
          <table data-ui className="w-full text-left text-[13px]">
            <caption className="sr-only">The four windows the lab offers</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 pr-4 font-normal">Window</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Main lobe</th>
                <th scope="col" className="py-2 text-right font-normal">Highest sidelobe</th>
              </tr>
            </thead>
            <tbody>
              {WINDOW_TYPES.map((type) => (
                <tr key={type} className="border-b border-line text-ink last:border-0">
                  <th scope="row" className="py-2 pr-4 font-medium">{WINDOW_INFO[type].label}</th>
                  <td className="ui-fig py-2 pr-4 text-right">{WINDOW_INFO[type].mainLobeBins} bins</td>
                  <td className="ui-fig py-2 text-right">{WINDOW_INFO[type].peakSidelobeDb.toFixed(1)} dB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Stage>

        <Stage
          id="spectrum"
          title="Spectrum"
          kind="measured"
          trace="fft"
          picture="Magnitude spectrum of the frame"
          values={[{ label: "Resolution", field: "binHz", unit: "Hz per bin" }]}
        >
          <P>
            The windowed frame, padded with zeros to 1,024 points, goes through an in-place radix-2 Fourier transform.
            Half of the result is redundant for a real signal, leaving 512 magnitudes from 0 to the Nyquist frequency.
          </P>
          <Eq
            label="X of k equals the sum from n equals 0 to N minus 1 of x n w n e to the minus j 2 pi k n over N"
            ml={m("X[k] =") + sum(m("n = 0"), m("N − 1")) + m("x[n] w[n]") + sup(m("e"), m("− j 2π k n / N"))}
          />
          <P>
            The scale is set so that a full-scale sine reads 0 dB. The regular comb of peaks is the harmonics of the
            voice, spaced at the pitch; the slow rise and fall across them is the vocal tract.
          </P>
        </Stage>

        <Stage
          id="lpc"
          title="Linear prediction"
          kind="derived"
          trace="lpc"
          picture="Spectrum with the linear-prediction envelope over it"
          values={[{ label: "Model order", field: "order", unit: "poles" }]}
        >
          <P>
            Linear prediction supposes that each sample is nearly a weighted sum of the twelve before it. The weights
            that leave the smallest error describe an all-pole filter, and that filter is a model of the vocal tract.
          </P>
          <Eq
            label="x hat of n equals the sum from k equals 1 to p of a k times x of n minus k; H of z equals G over 1 minus the sum of a k z to the minus k"
            ml={
              hat(m("x")) + m("[n] =") + sum(m("k = 1"), m("p")) + sub(m("a"), m("k")) + m("x[n − k]") + gap +
              m("H(z) =") + frac(m("G"), m("1 −") + sum(m("k = 1"), m("p")) + sub(m("a"), m("k")) + sup(m("z"), m("− k")))
            }
          />
          <P>
            The weights come from the autocorrelation of the frame by the Levinson-Durbin recursion, which raises
            the order one step at a time. At each step a reflection coefficient k is found and the error shrinks:
          </P>
          <Eq
            label="k i equals R of i minus the sum of a j R of i minus j, all over E i minus 1; E i equals 1 minus k i squared times E i minus 1"
            ml={
              sub(m("k"), m("i")) + m("=") +
              frac(m("R[i] −") + sum(m("j = 1"), m("i − 1")) + sub(m("a"), m("j")) + m("R[i − j]"), sub(m("E"), m("i − 1"))) +
              gap + sub(m("E"), m("i")) + m("=") + paren(m("1 −") + sup(sub(m("k"), m("i")), m("2"))) + sub(m("E"), m("i − 1"))
            }
          />
          <P>
            Every k stays between −1 and 1, which guarantees a stable filter. The cyan curve is G / |A| evaluated
            around the unit circle, on the same decibel scale as the spectrum under it.
          </P>
        </Stage>

        <Stage
          id="poles"
          title="Poles and formants"
          kind="derived"
          trace="zplane"
          picture="Poles of the model inside the unit circle"
          values={[
            { label: "F1", field: "f1", unit: "Hz" },
            { label: "F2", field: "f2", unit: "Hz" },
            { label: "F3", field: "f3", unit: "Hz" },
            { label: "F1 pole radius", field: "poleRadius" },
          ]}
        >
          <P>
            The denominator A(z) has twelve roots, found by Durand-Kerner iteration from a fixed starting pattern.
            They are the poles of the model. A pole at radius r and angle θ is a resonance:
          </P>
          <Eq
            label="F equals theta times f s over 2 pi; B equals minus the natural log of r times f s over pi"
            ml={m("F =") + frac(m("θ") + sub(m("f"), m("s")), m("2π")) + gap + m("B = −") + frac(m("ln r ·") + sub(m("f"), m("s")), m("π"))}
          />
          <P>
            The angle gives the frequency; the distance from the unit circle gives the bandwidth, so a pole close to
            the circle is a sharp resonance. The first three poles that fall in the ranges a vocal tract can produce
            (F1 220 to 950 Hz, F2 750 to 2,650 Hz, F3 1,800 to 3,600 Hz, each narrower than 500 Hz) are taken as the
            formants. A five-frame median removes the odd frame where two poles swap.
          </P>
        </Stage>

        <Stage
          id="stability"
          title="Jitter and shimmer"
          kind="measured"
          trace="voice"
          picture="Waveform of the voice"
          values={[
            { label: "Jitter", field: "jitter", unit: "%" },
            { label: "Shimmer", field: "shimmer", unit: "dB" },
            { label: "Syllables", field: "syllables", unit: "per s" },
          ]}
        >
          <P>
            No voice repeats exactly. Jitter is how much the length of one cycle differs from the next; shimmer is the
            same for its height. One peak is marked per cycle on the full-rate signal, each placed to a fraction of a
            sample.
          </P>
          <Eq
            label="jitter equals the mean of the absolute difference of consecutive periods over the mean period, times 100 percent; shimmer equals the mean of the absolute value of 20 log base 10 of consecutive amplitude ratios"
            ml={
              text("jitter") + m("=") +
              frac(m("mean") + abs(sub(m("T"), m("i")) + m("−") + sub(m("T"), m("i + 1"))), m("mean") + sub(m("T"), m("i"))) +
              m("× 100 %") + gap + text("shimmer") + m("= mean") +
              abs(m("20") + sub(m("log"), m("10")) + frac(sub(m("A"), m("i + 1")), sub(m("A"), m("i"))))
            }
          />
          <P>
            These readings run high. One cycle&rsquo;s ringing shifts the peak of the next, so on a synthetic voice
            with a known amount of jitter the lab reads about 1.2 to 1.4 times what was put in. Use them to compare
            one take with another, not as clinical figures.
          </P>
        </Stage>

        <Stage
          id="vowel"
          title="Vowel distance"
          kind="derived"
          trace="vowel"
          picture="Vowel chart with the live position and its trail"
          values={[
            { label: "From target", field: "bark", unit: "Bark" },
            { label: "Match", field: "score", unit: "of 100" },
          ]}
        >
          <P>
            The ear does not hear hertz evenly: 100 Hz matters far more at 300 Hz than at 2,500. So the distance from
            the measured vowel to a target is taken on the Bark scale, which follows the bands of hearing.
          </P>
          <Eq
            label="z of f equals 26.81 f over 1960 plus f, minus 0.53; d equals the square root of delta z 1 squared plus delta z 2 squared"
            ml={
              m("z(f) =") + frac(m("26.81 f"), m("1960 + f")) + m("− 0.53") + gap + m("d =") +
              sqrt(sup(m("Δ") + sub(m("z"), m("1")), m("2")) + m("+") + sup(m("Δ") + sub(m("z"), m("2")), m("2")))
            }
          />
          <P>
            The match is 100 · exp(−d² / 2): 100 on the target, 80 about two thirds of a Bark away, which is where the
            lab calls it locked. The hint comes from which formant is further off. F1 rises as the jaw opens; F2 rises
            as the tongue moves forward and the lips spread.
          </P>
        </Stage>

        <Stage
          id="figure"
          title="The figure"
          kind="mapped"
          plate
          picture="Chladni figure for the current vowel"
          values={[
            { label: "m, from F1", field: "modeM" },
            { label: "n, from F2", field: "modeN" },
          ]}
        >
          <P>
            The last stage is a drawing rule, and the page says so wherever the figure appears. The two formants
            choose two mode numbers of a standing wave on a square plate:
          </P>
          <Eq
            label="C of x y equals cosine n pi x times cosine m pi y, minus cosine m pi x times cosine n pi y"
            ml={m("C(x, y) = cos(nπx) cos(mπy) − cos(mπx) cos(nπy)")}
          />
          <P>
            F1 between 200 and 950 Hz sets m between 1 and 4; F2 between 700 and 2,600 Hz sets n between 4.5 and 9.
            Each grain of sand is pushed down the slope of C² and shaken in proportion to the loudness of the voice,
            so it comes to rest where C is zero: the lines a real plate would leave still.
          </P>
          <P>
            A vocal tract is not a plate. The figure is a way of giving each vowel a shape you can recognise, in the
            manner of <Link href="/archive" className="link">Chladni&rsquo;s sand figures of 1787</Link>.
          </P>
        </Stage>

        <section id="checks" className="wrap grid12 gap-y-8 py-[calc(var(--section)/2)]">
          <h2 className="t-head col-span-12 lg:col-span-5">How it is checked.</h2>
          <div className="col-span-12 flex flex-col gap-4 lg:col-span-6 lg:col-start-7">
            <P>
              The built-in voice is a pulse train through three two-pole resonators, so its formants are known
              exactly. It is both the voice you see when no microphone is on and the ground truth for the tests.
            </P>
            <ul className="t-body flex list-disc flex-col gap-2 pl-5 text-ink">
              <li>F1 and F2 recovered within 60 Hz for /ɑː/ and /iː/ at 12, 44.1 and 48 kHz.</li>
              <li>All eight reference vowels resolve to themselves.</li>
              <li>Pitch within 1.5 Hz from 95 to 310 Hz, with no octave error when the fundamental is weak.</li>
              <li>Levinson-Durbin, the root finder and the pole-to-formant conversion against values worked by hand.</li>
              <li>The HTTP API end to end: a synthesised file, sent for analysis, comes back as the vowel it was.</li>
            </ul>
            <P>
              One frame takes about 0.7 ms of arithmetic at 48 kHz. The source and the tests are in the{" "}
              <a href={REPO_URL} rel="noreferrer" className="link">
                repository
              </a>
              , and the same analyser is available over the <Link href="/developers" className="link">HTTP API</Link>.
            </P>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
