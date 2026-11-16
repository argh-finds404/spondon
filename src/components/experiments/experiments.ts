import { frac, gap, m, paren, sub, sum, sup } from "@/components/docs/math";
import type { ExperimentId } from "@/store/lab-store";

export interface Experiment {
  id: ExperimentId;
  /** The stage of the analysis it breaks. */
  stage: string;
  /** The question, used as the page title. */
  title: string;
  /** What you do, in one sentence. */
  task: string;
  /** What to look for. */
  watch: string;
  why: string;
  formula: { ml: string; label: string };
}

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: 1,
    stage: "Window",
    title: "Why window a signal?",
    task: "Swap the Hamming window for a plain rectangular cut, then try Hann and Blackman.",
    watch: "The floor between the harmonics rises with the rectangular cut, and the envelope loses some of its shape.",
    why: "Cutting 512 samples out of a voice stops the wave abruptly at both ends. That edge spreads energy from every harmonic into its neighbours: spectral leakage. A rectangular window's highest sidelobe is only 13 dB below its peak; Hamming's is 43 dB below. The price is a main lobe twice as wide, so close peaks blur a little.",
    formula: {
      ml:
        sub(m("w"), m("Hamming")) +
        m("[n] = 0.54 − 0.46 cos") +
        paren(frac(m("2πn"), m("N − 1"))) +
        gap +
        sub(m("w"), m("rect")) +
        m("[n] = 1"),
      label: "Hamming window: w of n equals 0.54 minus 0.46 cosine of 2 pi n over N minus 1. Rectangular window: w of n equals 1",
    },
  },
  {
    id: 2,
    stage: "Pre-emphasis",
    title: "Why lift the highs before the model?",
    task: "Switch pre-emphasis off, so α = 0, and back on.",
    watch: "The high band of the spectrum sags, and F2 and F3 broaden or drift.",
    why: "A voiced sound loses about 6 dB of energy per octave, so F2 and F3 are far weaker than F1. Linear prediction fits the strongest features first; without the lift it spends its poles on that overall slope, and the upper formants get fewer poles than they need.",
    formula: {
      ml: m("y[n] = x[n] − α x[n − 1]") + gap + sub(m("H"), m("pre")) + m("(z) = 1 − α") + sup(m("z"), m("− 1")),
      label: "y of n equals x of n minus alpha times x of n minus 1. As a filter: H pre of z equals 1 minus alpha z to the minus 1",
    },
  },
  {
    id: 3,
    stage: "Model order",
    title: "How many poles does a voice need?",
    task: "Move the model order from 12 down to 4, then up to 24.",
    watch: "At 4 the formants merge into broad humps; at 24 the envelope starts to follow single harmonics.",
    why: "Each resonance needs one pair of poles. At a 12 kHz analysis rate the tract has about five resonances below 6 kHz, and a couple of extra poles describe the overall slope: hence 12. With 4 poles there are only two peaks to draw; with 24 the spare poles fit the harmonic ripple of the source instead of the tract.",
    formula: {
      ml: m("H(z) =") + frac(m("G"), m("1 −") + sum(m("k = 1"), m("p")) + sub(m("a"), m("k")) + sup(m("z"), m("− k"))),
      label: "H of z equals G over 1 minus the sum from k equals 1 to p of a k z to the minus k",
    },
  },
  {
    id: 4,
    stage: "Spectrum and pitch",
    title: "What does pitch do to the spectrum?",
    task: "Raise and lower the pitch of the synthetic voice while it holds one vowel.",
    watch: "The harmonics spread apart as the pitch rises, but the envelope, and the vowel, stay where they are.",
    why: "A voice is a source and a filter. The source is a train of pulses, one every T0 seconds, so its spectrum is a comb with teeth F0 apart. The filter is the mouth, and it does not care about the pitch. That is why the same vowel can be sung on any note, and why formants are read from the envelope, not from the harmonics.",
    formula: {
      ml: sub(m("T"), m("0")) + m("=") + frac(m("1"), sub(m("F"), m("0"))) + gap + m("Δ f =") + sub(m("F"), m("0")),
      label: "The period T0 equals 1 over F0, and the harmonics are F0 apart",
    },
  },
  {
    id: 5,
    stage: "Poles",
    title: "What does a pole actually do?",
    task: "Drag the F1 or F2 pole inside the circle, or use a preset. Arrow keys move the chosen pole.",
    watch: "Turning a pole moves its formant; pulling it toward the circle sharpens the resonance. The vowel follows.",
    why: "Every formant is a pair of poles mirrored across the real axis. The angle of the pole is the formant's frequency. Its distance from the unit circle is its damping: close to the circle the resonance rings long and narrow, further in it is short and broad.",
    formula: {
      ml:
        sub(m("z"), m("k")) +
        m("=") +
        sub(m("r"), m("k")) +
        sup(m("e"), m("± j") + sub(m("θ"), m("k"))) +
        gap +
        sub(m("F"), m("k")) +
        m("=") +
        frac(sub(m("θ"), m("k")) + sub(m("f"), m("s")), m("2π")) +
        gap +
        sub(m("B"), m("k")) +
        m("= −") +
        frac(m("ln") + sub(m("r"), m("k")) + m("·") + sub(m("f"), m("s")), m("π")),
      label:
        "A pole z k equals r k times e to the plus or minus j theta k. Its formant frequency is theta k times the sampling rate over 2 pi; its bandwidth is minus the natural log of r k times the sampling rate over pi",
    },
  },
];

export function findExperiment(id: number): Experiment | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
