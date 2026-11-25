import { describe, expect, it } from "vitest";
import {
  computeAutocorrelation,
  computeRadix2FFT,
  createLPCResult,
  evaluateLPCEnvelopeDb,
  extractFormantsAndPoles,
  solveLevinsonDurbin,
} from "../fft-lpc";
import {
  computeCepstralEnvelopeDb,
  computeVocalTractArea,
  estimateVocalTractLengthCm,
  solveBurgLPC,
} from "../models";
import { synthesizeVoice } from "../synth";
import { getWindow } from "../windows";

describe("multi-model spectral and vocal-tract estimators", () => {
  it("Burg lattice LPC guarantees minimum-phase reflection coefficients (|k_m| < 1) and recovers synthetic formants", () => {
    const sr = 12000;
    const pcm = synthesizeVoice({
      sampleRate: sr,
      f0Hz: 135,
      formants: [730, 1150, 2520],
      durationSec: 0.25,
      seed: 11,
    });
    const frame = pcm.subarray(pcm.length - 512);
    const pre = new Float32Array(512);
    pre[0] = frame[0] * 0.03;
    for (let i = 1; i < 512; i++) pre[i] = frame[i] - 0.97 * frame[i - 1];

    const burg = solveBurgLPC(pre, 12);
    expect(burg.gain).toBeGreaterThan(0);
    for (let m = 0; m < 12; m++) {
      expect(Math.abs(burg.reflectionK[m])).toBeLessThan(1);
    }

    const poles = extractFormantsAndPoles(burg.a, sr);
    expect(poles.converged).toBe(true);
    expect(poles.formants.f1).toBeGreaterThan(640);
    expect(poles.formants.f1).toBeLessThan(830);
    expect(poles.formants.f2).toBeGreaterThan(1050);
    expect(poles.formants.f2).toBeLessThan(1290);
  });

  it("Real Cepstrum extracts smooth liftered envelope, cepstral F0, and detects spectral anti-resonances (zeros)", () => {
    const sr = 12000;
    const pcm = synthesizeVoice({
      sampleRate: sr,
      f0Hz: 160,
      formants: [420, 1980, 2600],
      durationSec: 0.25,
      seed: 7,
    });
    const raw = pcm.subarray(pcm.length - 512);
    // Apply a 2-zero notch filter centered at 1200 Hz to simulate a nasal anti-resonance!
    const zeroTheta = (2 * Math.PI * 1200) / sr;
    const b1 = -2 * 0.96 * Math.cos(zeroTheta);
    const b2 = 0.96 * 0.96;
    const notched = new Float32Array(512);
    for (let n = 2; n < 512; n++) {
      notched[n] = raw[n] + b1 * raw[n - 1] + b2 * raw[n - 2];
    }

    const { w, sum } = getWindow("hamming", 512);
    const re = new Float32Array(1024);
    const im = new Float32Array(1024);
    const winFrame = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      winFrame[i] = notched[i] * w[i];
      re[i] = winFrame[i];
    }
    const refDb = -20 * Math.log10(sum / 2);
    computeRadix2FFT(re, im);
    const fftDb = new Float32Array(512);
    for (let k = 0; k < 512; k++) {
      fftDb[k] = Math.max(-120, 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20) + refDb);
    }

    const R = computeAutocorrelation(winFrame, 12);
    const lpc = solveLevinsonDurbin(R, 12, createLPCResult(12));
    const lpcDb = evaluateLPCEnvelopeDb(lpc.a, lpc.gain, 512, new Float32Array(512), refDb);

    const cepDb = new Float32Array(512);
    const info = computeCepstralEnvelopeDb(fftDb, sr, cepDb, lpcDb);

    expect(info.cepstralF0Hz).toBeGreaterThan(148);
    expect(info.cepstralF0Hz).toBeLessThan(172);
    // Notch at ~1200 Hz should pull the cepstral envelope significantly below the all-pole LPC bridge.
    expect(info.antiResonanceHz).toBeGreaterThan(950);
    expect(info.antiResonanceHz).toBeLessThan(1450);
    expect(info.antiResonanceDepthDb).toBeGreaterThan(4.5);
  });

  it("Kelly-Lochbaum vocal-tract area and Wakita VTL produce distinct anatomical profiles across vowels and tract scales", () => {
    const sr = 12000;
    const makeArea = (formants: [number, number, number]) => {
      const pcm = synthesizeVoice({ sampleRate: sr, f0Hz: 140, formants, durationSec: 0.2, seed: 3 });
      const x = pcm.subarray(pcm.length - 512);
      const pre = new Float32Array(512);
      for (let i = 1; i < 512; i++) pre[i] = x[i] - 0.97 * x[i - 1];
      const burg = solveBurgLPC(pre, 12);
      return computeVocalTractArea(burg.reflectionK, new Float32Array(13));
    };

    const areaAa = makeArea([750, 1180, 2540]);
    const areaIi = makeArea([280, 2280, 2950]);

    for (let i = 0; i < areaAa.length; i++) {
      expect(areaAa[i]).toBeGreaterThanOrEqual(0.079);
      expect(areaAa[i]).toBeLessThanOrEqual(1.001);
    }
    // Shapes for /ɑː/ vs /iː/ must differ measurably along the 13-section tube.
    let diffSum = 0;
    for (let i = 0; i < areaAa.length; i++) diffSum += Math.abs(areaAa[i] - areaIi[i]);
    expect(diffSum).toBeGreaterThan(0.3);

    // Shorter vocal tract (higher formants) -> shorter estimated VTL in cm.
    const adultCm = estimateVocalTractLengthCm(500, 1500, 2500);
    const childCm = estimateVocalTractLengthCm(625, 1875, 3125);
    expect(adultCm).toBeGreaterThan(16.5);
    expect(adultCm).toBeLessThan(18.5);
    expect(childCm).toBeLessThan(adultCm - 2.5);
  });
});
