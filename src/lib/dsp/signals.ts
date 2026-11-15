/**
 * Classroom test signals: the waveforms every signals course starts with, rendered as seamless
 * loops so the analyser can be pointed at something whose spectrum is known in advance.
 * Periodic ones are built from sines up to 8 kHz (additive synthesis), so they are band-limited
 * and nothing folds back when the analyser decimates.
 */

export const WAVE_KINDS = ["voice", "sine", "square", "saw", "triangle", "twotone", "sweep", "noise", "impulse"] as const;
export type WaveKind = (typeof WAVE_KINDS)[number];
/** Everything except the synthetic voice. */
export type SignalKind = Exclude<WaveKind, "voice">;

export const SIGNAL_INFO: Record<SignalKind, { label: string; spectrum: string }> = {
  sine: { label: "Sine", spectrum: "One line, at its frequency." },
  square: { label: "Square", spectrum: "Odd harmonics only, falling as 1/k." },
  saw: { label: "Sawtooth", spectrum: "Every harmonic, falling as 1/k." },
  triangle: { label: "Triangle", spectrum: "Odd harmonics only, falling as 1/k²." },
  twotone: { label: "Two tones", spectrum: "A strong line and a neighbour 10% higher and 20 dB weaker." },
  sweep: { label: "Sweep", spectrum: "One line that glides from 100 Hz to 3 kHz and back." },
  noise: { label: "White noise", spectrum: "Flat: equal power at every frequency, no pitch." },
  impulse: { label: "Impulse train", spectrum: "Every harmonic at equal strength: a comb." },
};

export const SIGNAL_HZ_RANGE = [50, 2000] as const;
const TOP_HZ = 8000;
const SWEEP_HZ = [100, 3000] as const;

export interface SignalOptions {
  wave: SignalKind;
  /** Fundamental in Hz; ignored by the sweep and the noise. */
  hz: number;
  sampleRate: number;
  durationSec?: number;
  seed?: number;
}

/** Add amp * sin(2π cycles n / N + phase) to out, by rotating a phasor instead of calling sin per sample. */
function addSine(out: Float32Array, cycles: number, amp: number, phase = 0): void {
  const w = (2 * Math.PI * cycles) / out.length;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let c = Math.cos(phase);
  let s = Math.sin(phase);
  for (let n = 0; n < out.length; n++) {
    out[n] += amp * s;
    const nc = c * cw - s * sw;
    s = s * cw + c * sw;
    c = nc;
  }
}

/** One loop, peak 0.8. The fundamental is nudged so a whole number of cycles fits the loop exactly. */
export function generateSignal(opts: SignalOptions): Float32Array<ArrayBuffer> {
  const { wave, sampleRate } = opts;
  const length = Math.round((opts.durationSec ?? 2) * sampleRate);
  const out = new Float32Array(length);
  const hz = Math.min(SIGNAL_HZ_RANGE[1], Math.max(SIGNAL_HZ_RANGE[0], opts.hz));
  const cycles = Math.max(1, Math.round((hz * length) / sampleRate));
  const top = Math.min(TOP_HZ, 0.45 * sampleRate);
  const harmonics = Math.max(1, Math.floor(top / ((cycles * sampleRate) / length)));

  if (wave === "sine") {
    addSine(out, cycles, 1);
  } else if (wave === "square") {
    for (let k = 1; k <= harmonics; k += 2) addSine(out, cycles * k, 4 / (Math.PI * k));
  } else if (wave === "saw") {
    for (let k = 1; k <= harmonics; k++) addSine(out, cycles * k, (k % 2 ? 2 : -2) / (Math.PI * k));
  } else if (wave === "triangle") {
    for (let k = 1; k <= harmonics; k += 2) {
      addSine(out, cycles * k, (((k - 1) / 2) % 2 ? -8 : 8) / (Math.PI * Math.PI * k * k));
    }
  } else if (wave === "twotone") {
    addSine(out, cycles, 1);
    addSine(out, Math.round(cycles * 1.1), 0.1);
  } else if (wave === "impulse") {
    // Cosines in phase add up to one sharp pulse per period.
    for (let k = 1; k <= harmonics; k++) addSine(out, cycles * k, 1, Math.PI / 2);
  } else if (wave === "sweep") {
    // Up for the first half, back down for the second, so the loop closes on itself.
    let phase = 0;
    const half = length / 2;
    for (let n = 0; n < length; n++) {
      const u = n < half ? n / half : (length - n) / half;
      phase += (2 * Math.PI * (SWEEP_HZ[0] + (SWEEP_HZ[1] - SWEEP_HZ[0]) * u)) / sampleRate;
      out[n] = Math.sin(phase);
    }
  } else {
    let a = (opts.seed ?? 1) >>> 0;
    for (let n = 0; n < length; n++) {
      a = (a * 1664525 + 1013904223) >>> 0;
      out[n] = a / 2147483648 - 1;
    }
  }

  let peak = 1e-9;
  for (let n = 0; n < length; n++) {
    const v = out[n] < 0 ? -out[n] : out[n];
    if (v > peak) peak = v;
  }
  const scale = 0.8 / peak;
  for (let n = 0; n < length; n++) out[n] *= scale;
  return out;
}
