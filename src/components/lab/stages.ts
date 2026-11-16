import { frac, gap, m, paren, sub, sum, sup } from "@/components/docs/math";
import type { Provenance } from "@/components/instrument/controls";
import type { TraceKind } from "@/components/instrument/draw";
import type { TraceStageId } from "@/store/lab-store";

/** The control a stage offers on the trace page: switch the stage off, or turn its one knob. */
export type StageControl = "preEmphasis" | "window" | "order" | null;

export interface StageSpec {
  id: TraceStageId;
  /** Short name, for the stage list and the next/previous links. */
  name: string;
  title: string;
  kind: Provenance;
  beforeTitle: string;
  beforeSub: string;
  beforeTrace: TraceKind;
  afterTitle: string;
  afterSub: string;
  afterTrace: TraceKind | "plate";
  control: StageControl;
  why: string;
  /** The stage's equation, as MathML, and in words for a screen reader. */
  formula: { ml: string; label: string };
}

export const TRACE_STAGES: readonly StageSpec[] = [
  {
    id: 1,
    name: "Samples",
    title: "From sound pressure to 12,000 numbers a second",
    kind: "measured",
    beforeTitle: "The incoming wave",
    beforeSub: "At the device rate, usually 48 kHz",
    beforeTrace: "voice",
    afterTitle: "512 samples at 12 kHz",
    afterSub: "A 42.7 ms frame, Nyquist frequency 6 kHz",
    afterTrace: "samples",
    control: null,
    why: "The first three formants all lie below about 4 kHz. Low-pass filtering and keeping one sample in four puts every bin of the spectrum and every pole of the model inside 0 to 6 kHz, where the vowel information is, and cuts the arithmetic to a quarter.",
    formula: {
      ml: m("y[n] =") + sum(m("k"), "") + m("h[k] x[nD − k]"),
      label: "y of n equals the sum over k of h of k times x of n D minus k",
    },
  },
  {
    id: 2,
    name: "Pre-emphasis",
    title: "Lifting the highs",
    kind: "measured",
    beforeTitle: "The decimated frame",
    beforeSub: "Voiced speech loses about 6 dB per octave",
    beforeTrace: "rawDecimated",
    afterTitle: "After the one-tap filter",
    afterSub: "The overall slope is flattened, so the upper formants stand out",
    afterTrace: "preEmphasized",
    control: "preEmphasis",
    why: "Without pre-emphasis the model spends its poles describing the overall downward slope of the voice instead of its resonances. Switch it off and watch F2 and F3 broaden or move.",
    formula: {
      ml: m("y[n] = x[n] − α x[n − 1]") + gap + m("α = 0.97"),
      label: "y of n equals x of n minus alpha times x of n minus 1, with alpha 0.97",
    },
  },
  {
    id: 3,
    name: "Window",
    title: "Tapering the frame",
    kind: "measured",
    beforeTitle: "The frame cut out bluntly",
    beforeSub: "The signal stops abruptly at n = 0 and n = 511",
    beforeTrace: "preEmphasized",
    afterTitle: "The windowed frame",
    afterSub: "Both ends are brought smoothly to zero",
    afterTrace: "windowed",
    control: "window",
    why: "An abrupt cut acts like a sharp edge in time, and its energy spreads across the whole spectrum. A rectangular window's highest sidelobe is only 13 dB down; Hamming brings it to about 43 dB down, at the cost of a wider main lobe.",
    formula: {
      ml: m("w[n] = 0.54 − 0.46 cos") + paren(frac(m("2πn"), m("N − 1"))) + gap + sub(m("x"), m("w")) + m("[n] = y[n] w[n]"),
      label: "Hamming window: w of n equals 0.54 minus 0.46 cosine of 2 pi n over N minus 1",
    },
  },
  {
    id: 4,
    name: "FFT",
    title: "A 1,024-point Fourier transform",
    kind: "measured",
    beforeTitle: "The windowed frame",
    beforeSub: "512 samples, padded with 512 zeros",
    beforeTrace: "windowed",
    afterTitle: "The magnitude spectrum",
    afterSub: "512 bins from 0 to 6 kHz, 11.7 Hz apart, harmonics marked",
    afterTrace: "fftHarmonics",
    control: "window",
    why: "The spectrum is a comb of harmonics, one every F0 hertz. The formants are the hills the comb rides on, not its tallest teeth: picking the highest bin finds a harmonic, not a resonance. That is why the next stages fit a model.",
    formula: {
      ml: m("X[k] =") + sum(m("n = 0"), m("N − 1")) + sub(m("x"), m("w")) + m("[n]") + sup(m("e"), m("− j 2π k n / N")),
      label: "X of k equals the sum from n equals 0 to N minus 1 of the windowed frame times e to the minus j 2 pi k n over N",
    },
  },
  {
    id: 5,
    name: "Pitch",
    title: "Finding the pitch",
    kind: "measured",
    beforeTitle: "The repeating wave",
    beforeSub: "One glottal pulse every T0 = 1 / F0 seconds",
    beforeTrace: "pitch",
    afterTitle: "The self-similarity curve n(τ)",
    afterSub: "The first peak within 90% of the highest one gives the period",
    afterTrace: "nsdf",
    control: null,
    why: "n(τ) compares the wave with itself shifted by τ samples, normalised to lie between −1 and 1 whatever the loudness. Taking the first strong peak, not the highest, avoids reading an octave too low; a parabola through the peak refines the period to a fraction of a sample.",
    formula: {
      ml:
        m("n(τ) =") +
        frac(
          m("2") + sum(m("j"), "") + m("x[j] x[j + τ]"),
          sum(m("j"), "") + paren(sup(m("x[j]"), m("2")) + m("+") + sup(m("x[j + τ]"), m("2"))),
        ) +
        gap +
        sub(m("F"), m("0")) +
        m("=") +
        frac(sub(m("f"), m("s")), m("τ")),
      label: "n of tau equals twice the sum of x j times x j plus tau, over the sum of their squares; F0 equals the sampling rate over tau",
    },
  },
  {
    id: 6,
    name: "Envelope",
    title: "Linear prediction: the all-pole envelope",
    kind: "derived",
    beforeTitle: "The jagged harmonic spectrum",
    beforeSub: "The harmonics hide the shape of the vocal tract",
    beforeTrace: "fft",
    afterTitle: "The envelope over the spectrum",
    afterSub: "Levinson–Durbin, in O(p²) steps",
    afterTrace: "spectrum",
    control: "order",
    why: "Each sample is predicted from the twelve before it. The weights that leave the smallest error describe an all-pole filter: a model of the tract without the source. With order 4 the model can draw only two peaks; with 24 it starts to follow individual harmonics.",
    formula: {
      ml: m("H(z) =") + frac(m("G"), m("1 −") + sum(m("k = 1"), m("p")) + sub(m("a"), m("k")) + sup(m("z"), m("− k"))),
      label: "H of z equals G over 1 minus the sum from k equals 1 to p of a k times z to the minus k",
    },
  },
  {
    id: 7,
    name: "Poles",
    title: "The poles: roots of A(z)",
    kind: "derived",
    beforeTitle: "The coefficients of A(z)",
    beforeSub: "a[1..p] in cyan, the normalised autocorrelation faint",
    beforeTrace: "lpcCoeffs",
    afterTitle: "The roots, inside the unit circle",
    afterSub: "Found by Durand–Kerner iteration",
    afterTrace: "zplane",
    control: "order",
    why: "Two formants close together can merge into one peak of the envelope, but they stay two separate poles. The first upper-half-plane poles in the ranges a vocal tract can produce, each narrower than 500 Hz, are taken as F1, F2 and F3.",
    formula: {
      ml:
        sub(m("z"), m("k")) +
        m("=") +
        sub(m("r"), m("k")) +
        sup(m("e"), m("± j") + sub(m("θ"), m("k"))) +
        gap +
        m("F =") +
        frac(m("θ") + sub(m("f"), m("s")), m("2π")) +
        gap +
        m("B = −") +
        frac(m("ln r ·") + sub(m("f"), m("s")), m("π")),
      label: "A pole z k equals r k times e to the plus or minus j theta k. Its frequency F is theta times the sampling rate over 2 pi; its bandwidth B is minus the natural log of r times the sampling rate over pi",
    },
  },
  {
    id: 8,
    name: "Vowel and figure",
    title: "The vowel chart and the sand figure",
    kind: "mapped",
    beforeTitle: "The formants on the vowel chart",
    beforeSub: "Distance to eight reference vowels, on the Bark scale",
    beforeTrace: "vowel",
    afterTitle: "The figure",
    afterSub: "A drawing rule: F1 chooses m, F2 chooses n",
    afterTrace: "plate",
    control: null,
    why: "F1 falls as the tongue rises and F2 rises as it moves forward, so the two formants place a vowel on a map of the mouth. The figure is not a measurement: it gives each vowel a shape you can recognise, the way Chladni's sand made a plate's vibration visible.",
    formula: {
      ml: m("C(x, y) = cos(nπx) cos(mπy) − cos(mπx) cos(nπy)"),
      label: "C of x y equals cos n pi x cos m pi y minus cos m pi x cos n pi y",
    },
  },
];
