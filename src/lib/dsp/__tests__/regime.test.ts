import { describe, expect, it } from "vitest";
import { VoiceAnalyzer } from "../analyzer";
import { generateSignal } from "../signals";
import { synthesizeVoice } from "../synth";

describe("open-set acoustic regime classifier and speaker calibration", () => {
  it("classifies broadband noise as fricative/noise and sudden silence-to-burst onset as plosive", () => {
    const sr = 48000;
    const analyzer = new VoiceAnalyzer(sr);
    const noise = generateSignal({ wave: "noise", hz: 440, sampleRate: sr, durationSec: 0.25 });
    const t = analyzer.process(noise, 100);

    expect(t.voiced).toBe(false);
    expect(t.regime.kind).toBe("fricative");
    expect(t.regime.spectralFlatness).toBeGreaterThan(0.15);
    expect(t.regime.spectralCentroidHz).toBeGreaterThan(1500);
    expect(t.regime.topPeaks[0].freqHz).toBeGreaterThan(0);
    expect(t.regime.topPeaks[0].ampLinear).toBeGreaterThan(0);

    // Silence frame followed by a sudden unvoiced burst -> transient plosive
    const silence = new Float32Array(analyzer.rawSize);
    const tSil = analyzer.process(silence, 140);
    expect(tSil.regime.kind).toBe("silence");

    const tBurst = analyzer.process(noise, 160);
    expect(tBurst.regime.kind).toBe("plosive");
    expect(tBurst.regime.onsetFluxDb).toBeGreaterThan(15);
  });

  it("classifies a pure sinusoid as a harmonic instrument tone under both Autocorrelation and Burg LPC", () => {
    const sr = 48000;
    const analyzer = new VoiceAnalyzer(sr);
    const sine = generateSignal({ wave: "sine", hz: 220, sampleRate: sr, durationSec: 0.25 });
    const tAuto = analyzer.process(sine, 200);

    expect(tAuto.voiced).toBe(true);
    expect(tAuto.regime.kind).toBe("instrument");
    expect(tAuto.regime.spectralFlatness).toBeLessThan(0.015);

    const burgAnalyzer = new VoiceAnalyzer(sr, { lpcMethod: "burg" });
    const tBurg = burgAnalyzer.process(sine, 200);
    expect(tBurg.voiced).toBe(true);
    expect(tBurg.regime.kind).toBe("instrument");
  });

  it("classifies an out-of-distribution formant pair or nasal zero as sonorant rather than an on-target vowel", () => {
    const sr = 48000;
    const analyzer = new VoiceAnalyzer(sr);
    // Extreme nasal/off-chart resonance (F1 = 260 Hz, F2 = 1480 Hz — far in Bark from all 8 targets)
    const oddVoice = synthesizeVoice({
      sampleRate: sr,
      f0Hz: 135,
      formants: [245, 1480, 2600],
      durationSec: 0.3,
      seed: 5,
    });
    // Process several frames so the 5-frame median settles
    let t = analyzer.process(oddVoice, 100);
    t = analyzer.process(oddVoice, 120);
    t = analyzer.process(oddVoice, 140);

    expect(t.voiced).toBe(true);
    expect(t.regime.kind).toBe("sonorant");
    expect(t.regime.vocalTractLengthCm).toBeGreaterThan(12);
  });

  it("applies personal speaker vocal-tract scale (vtlScale) so child/soprano shifted formants lock cleanly", () => {
    const sr = 48000;
    // Simulate a shorter vocal tract (1.20x higher formants than adult neutral /aa/: 900 Hz, 1416 Hz, 3048 Hz)
    const shortTractVoice = synthesizeVoice({
      sampleRate: sr,
      f0Hz: 235,
      formants: [890, 1416, 3048],
      durationSec: 0.3,
      seed: 19,
    });

    const uncalibrated = new VoiceAnalyzer(sr, { vtlScale: 1.0 });
    uncalibrated.process(shortTractVoice, 100);
    const tUncal = uncalibrated.process(shortTractVoice, 120);

    const calibrated = new VoiceAnalyzer(sr, { vtlScale: 1.2 });
    calibrated.process(shortTractVoice, 100);
    const tCal = calibrated.process(shortTractVoice, 120);

    expect(tCal.activeTargetMatch.distanceBark).toBeLessThan(tUncal.activeTargetMatch.distanceBark);
    expect(tCal.activeTargetMatch.convergenceScore).toBeGreaterThan(tUncal.activeTargetMatch.convergenceScore);
  });
});
