import { describe, expect, it } from "vitest";
import {
  BESSEL_ROOTS,
  besselJ,
  buildHarmonicTerms,
  circularModes,
  evalCircularStandingWave,
  evalHarmonicSuperposition,
  sampleVocalTractRadius,
  type HarmonicTerm,
} from "../shapes";

describe("multi-geometry physical standing-wave models (shapes.ts)", () => {
  it("evaluates Bessel J_m(x) accurately at origin and vanishes at tabulated roots α_{m,n}", () => {
    expect(besselJ(0, 0)).toBeCloseTo(1, 8);
    expect(besselJ(1, 0)).toBeCloseTo(0, 8);
    expect(besselJ(2, 0)).toBeCloseTo(0, 8);

    // At each root α_{m,n}, J_m(α_{m,n}) must be ~0 (within root table 4-decimal precision).
    for (let m = 0; m <= 4; m++) {
      for (let n = 0; n < 4; n++) {
        const root = BESSEL_ROOTS[m][n];
        expect(Math.abs(besselJ(m, root))).toBeLessThan(2e-4);
      }
    }
  });

  it("maps formant pairs to distinct circular Bessel eigenmodes and evaluates nodal rings", () => {
    const mAa = circularModes(750, 1180);
    const mIi = circularModes(280, 2280);
    expect(mAa.m).toBeGreaterThan(mIi.m + 1.2);
    expect(mIi.n).toBeGreaterThan(mAa.n + 0.8);

    // At boundary r = discRadius for integer (m=2, n=2), standing wave vanishes on the rim
    const rimVal = evalCircularStandingWave(0.94, 0, 2, 2, 0.94);
    expect(Math.abs(rimVal)).toBeLessThan(1e-3);
  });

  it("builds normalized multi-harmonic superposition terms and exact analytical gradients", () => {
    const terms: HarmonicTerm[] = Array.from({ length: 6 }, () => ({ m: 0, n: 0, weight: 0 }));
    const count = buildHarmonicTerms(
      [
        { freqHz: 220, db: -12, ampLinear: 0.6 },
        { freqHz: 660, db: -18, ampLinear: 0.3 },
        { freqHz: 1100, db: -24, ampLinear: 0.1 },
      ],
      2.5,
      5.5,
      terms,
    );
    expect(count).toBe(3);
    const weightSum = terms[0].weight + terms[1].weight + terms[2].weight;
    expect(weightSum).toBeCloseTo(1, 5);

    const grad = { c: 0, gx: 0, gz: 0 };
    evalHarmonicSuperposition(0.31, -0.42, terms, count, grad);
    const eps = 1e-5;
    const cx = (evalHarmonicSuperposition(0.31 + eps, -0.42, terms, count) - grad.c) / eps;
    const cz = (evalHarmonicSuperposition(0.31, -0.42 + eps, terms, count) - grad.c) / eps;
    expect(grad.gx).toBeCloseTo(cx, 2);
    expect(grad.gz).toBeCloseTo(cz, 2);
  });

  it("interpolates smooth positive 3D vocal-tract radii from glottis to lips", () => {
    const area = new Float32Array([0.2, 0.3, 0.25, 0.4, 0.7, 0.9, 1.0, 0.8, 0.5, 0.3, 0.2, 0.35, 0.6]);
    for (let i = 0; i <= 20; i++) {
      const r = sampleVocalTractRadius(area, i / 20);
      expect(r).toBeGreaterThanOrEqual(0.11);
      expect(r).toBeLessThanOrEqual(0.62);
    }
  });
});
