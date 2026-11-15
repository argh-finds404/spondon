/** Time-domain pitch (McLeod Pitch Method) and cycle-to-cycle stability measures. */

export const PITCH_RANGE_HZ = [75, 450] as const;

export interface PitchResult {
  f0Hz: number;
  /** NSDF value at the chosen peak, 0..1. */
  confidence: number;
  /** Refined fundamental period lag τ in samples (0 when none). */
  lagTau?: number;
}

const scratch = new Map<number, { nsdf: Float32Array; prefix: Float64Array }>();

/**
 * Normalised square difference function n(τ) = 2 r(τ) / m(τ), then the first key maximum
 * within 90% of the highest one, refined by a parabola through its neighbours.
 */
export function detectPitchF0(
  buffer: Float32Array,
  sampleRate: number,
  out: PitchResult = { f0Hz: 0, confidence: 0, lagTau: 0 },
  nsdfOut?: Float32Array,
): PitchResult {
  const n = buffer.length;
  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_RANGE_HZ[1]));
  const maxLag = Math.min(Math.ceil(sampleRate / PITCH_RANGE_HZ[0]), (n >> 1) - 1);
  out.f0Hz = 0;
  out.confidence = 0;
  out.lagTau = 0;
  if (nsdfOut) nsdfOut.fill(0);
  if (maxLag <= minLag) return out;

  let s = scratch.get(n);
  if (!s) scratch.set(n, (s = { nsdf: new Float32Array((n >> 1) + 2), prefix: new Float64Array(n + 1) }));
  const { nsdf, prefix } = s;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + buffer[i] * buffer[i];
  if (prefix[n] < 1e-12) return out;

  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let r = 0;
    for (let j = 0; j < n - tau; j++) r += buffer[j] * buffer[j + tau];
    const m = prefix[n - tau] + prefix[n] - prefix[tau];
    nsdf[tau] = m > 0 ? (2 * r) / m : 0;
  }
  if (nsdfOut) {
    const copyLen = Math.min(nsdfOut.length, maxLag + 2);
    for (let tau = 0; tau < copyLen; tau++) nsdfOut[tau] = nsdf[tau];
  }

  // Leave the lobe around lag 0, then collect the highest point of each positive lobe.
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;
  let highest = 0;
  let pick = -1;
  // Two passes over the lobes: find the highest key maximum, then the first one near it.
  for (let pass = 0; pass < 2 && pick < 0; pass++) {
    let t = tau;
    while (t <= maxLag) {
      while (t <= maxLag && nsdf[t] <= 0) t++;
      let lobeTau = -1;
      let lobeMax = 0;
      while (t <= maxLag && nsdf[t] > 0) {
        if (t >= minLag && nsdf[t] > lobeMax && nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1]) {
          lobeMax = nsdf[t];
          lobeTau = t;
        }
        t++;
      }
      if (lobeTau < 0) continue;
      if (pass === 0) {
        if (lobeMax > highest) highest = lobeMax;
      } else if (lobeMax >= 0.9 * highest) {
        pick = lobeTau;
        break;
      }
    }
    if (highest <= 0) return out;
  }
  if (pick < 0) return out;

  const y0 = nsdf[pick - 1];
  const y1 = nsdf[pick];
  const y2 = nsdf[pick + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const refinedTau = pick + shift;
  out.lagTau = refinedTau;
  out.f0Hz = sampleRate / refinedTau;
  out.confidence = Math.min(1, y1 - 0.25 * (y0 - y2) * shift);
  return out;
}

export interface CycleStats {
  jitterPercent: number;
  shimmerDb: number;
  /** Glottal periods measured in this frame. */
  cycles: number;
}

const MAX_PEAKS = 1024;
const peakPos = new Float64Array(MAX_PEAKS);
const peakAmp = new Float64Array(MAX_PEAKS);

function argmax(x: Float32Array, sign: number, lo: number, hi: number): number {
  let best = lo;
  let bestV = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const v = x[i] * sign;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

/**
 * Mark one peak per glottal cycle (each search centred a period after the last peak,
 * positions refined to a fraction of a sample), then:
 *   local jitter  = mean |T(i) - T(i+1)| / mean T * 100
 *   local shimmer = mean |20 log10(A(i+1) / A(i))|
 * Run this on the full-rate signal: period resolution scales with the sample rate.
 *
 * shortcut: peak marking reads about 1.2-1.4x high (more above 200 Hz) because one cycle's
 * ringing shifts the next peak; mark closure instants on the LPC residual if the figure must be quantitative.
 */
export function measureCycles(
  x: Float32Array,
  sampleRate: number,
  f0Hz: number,
  out: CycleStats = { jitterPercent: 0, shimmerDb: 0, cycles: 0 },
): CycleStats {
  out.jitterPercent = 0;
  out.shimmerDb = 0;
  out.cycles = 0;
  const n = x.length;
  const period = sampleRate / f0Hz;
  if (!(f0Hz > 0) || period * 4 > n) return out;

  let hi = 0;
  let lo = 0;
  for (let i = 0; i < n; i++) {
    if (x[i] > hi) hi = x[i];
    else if (x[i] < lo) lo = x[i];
  }
  const sign = -lo > hi ? -1 : 1;
  if (Math.max(hi, -lo) < 1e-6) return out;

  // Walk back from the strongest peak to the earliest one, then forward collecting all.
  let cur = argmax(x, sign, 1, n - 2);
  for (;;) {
    const a = Math.round(cur - 1.18 * period);
    if (a < 1) break;
    cur = argmax(x, sign, a, Math.round(cur - 0.82 * period));
  }
  let count = 0;
  while (count < MAX_PEAKS) {
    const y0 = x[cur - 1] * sign;
    const y1 = x[cur] * sign;
    const y2 = x[cur + 1] * sign;
    const denom = y0 - 2 * y1 + y2;
    let shift = denom < 0 ? (0.5 * (y0 - y2)) / denom : 0;
    if (shift > 0.5) shift = 0.5;
    else if (shift < -0.5) shift = -0.5;
    peakPos[count] = cur + shift;
    peakAmp[count] = Math.max(y1 - 0.25 * (y0 - y2) * shift, 1e-9);
    count++;
    const b = Math.round(cur + 1.18 * period);
    if (b > n - 2) break;
    cur = argmax(x, sign, Math.round(cur + 0.82 * period), b);
  }
  if (count < 4) return out;

  let sumT = 0;
  let sumDT = 0;
  let sumDA = 0;
  for (let i = 1; i < count; i++) {
    const t = peakPos[i] - peakPos[i - 1];
    sumT += t;
    sumDA += Math.abs(20 * Math.log10(peakAmp[i] / peakAmp[i - 1]));
    if (i > 1) sumDT += Math.abs(t - (peakPos[i - 1] - peakPos[i - 2]));
  }
  const periods = count - 1;
  out.cycles = periods;
  out.jitterPercent = (sumDT / (periods - 1) / (sumT / periods)) * 100;
  out.shimmerDb = sumDA / periods;
  return out;
}

const RING = 30;

/** Rolling 30-frame median of jitter and shimmer, plus a syllable-rate estimate. */
export class StabilityTracker {
  private jitter = new Float32Array(RING);
  private shimmer = new Float32Array(RING);
  private sorted = new Float32Array(RING);
  private filled = 0;
  private head = 0;

  private envelope = 0;
  private peak = 0;
  private above = false;
  private lastMs = 0;
  private onsets = new Float64Array(32);
  private onsetHead = 0;

  jitterPercent = 0;
  shimmerDb = 0;
  syllablesPerSec = 0;

  private median(ring: Float32Array): number {
    const s = this.sorted.subarray(0, this.filled);
    s.set(ring.subarray(0, this.filled));
    s.sort();
    return s[this.filled >> 1];
  }

  pushCycles(stats: CycleStats): void {
    if (stats.cycles < 3) return;
    this.jitter[this.head] = stats.jitterPercent;
    this.shimmer[this.head] = stats.shimmerDb;
    this.head = (this.head + 1) % RING;
    if (this.filled < RING) this.filled++;
    this.jitterPercent = this.median(this.jitter);
    this.shimmerDb = this.median(this.shimmer);
  }

  /** Forget the cycle history, e.g. after a stretch of silence. */
  clearCycles(): void {
    this.filled = 0;
    this.head = 0;
    this.jitterPercent = 0;
    this.shimmerDb = 0;
  }

  /**
   * Syllable nuclei show up as bumps of the short-time energy in the 2-8 Hz band.
   * Smooth the level (about 40 ms), count rises through 60% of a slowly decaying peak
   * (re-armed below 30%), and report onsets per second over the last 4 s.
   */
  updateCadence(rms: number, timestampMs: number): void {
    const dt = this.lastMs ? Math.min(100, Math.max(1, timestampMs - this.lastMs)) : 16;
    this.lastMs = timestampMs;
    this.envelope += (rms - this.envelope) * (1 - Math.exp(-dt / 40));
    this.peak = Math.max(this.envelope, this.peak * Math.exp(-dt / 1500));
    if (!this.above && this.envelope > 0.6 * this.peak && this.envelope > 0.003) {
      this.above = true;
      this.onsets[this.onsetHead] = timestampMs;
      this.onsetHead = (this.onsetHead + 1) % this.onsets.length;
    } else if (this.above && this.envelope < 0.3 * this.peak) {
      this.above = false;
    }
    let recent = 0;
    for (let i = 0; i < this.onsets.length; i++) {
      const t = this.onsets[i];
      if (t > 0 && timestampMs - t <= 4000) recent++;
    }
    this.syllablesPerSec = recent / 4;
  }
}
