import { describe, expect, it } from "vitest";
import { VoiceAnalyzer } from "../analyzer";
import {
  computeAutocorrelation,
  computeRadix2FFT,
  evaluateLPCEnvelopeDb,
  extractFormantsAndPoles,
  findPolynomialRoots,
  solveLevinsonDurbin,
} from "../fft-lpc";
import { detectPitchF0, measureCycles, StabilityTracker } from "../pitch-jitter";
import { synthesizeVoice } from "../synth";
import { evaluateTargetConvergence, findVowel, hzToBark, nearestVowel, VOWEL_TARGETS } from "../vowel-targets";
import { applyPreEmphasis, getWindow, WINDOW_TYPES } from "../windows";

const AA = findVowel("aa");
const II = findVowel("ii");

/** Feed a looped signal through an analyser until its smoothing has settled. */
function settle(analyzer: VoiceAnalyzer, signal: Float32Array, frames = 40) {
  const raw = new Float32Array(analyzer.rawSize);
  const hop = Math.round(analyzer.sampleRate / 60);
  let t = analyzer.telemetry;
  for (let f = 0; f < frames; f++) {
    const end = analyzer.rawSize + f * hop;
    for (let i = 0; i < raw.length; i++) raw[i] = signal[(end - raw.length + i) % signal.length];
    t = analyzer.process(raw, (f * 1000) / 60);
  }
  return t;
}

describe("windows", () => {
  it("Hamming is symmetric, ends at 0.08 and has a coherent gain of 0.54", () => {
    const { w, sum } = getWindow("hamming", 512);
    for (let i = 0; i < 256; i++) expect(w[i]).toBeCloseTo(w[511 - i], 6);
    expect(w[0]).toBeCloseTo(0.08, 6);
    expect(w[511]).toBeCloseTo(0.08, 6);
    expect(Math.max(...w)).toBeLessThanOrEqual(1);
    expect(sum / 512).toBeCloseTo(0.54, 2);
  });

  it("every window peaks at 1 in the middle and tapers no higher at the edges", () => {
    for (const type of WINDOW_TYPES) {
      const { w } = getWindow(type, 513);
      expect(w[256]).toBeCloseTo(1, 6);
      expect(w[0]).toBeLessThanOrEqual(w[256]);
    }
  });

  it("pre-emphasis is y[n] = x[n] - 0.97 x[n-1]", () => {
    const y = applyPreEmphasis(Float32Array.from([1, 1, 1, 0]));
    expect(y[1]).toBeCloseTo(0.03, 6);
    expect(y[3]).toBeCloseTo(-0.97, 6);
  });
});

describe("FFT", () => {
  it("puts a two-tone signal in exactly two bins at the right heights", () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.cos((2 * Math.PI * 50 * i) / n) + 0.5 * Math.sin((2 * Math.PI * 200 * i) / n);
    }
    computeRadix2FFT(re, im);
    const mag = (k: number) => Math.hypot(re[k], im[k]);
    expect(mag(50)).toBeCloseTo(n / 2, 1);
    expect(mag(200)).toBeCloseTo(n / 4, 1);
    for (const k of [0, 49, 51, 120, 199, 201, 400]) expect(mag(k)).toBeLessThan(1e-2);
  });

  it("rejects lengths that are not a power of two", () => {
    expect(() => computeRadix2FFT(new Float32Array(1000), new Float32Array(1000))).toThrow();
  });
});

describe("linear prediction", () => {
  it("Levinson-Durbin recovers the coefficients of a known two-pole filter", () => {
    // h[n] of 1 / (1 - 1.2 z^-1 + 0.72 z^-2), long enough to have decayed.
    const x = new Float32Array(4096);
    x[0] = 1;
    x[1] = 1.2;
    for (let n = 2; n < x.length; n++) x[n] = 1.2 * x[n - 1] - 0.72 * x[n - 2];
    const lpc = solveLevinsonDurbin(computeAutocorrelation(x, 2), 2);
    expect(lpc.a[0]).toBeCloseTo(1.2, 3);
    expect(lpc.a[1]).toBeCloseTo(-0.72, 3);
    expect(lpc.gain).toBeCloseTo(1, 2);
    for (const k of lpc.reflectionK) expect(Math.abs(k)).toBeLessThan(1);
  });

  it("Durand-Kerner finds the roots of a known polynomial", () => {
    // (z - 0.5)(z + 0.25)(z^2 - z + 0.5) = z^4 - 1.25 z^3 + 0.625 z^2 - 0 z - 0.0625
    const a = Float64Array.from([1.25, -0.625, 0, 0.0625]);
    const re = new Float64Array(4);
    const im = new Float64Array(4);
    expect(findPolynomialRoots(a, re, im)).toBe(true);
    const roots = Array.from(re, (r, i) => `${r.toFixed(4)},${Math.abs(im[i]).toFixed(4)}`).sort();
    expect(roots).toEqual(["-0.2500,0.0000", "0.5000,0.0000", "0.5000,0.5000", "0.5000,0.5000"]);
  });

  it("maps a pole to F = θ fs / 2π and B = -ln r fs / π", () => {
    const fs = 12000;
    const r = Math.exp((-Math.PI * 80) / fs);
    const theta = (2 * Math.PI * 700) / fs;
    const out = extractFormantsAndPoles(Float64Array.from([2 * r * Math.cos(theta), -r * r]), fs);
    expect(out.formants.f1).toBeCloseTo(700, 3);
    expect(out.formants.b1).toBeCloseTo(80, 3);
  });

  it("the envelope of a two-pole model peaks at its resonance", () => {
    const fs = 12000;
    const r = 0.98;
    const theta = (2 * Math.PI * 1500) / fs;
    const env = evaluateLPCEnvelopeDb(Float64Array.from([2 * r * Math.cos(theta), -r * r]), 1, 512);
    let peak = 0;
    for (let k = 1; k < 512; k++) if (env[k] > env[peak]) peak = k;
    expect((peak * fs) / 1024).toBeGreaterThan(1480);
    expect((peak * fs) / 1024).toBeLessThan(1520);
  });
});

describe("formants from a synthetic voice with known poles", () => {
  for (const vowel of [AA, II]) {
    for (const sampleRate of [12000, 44100, 48000]) {
      it(`finds F1 and F2 of /${vowel.symbol}/ within 60 Hz at ${sampleRate} Hz`, () => {
        const signal = synthesizeVoice({
          sampleRate,
          f0Hz: 140,
          durationSec: 1,
          formants: [vowel.targetF1, vowel.targetF2, vowel.targetF3],
        });
        const analyzer = new VoiceAnalyzer(sampleRate);
        analyzer.target = vowel;
        const t = settle(analyzer, signal);
        expect(t.voiced).toBe(true);
        expect(Math.abs(t.formants.f1 - vowel.targetF1)).toBeLessThan(60);
        expect(Math.abs(t.formants.f2 - vowel.targetF2)).toBeLessThan(60);
        expect(t.activeTargetMatch.convergenceScore).toBeGreaterThan(80);
        for (const pole of t.zPlanePoles) expect(pole.magnitude).toBeLessThan(1);
      });
    }
  }

  it("resolves every reference vowel to itself", () => {
    for (const vowel of VOWEL_TARGETS) {
      const signal = synthesizeVoice({
        sampleRate: 48000,
        f0Hz: 120,
        durationSec: 1,
        formants: [vowel.targetF1, vowel.targetF2, vowel.targetF3],
      });
      const t = settle(new VoiceAnalyzer(48000), signal);
      expect(nearestVowel(t.formants.f1, t.formants.f2).id, vowel.id).toBe(vowel.id);
    }
  });
});

describe("pitch", () => {
  it("recovers a 140 Hz fundamental within 1.5 Hz", () => {
    const fs = 12000;
    const x = new Float32Array(1024);
    for (let i = 0; i < x.length; i++) {
      for (let h = 1; h <= 6; h++) x[i] += Math.sin((2 * Math.PI * 140 * h * i) / fs) / h;
    }
    const p = detectPitchF0(x, fs);
    expect(Math.abs(p.f0Hz - 140)).toBeLessThan(1.5);
    expect(p.confidence).toBeGreaterThan(0.9);
  });

  it("does not drop an octave when the fundamental is weaker than its harmonics", () => {
    const fs = 12000;
    const x = new Float32Array(1024);
    for (let i = 0; i < x.length; i++) {
      x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / fs) + Math.sin((2 * Math.PI * 440 * i) / fs) +
        0.8 * Math.sin((2 * Math.PI * 660 * i) / fs);
    }
    expect(Math.abs(detectPitchF0(x, fs).f0Hz - 220)).toBeLessThan(2);
  });

  it("reports no pitch for silence or noise", () => {
    expect(detectPitchF0(new Float32Array(1024), 12000).f0Hz).toBe(0);
    let seed = 7;
    const noise = Float32Array.from({ length: 1024 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 31 - 1;
    });
    expect(detectPitchF0(noise, 12000).confidence).toBeLessThan(0.6);
  });

  it("tracks the pitch of the synthetic voice through the whole analyser", () => {
    for (const f0 of [95, 140, 220, 310]) {
      const signal = synthesizeVoice({ sampleRate: 48000, f0Hz: f0, durationSec: 1, formants: [560, 920, 2500] });
      const t = settle(new VoiceAnalyzer(48000), signal, 10);
      expect(Math.abs(t.stability.f0Hz - f0)).toBeLessThan(1.5);
    }
  });
});

describe("jitter and shimmer", () => {
  const voice = (jitterPercent: number, shimmerDb = 0) =>
    synthesizeVoice({
      sampleRate: 48000,
      f0Hz: 140,
      durationSec: 2,
      formants: [750, 1180, 2540],
      jitterPercent,
      shimmerDb,
      seed: 11,
    });

  it("reads zero for a perfectly periodic voice", () => {
    const stats = measureCycles(voice(0), 48000, 140);
    expect(stats.cycles).toBeGreaterThan(200);
    expect(stats.jitterPercent).toBeLessThan(0.05);
    expect(stats.shimmerDb).toBeLessThan(0.05);
  });

  // Peak marking reads high when one cycle's ringing runs into the next (see measureCycles),
  // so the bound is one-sided: never below what was put in, never more than 1.6x above it.
  it("rises with the jitter that was put in", () => {
    let previous = 0;
    for (const target of [0.5, 1, 2]) {
      const stats = measureCycles(voice(target), 48000, 140);
      expect(stats.jitterPercent).toBeGreaterThan(target * 0.9);
      expect(stats.jitterPercent).toBeLessThan(target * 1.6);
      expect(stats.jitterPercent).toBeGreaterThan(previous);
      previous = stats.jitterPercent;
    }
  });

  it("rises with the shimmer that was put in", () => {
    const low = measureCycles(voice(0, 0.3), 48000, 140);
    const high = measureCycles(voice(0, 0.6), 48000, 140);
    expect(low.shimmerDb).toBeGreaterThan(0.27);
    expect(high.shimmerDb).toBeLessThan(0.6 * 1.6);
    expect(high.shimmerDb).toBeGreaterThan(low.shimmerDb);
  });

  it("the analyser's rolling jitter follows the synth setting", () => {
    const steady = settle(new VoiceAnalyzer(48000), voice(0), 60);
    const shaky = settle(new VoiceAnalyzer(48000), voice(1.5), 60);
    expect(steady.stability.jitterPercent).toBeLessThan(0.05);
    expect(shaky.stability.jitterPercent).toBeGreaterThan(1.0);
    expect(shaky.stability.jitterPercent).toBeLessThan(2.6);
  });

  it("counts syllable-like bursts of energy", () => {
    const tracker = new StabilityTracker();
    // Three bursts a second for four seconds.
    for (let ms = 0; ms < 4000; ms += 16) {
      tracker.updateCadence(ms % 333 < 160 ? 0.2 : 0.001, ms);
    }
    expect(tracker.syllablesPerSec).toBeGreaterThan(2.4);
    expect(tracker.syllablesPerSec).toBeLessThan(3.6);
  });
});

describe("vowel targets", () => {
  it("scores a perfect match 100 and a distant vowel near 0", () => {
    const hit = evaluateTargetConvergence({ f1: 750, f2: 1180, f3: 2540, b1: 0, b2: 0, b3: 0, confidence: 1 }, AA);
    expect(hit.convergenceScore).toBeCloseTo(100, 5);
    expect(hit.euclideanDistanceHz).toBe(0);
    const miss = evaluateTargetConvergence({ f1: 280, f2: 2280, f3: 2950, b1: 0, b2: 0, b3: 0, confidence: 1 }, AA);
    expect(miss.convergenceScore).toBeLessThan(1);
    expect(miss.distanceBark).toBeGreaterThan(4);
  });

  it("says which way to move", () => {
    const tooClosed = evaluateTargetConvergence({ f1: 450, f2: 1180, f3: 0, b1: 0, b2: 0, b3: 0, confidence: 1 }, AA);
    expect(tooClosed.guidance).toMatch(/Open the jaw/);
    const tooFront = evaluateTargetConvergence({ f1: 750, f2: 1900, f3: 0, b1: 0, b2: 0, b3: 0, confidence: 1 }, AA);
    expect(tooFront.guidance).toMatch(/back/);
  });

  it("Bark conversion is monotonic and about 8.5 Bark at 1 kHz", () => {
    expect(hzToBark(1000)).toBeCloseTo(8.53, 1);
    expect(hzToBark(2000)).toBeGreaterThan(hzToBark(1000));
  });
});

describe("synthetic voice", () => {
  it("loops without a step at the seam", () => {
    const x = synthesizeVoice({ sampleRate: 48000, f0Hz: 140, durationSec: 0.5, formants: [430, 1980, 2560] });
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(maxStep);
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(0.8, 5);
  });

  it("is deterministic for a given seed", () => {
    const opts = { sampleRate: 12000, f0Hz: 140, durationSec: 0.2, formants: [750, 1180, 2540] as const, jitterPercent: 1 };
    expect(synthesizeVoice({ ...opts, seed: 3 })).toEqual(synthesizeVoice({ ...opts, seed: 3 }));
  });
});

describe("analyser frame", () => {
  it("stays silent and unvoiced on silence", () => {
    const analyzer = new VoiceAnalyzer(48000);
    const t = analyzer.process(new Float32Array(analyzer.rawSize), 0);
    expect(t.voiced).toBe(false);
    expect(t.stability.f0Hz).toBe(0);
    expect(t.activeTargetMatch.convergenceScore).toBe(0);
  });

  it("puts the LPC envelope on the same scale as the FFT", () => {
    const signal = synthesizeVoice({ sampleRate: 48000, f0Hz: 140, durationSec: 1, formants: [750, 1180, 2540] });
    const t = settle(new VoiceAnalyzer(48000), signal, 5);
    const bin = Math.round((t.formants.f1 / t.analysisRate) * 1024);
    let fftPeak = -Infinity;
    for (let k = bin - 8; k <= bin + 8; k++) fftPeak = Math.max(fftPeak, t.fftMagnitudeDb[k]);
    expect(Math.abs(fftPeak - t.lpcEnvelopeDb[bin])).toBeLessThan(12);
  });

  it("refuses a frame that is too short", () => {
    const analyzer = new VoiceAnalyzer(48000);
    expect(() => analyzer.process(new Float32Array(100), 0)).toThrow(/at least/);
  });

  it("populates all 8 StageTraceBuffers accurately for a voiced frame", () => {
    const signal = synthesizeVoice({
      sampleRate: 48000,
      f0Hz: 140,
      durationSec: 0.5,
      formants: [750, 1180, 2540],
    });
    const analyzer = new VoiceAnalyzer(48000);
    const slice = signal.subarray(0, analyzer.rawSize);
    const t = analyzer.process(slice, 42);
    const sb = t.stageBuffers;

    expect(sb.rawDecimated.length).toBe(512);
    expect(sb.preEmphasized.length).toBe(512);
    expect(sb.windowWeights.length).toBe(512);
    expect(sb.windowed.length).toBe(512);
    expect(sb.nsdfCurve.length).toBe(256);
    expect(sb.peakLagTau).toBeGreaterThan(75);
    expect(sb.peakLagTau).toBeLessThan(95);
    expect(sb.autocorrCoeffs.length).toBe(analyzer.options.lpcOrder + 1);
    expect(sb.lpcCoeffs.length).toBe(analyzer.options.lpcOrder);
    expect(sb.lpcGain).toBeGreaterThan(0);
    expect(sb.allPoles.length).toBeGreaterThan(0);

    for (let i = 0; i < 512; i++) {
      expect(sb.windowed[i]).toBeCloseTo(sb.preEmphasized[i] * sb.windowWeights[i], 5);
    }
    const roles = sb.allPoles.map((p) => p.selectedAs).filter(Boolean);
    expect(roles).toContain("F1");
    expect(roles).toContain("F2");
  });

  it("reprocessCapturedBuffer deterministically re-runs a single captured slice with different overrides", () => {
    const signal = synthesizeVoice({
      sampleRate: 48000,
      f0Hz: 140,
      durationSec: 0.5,
      formants: [750, 1180, 2540],
    });
    const analyzer = new VoiceAnalyzer(48000);
    const slice = new Float32Array(signal.subarray(4096, 4096 + analyzer.rawSize));

    const baseline = analyzer.reprocessCapturedBuffer(slice, 48000, {
      windowType: "hamming",
      preEmphasis: 0.97,
      lpcOrder: 12,
    });
    const rectNoPreOrder20 = analyzer.reprocessCapturedBuffer(slice, 48000, {
      windowType: "rectangular",
      preEmphasis: 0,
      lpcOrder: 20,
    });

    // Same rawDecimated input slice, different intermediate & output stages
    expect(Array.from(rectNoPreOrder20.stageBuffers.rawDecimated)).toEqual(
      Array.from(baseline.stageBuffers.rawDecimated),
    );
    expect(baseline.stageBuffers.windowWeights[0]).toBeCloseTo(0.08, 4);
    expect(rectNoPreOrder20.stageBuffers.windowWeights[0]).toBeCloseTo(1.0, 4);
    expect(baseline.stageBuffers.lpcCoeffs.length).toBe(12);
    expect(rectNoPreOrder20.stageBuffers.lpcCoeffs.length).toBe(20);
    expect(rectNoPreOrder20.lpcEnvelopeDb[40]).not.toBeCloseTo(baseline.lpcEnvelopeDb[40], 2);
  });
});
