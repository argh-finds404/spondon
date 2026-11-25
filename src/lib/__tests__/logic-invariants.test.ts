import { describe, expect, it } from "vitest";
import { interpolateTelemetry } from "@/components/compare/CompareWorkspace";
import { VoiceAnalyzer } from "@/lib/dsp/analyzer";
import { ingestAudioFileOrBuffer, telemetryFromSavedTake } from "@/lib/dsp/file-ingest";
import {
  computeCepstralEnvelopeDb,
  computeVocalTractArea,
  estimateVocalTractLengthCm,
  solveBurgLPC,
} from "@/lib/dsp/models";
import { synthesizeVoice } from "@/lib/dsp/synth";
import { nearestVowel, VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import {
  besselAlpha,
  besselJ,
  buildHarmonicTerms,
  evalCircularStandingWave,
  evalHarmonicSuperposition,
  sampleVocalTractRadius,
  type HarmonicTerm,
} from "@/lib/shapes";
import { labRuntime, useLabStore } from "@/store/lab-store";

function assertAllFinite(arr: ArrayLike<number>, label: string): void {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      throw new Error(`Expected finite value in ${label}[${i}], got ${arr[i]}`);
    }
  }
}

describe("end-to-end DSP, 3D physics, morphing, and store logic invariants", () => {
  it("never produces NaN or Infinity on degenerate audio frames (silence, DC, Nyquist, impulse, clipped rail)", () => {
    const sr = 48000;
    const n = 4224;
    const cases: Record<string, Float32Array> = {
      silence: new Float32Array(n),
      dcOffset: new Float32Array(n).fill(0.45),
      nyquistAlt: Float32Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.6 : -0.6)),
      singleImpulse: (() => {
        const a = new Float32Array(n);
        a[128] = 1;
        return a;
      })(),
      clippedSquare: Float32Array.from({ length: n }, (_, i) => (Math.floor(i / 64) % 2 === 0 ? 1 : -1)),
    };

    for (const [name, buf] of Object.entries(cases)) {
      const burg = solveBurgLPC(buf.subarray(0, 512), 14);
      expect(Number.isFinite(burg.gain), `${name} burg.gain`).toBe(true);
      assertAllFinite(burg.a, `${name} burg.a`);
      assertAllFinite(burg.reflectionK, `${name} burg.reflectionK`);

      const area = computeVocalTractArea(burg.reflectionK, new Float32Array(burg.reflectionK.length + 1));
      assertAllFinite(area, `${name} tractArea`);
      for (let i = 0; i < area.length; i++) {
        expect(area[i]).toBeGreaterThanOrEqual(0.079);
        expect(area[i]).toBeLessThanOrEqual(1.001);
      }

      for (const lpcMethod of ["autocorr", "burg"] as const) {
        const analyzer = new VoiceAnalyzer(sr, { lpcMethod });
        const t = analyzer.process(buf, 50);
        assertAllFinite(t.fftMagnitudeDb, `${name}:${lpcMethod} fft`);
        assertAllFinite(t.lpcEnvelopeDb, `${name}:${lpcMethod} lpc`);
        assertAllFinite(t.cepstralEnvelopeDb, `${name}:${lpcMethod} cepstrum`);
        assertAllFinite(t.vocalTractArea, `${name}:${lpcMethod} vocalTractArea`);
        expect(Number.isFinite(t.formants.f1)).toBe(true);
        expect(Number.isFinite(t.formants.f2)).toBe(true);
        expect(Number.isFinite(t.stability.rmsDb)).toBe(true);
        expect(Number.isFinite(t.regime.spectralCentroidHz)).toBe(true);
        expect(Number.isFinite(t.regime.spectralFlatness)).toBe(true);
        expect(Number.isFinite(t.regime.cepstralF0Hz)).toBe(true);
      }
    }

    // Degenerate cepstral input & VTL estimator bounds
    const flatFft = new Float32Array(512).fill(-120);
    const cepOut = new Float32Array(512);
    const cep = computeCepstralEnvelopeDb(flatFft, 12000, cepOut);
    assertAllFinite(cepOut, "flat cepOut");
    expect(Number.isFinite(cep.cepstralF0Hz)).toBe(true);
    expect(estimateVocalTractLengthCm(0, 0, 0)).toBe(0);
    expect(estimateVocalTractLengthCm(500, 1500, 2500)).toBeGreaterThan(15);
    expect(estimateVocalTractLengthCm(500, 1500, 2500)).toBeLessThan(19);
  });

  it("classifies and resolves all 8 reference vowels cleanly under both Yule-Walker and Burg LPC", () => {
    const sr = 48000;
    for (const v of VOWEL_TARGETS) {
      const pcm = synthesizeVoice({
        sampleRate: sr,
        f0Hz: 132,
        formants: [v.targetF1, v.targetF2, v.targetF3],
        durationSec: 0.28,
        seed: 42,
      });

      for (const lpcMethod of ["autocorr", "burg"] as const) {
        const analyzer = new VoiceAnalyzer(sr, { lpcMethod });
        analyzer.target = v;
        analyzer.process(pcm, 100);
        analyzer.process(pcm, 120);
        const t = analyzer.process(pcm, 140);

        expect(t.voiced, `${v.id}:${lpcMethod} voiced`).toBe(true);
        expect(t.regime.kind, `${v.id}:${lpcMethod} regime`).toBe("vowel");
        expect(nearestVowel(t.formants.f1, t.formants.f2).id, `${v.id}:${lpcMethod} nearest`).toBe(v.id);
        assertAllFinite(t.vocalTractArea, `${v.id}:${lpcMethod} area`);
      }
    }
  });

  it("preserves monotonic formant, vocal-tract, and harmonic-peak continuity during Compare A <-> B morphing", async () => {
    const sr = 24000;
    const pcmA = synthesizeVoice({ sampleRate: sr, f0Hz: 125, formants: [750, 1180, 2540], durationSec: 0.35, seed: 1 });
    const pcmB = synthesizeVoice({ sampleRate: sr, f0Hz: 190, formants: [280, 2280, 2950], durationSec: 0.35, seed: 2 });

    const takeA = await ingestAudioFileOrBuffer({ pcm: pcmA, sampleRate: sr }, "aa", { sourceType: "synth" });
    const takeB = await ingestAudioFileOrBuffer({ pcm: pcmB, sampleRate: sr }, "ii", { sourceType: "synth" });

    const frameA = telemetryFromSavedTake(takeA);
    const frameB = telemetryFromSavedTake(takeB);
    const scratch = telemetryFromSavedTake(takeA);

    expect(frameA.regime.topPeaks[0].freqHz).toBeGreaterThan(80);
    expect(frameB.regime.topPeaks[0].freqHz).toBeGreaterThan(80);
    assertAllFinite(frameA.vocalTractArea, "frameA.vocalTractArea");
    assertAllFinite(frameB.vocalTractArea, "frameB.vocalTractArea");

    const f1Steps: number[] = [];
    const f2Steps: number[] = [];
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const m = interpolateTelemetry(frameA, frameB, frameA.vocalTractArea, frameB.vocalTractArea, u, "ii", scratch);
      expect(m.voiced).toBe(true);
      f1Steps.push(m.formants.f1);
      f2Steps.push(m.formants.f2);
      assertAllFinite(m.fftMagnitudeDb, `morph(${u}).fft`);
      assertAllFinite(m.vocalTractArea, `morph(${u}).area`);
      expect(m.regime.topPeaks[0].ampLinear).toBeGreaterThan(0);
    }

    // /aa/ -> /ii/: F1 strictly decreases while F2 strictly increases
    for (let i = 1; i < f1Steps.length; i++) {
      expect(f1Steps[i]).toBeLessThan(f1Steps[i - 1]);
      expect(f2Steps[i]).toBeGreaterThan(f2Steps[i - 1]);
    }
  });

  it("matches analytical spatial gradients in evalHarmonicSuperposition and clamps 3D shapes across extreme coordinates", () => {
    const terms: HarmonicTerm[] = [
      { m: 1.8, n: 4.4, weight: 0.55 },
      { m: 2.9, n: 6.1, weight: 0.3 },
      { m: 3.7, n: 7.4, weight: 0.15 },
    ];
    const grad = { c: 0, gx: 0, gz: 0 };
    const eps = 1e-5;
    for (const [x, z] of [
      [-0.7, 0.35],
      [0.12, -0.58],
      [0.64, 0.41],
    ]) {
      const c0 = evalHarmonicSuperposition(x, z, terms, terms.length, grad);
      const cxNum =
        (evalHarmonicSuperposition(x + eps, z, terms, terms.length) -
          evalHarmonicSuperposition(x - eps, z, terms, terms.length)) /
        (2 * eps);
      const czNum =
        (evalHarmonicSuperposition(x, z + eps, terms, terms.length) -
          evalHarmonicSuperposition(x, z - eps, terms, terms.length)) /
        (2 * eps);
      expect(grad.c).toBeCloseTo(c0, 9);
      expect(grad.gx).toBeCloseTo(cxNum, 6);
      expect(grad.gz).toBeCloseTo(czNum, 6);
    }

    // Bessel, circular disc, empty peak fallback, and out-of-range vocal tract radius clamping
    expect(besselJ(0, 0)).toBe(1);
    expect(besselJ(2, 0)).toBe(0);
    expect(Number.isFinite(besselJ(3, 45))).toBe(true);
    expect(Number.isFinite(besselAlpha(-3, 99))).toBe(true);
    expect(Number.isFinite(evalCircularStandingWave(0, 0, 2.5, 2.2))).toBe(true);

    const outTerms: HarmonicTerm[] = Array.from({ length: 6 }, () => ({ m: 0, n: 0, weight: 0 }));
    expect(buildHarmonicTerms([], 2.4, 5.2, outTerms)).toBe(1);
    expect(outTerms[0].weight).toBe(1);

    expect(sampleVocalTractRadius([], 0.5)).toBe(0.25);
    for (const u of [-2, 0, 0.33, 0.77, 1, 5]) {
      const r = sampleVocalTractRadius([0, 0.001, 0.5, 100], u);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0.11);
      expect(r).toBeLessThanOrEqual(0.62);
    }
  });

  it("synchronizes store model/calibration mutations with labRuntime and restores clean defaults on resetCalibration", () => {
    const store = useLabStore.getState();
    store.updateAnalyzerOptions({ lpcMethod: "burg", vtlScale: 1.18 });
    store.setShowCepstrum(true);
    store.setShapeModel("tract");
    const prevExcite = useLabStore.getState().plateExciteCount;
    store.excitePlate();

    let next = useLabStore.getState();
    expect(next.analyzerOptions.lpcMethod).toBe("burg");
    expect(next.analyzerOptions.vtlScale).toBe(1.18);
    expect(next.showCepstrum).toBe(true);
    expect(next.shapeModel).toBe("tract");
    expect(next.plateExciteCount).toBe(prevExcite + 1);
    if (labRuntime.getController()) {
      expect(labRuntime.getController()!.analyzer.options.lpcMethod).toBe("burg");
      expect(labRuntime.getController()!.analyzer.options.vtlScale).toBe(1.18);
    }

    store.resetCalibration();
    next = useLabStore.getState();
    expect(next.analyzerOptions.lpcMethod).toBe("autocorr");
    expect(next.analyzerOptions.vtlScale).toBe(1);
    expect(next.showCepstrum).toBe(false);
    expect(next.shapeModel).toBe("square");
    expect(next.showNodalLines).toBe(true);
  });
});
