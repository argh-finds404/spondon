/**
 * A source-filter voice: a jittered impulse train, tilted like a glottal source, through
 * three two-pole resonators. Because its poles are known exactly, it is both the
 * no-microphone voice of the instrument and the ground truth the analyser is tested against.
 */

export type Formants3 = readonly [number, number, number];

export interface FormantKeyframe {
  tSec: number;
  formants: Formants3;
}

export interface VoiceSynthOptions {
  sampleRate: number;
  f0Hz: number;
  /** Either a fixed vowel plus durationSec, or keyframes; the last keyframe time is the length. */
  formants?: Formants3;
  durationSec?: number;
  track?: FormantKeyframe[];
  /** Target local jitter in percent (mean |ΔT| / mean T). */
  jitterPercent?: number;
  /** Target local shimmer in dB. */
  shimmerDb?: number;
  bandwidthsHz?: Formants3;
  /** Corner of the one-pole source tilt, in Hz; 0 leaves the impulse train flat. */
  tiltHz?: number;
  seed?: number;
}

export const DEFAULT_BANDWIDTHS: Formants3 = [70, 90, 130];
/** Matches a pre-emphasis of 0.97 at 12 kHz, so analysis undoes it. */
export const DEFAULT_TILT_HZ = 58;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formantAt(track: FormantKeyframe[], tSec: number, index: number): number {
  let i = 0;
  while (i < track.length - 2 && tSec >= track[i + 1].tSec) i++;
  const a = track[i];
  const b = track[Math.min(i + 1, track.length - 1)];
  const span = b.tSec - a.tSec;
  const u = span > 0 ? Math.min(1, Math.max(0, (tSec - a.tSec) / span)) : 0;
  return a.formants[index] + (b.formants[index] - a.formants[index]) * u;
}

/**
 * Render one seamless loop. The excitation and the filters both wrap, so the
 * buffer can be played end to end, or read circularly, without a click.
 */
export function synthesizeVoice(opts: VoiceSynthOptions): Float32Array<ArrayBuffer> {
  const sr = opts.sampleRate;
  const track: FormantKeyframe[] =
    opts.track ?? [
      { tSec: 0, formants: opts.formants ?? [500, 1500, 2500] },
      { tSec: opts.durationSec ?? 1, formants: opts.formants ?? [500, 1500, 2500] },
    ];
  const length = Math.max(64, Math.round(track[track.length - 1].tSec * sr));
  const out = new Float32Array(length);
  const rand = mulberry32(opts.seed ?? 1);
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  // For independent Gaussian perturbations, E|x(i) - x(i+1)| = 2σ/√π.
  const sigmaT = ((opts.jitterPercent ?? 0) / 100) * (Math.sqrt(Math.PI) / 2);
  const sigmaA = (opts.shimmerDb ?? 0) * (Math.sqrt(Math.PI) / 2 / 8.686);
  const period = sr / opts.f0Hz;

  // 1. Impulse train. Pulses land between samples, split linearly over two neighbours.
  //    Periods are perturbed, then scaled together so whole cycles fill the loop exactly.
  const cycles = Math.max(1, Math.round(length / period));
  const periods = new Float64Array(cycles);
  let total = 0;
  for (let c = 0; c < cycles; c++) {
    periods[c] = Math.max(0.5, 1 + sigmaT * gauss());
    total += periods[c];
  }
  let t = 0;
  for (let c = 0; c < cycles; c++) {
    const i = Math.floor(t) % length;
    const frac = t - Math.floor(t);
    const amp = Math.max(0.05, 1 + sigmaA * gauss());
    out[i] += amp * (1 - frac);
    out[(i + 1) % length] += amp * frac;
    t += (periods[c] * length) / total;
  }

  // 2 and 3. Tilt and resonators, run twice around the loop so the second lap starts
  //    from the state the first lap ended in.
  const tilt = opts.tiltHz === 0 ? 0 : Math.exp((-2 * Math.PI * (opts.tiltHz ?? DEFAULT_TILT_HZ)) / sr);
  const bw = opts.bandwidthsHz ?? DEFAULT_BANDWIDTHS;
  const r = [0, 1, 2].map((k) => Math.exp((-Math.PI * bw[k]) / sr));
  const c1 = [0, 0, 0];
  const c2 = [0, 0, 0];
  const y1 = [0, 0, 0];
  const y2 = [0, 0, 0];
  const src = out.slice();
  let tiltState = 0;
  for (let lap = 0; lap < 2; lap++) {
    for (let n = 0; n < length; n++) {
      if ((n & 63) === 0) {
        const tSec = n / sr;
        for (let k = 0; k < 3; k++) {
          const theta = (2 * Math.PI * formantAt(track, tSec, k)) / sr;
          c1[k] = 2 * r[k] * Math.cos(theta);
          c2[k] = r[k] * r[k];
        }
      }
      tiltState = src[n] + tilt * tiltState;
      let v = tiltState;
      for (let k = 0; k < 3; k++) {
        const y = v + c1[k] * y1[k] - c2[k] * y2[k];
        y2[k] = y1[k];
        y1[k] = y;
        v = y;
      }
      out[n] = v;
    }
  }

  // Remove the mean the tilt leaves behind, then normalise the peak.
  let mean = 0;
  for (let n = 0; n < length; n++) mean += out[n];
  mean /= length;
  let peak = 1e-9;
  for (let n = 0; n < length; n++) {
    out[n] -= mean;
    const a = Math.abs(out[n]);
    if (a > peak) peak = a;
  }
  const scale = 0.8 / peak;
  for (let n = 0; n < length; n++) out[n] *= scale;
  return out;
}
