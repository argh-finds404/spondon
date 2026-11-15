import { describe, expect, it } from "vitest";
import { VoiceAnalyzer } from "../analyzer";
import { computeRadix2FFT } from "../fft-lpc";
import { generateSignal, SIGNAL_INFO, type SignalKind } from "../signals";

const RATE = 16384;
const N = 16384;

/** Magnitudes of one second of signal at 1 Hz per bin, normalised so a unit sine reads 1. */
function spectrum(wave: SignalKind, hz: number): Float32Array {
  const re = generateSignal({ wave, hz, sampleRate: RATE, durationSec: 1 });
  const im = new Float32Array(N);
  computeRadix2FFT(re, im);
  const mag = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (N / 2);
  return mag;
}

describe("classroom test signals", () => {
  it("a sine is one line at its frequency", () => {
    const mag = spectrum("sine", 440);
    expect(mag[440]).toBeCloseTo(0.8, 3);
    for (const k of [220, 439, 441, 880, 1320]) expect(mag[k]).toBeLessThan(1e-3);
  });

  it("a square wave has odd harmonics only, falling as 1/k", () => {
    const mag = spectrum("square", 200);
    for (const k of [3, 5, 7]) expect(mag[200 * k] / mag[200]).toBeCloseTo(1 / k, 2);
    for (const k of [2, 4, 6]) expect(mag[200 * k]).toBeLessThan(1e-3);
  });

  it("a sawtooth has every harmonic, falling as 1/k", () => {
    const mag = spectrum("saw", 200);
    for (const k of [2, 3, 4, 5]) expect(mag[200 * k] / mag[200]).toBeCloseTo(1 / k, 2);
  });

  it("a triangle has odd harmonics only, falling as 1/k²", () => {
    const mag = spectrum("triangle", 200);
    expect(mag[600] / mag[200]).toBeCloseTo(1 / 9, 2);
    expect(mag[400]).toBeLessThan(1e-3);
  });

  it("two tones are a strong line and a neighbour 20 dB down", () => {
    const mag = spectrum("twotone", 500);
    expect(20 * Math.log10(mag[550] / mag[500])).toBeCloseTo(-20, 1);
  });

  it("an impulse train is a flat comb", () => {
    const mag = spectrum("impulse", 250);
    for (const k of [2, 5, 12, 28]) expect(mag[250 * k] / mag[250]).toBeCloseTo(1, 2);
    expect(mag[375]).toBeLessThan(1e-3);
  });

  it("is band-limited: nothing above 8 kHz to fold back", () => {
    const mag = spectrum("square", 300);
    for (let k = 8100; k < N / 2; k += 97) expect(mag[k]).toBeLessThan(1e-3);
  });

  it("every signal peaks at 0.8, has a description, and loops without a step", () => {
    for (const wave of Object.keys(SIGNAL_INFO) as SignalKind[]) {
      const x = generateSignal({ wave, hz: 330, sampleRate: 48000 });
      let peak = 0;
      let maxStep = 0;
      for (let i = 0; i < x.length; i++) {
        peak = Math.max(peak, Math.abs(x[i]));
        if (i) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
      }
      expect(peak, wave).toBeCloseTo(0.8, 5);
      if (wave !== "noise") expect(Math.abs(x[0] - x[x.length - 1]), wave).toBeLessThanOrEqual(maxStep * 1.01);
      expect(SIGNAL_INFO[wave].spectrum.length).toBeGreaterThan(10);
    }
  });

  it("the analyser reads the pitch of a square wave and finds none in noise", () => {
    const run = (wave: SignalKind) => {
      const analyzer = new VoiceAnalyzer(48000);
      const x = generateSignal({ wave, hz: 220, sampleRate: 48000 });
      let t = analyzer.telemetry;
      for (let f = 0; f < 6; f++) t = analyzer.process(x.subarray(f * 800, f * 800 + analyzer.rawSize), f * 16);
      return t;
    };
    expect(Math.abs(run("square").stability.f0Hz - 220)).toBeLessThan(1);
    expect(run("noise").voiced).toBe(false);
  });
});
