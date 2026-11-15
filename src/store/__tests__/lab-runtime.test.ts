import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chladniModes } from "@/lib/chladni";
import { VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { WORLD_ASSETS } from "@/lib/world-assets";
import { labRuntime, useLabStore } from "@/store/lab-store";

describe("SPONDON lab runtime & asset integrity", () => {
  it("maps every reference vowel to distinct valid Chladni modes (n > m)", () => {
    for (const v of VOWEL_TARGETS) {
      const { m, n } = chladniModes(v.targetF1, v.targetF2);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(4);
      expect(n).toBeGreaterThan(m);
      expect(n).toBeLessThanOrEqual(9);
    }
  });

  it("references existing files in public/world for every asset and poster", () => {
    const publicDir = path.resolve(process.cwd(), "public");
    expect(WORLD_ASSETS.length).toBeGreaterThanOrEqual(6);
    for (const asset of WORLD_ASSETS) {
      const filePath = path.join(publicDir, asset.src.replace(/^\//, ""));
      expect(fs.existsSync(filePath), `Missing ${asset.src}`).toBe(true);
      if (asset.poster) {
        const posterPath = path.join(publicDir, asset.poster.replace(/^\//, ""));
        expect(fs.existsSync(posterPath), `Missing ${asset.poster}`).toBe(true);
      }
      if (asset.creditRequired) {
        expect(asset.credit.length).toBeGreaterThan(10);
        expect(asset.licenseUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it("freezes telemetry snapshots cleanly and updates store controls without errors", () => {
    const store = useLabStore.getState();
    store.selectTarget("ii", true);
    expect(useLabStore.getState().targetId).toBe("ii");
    expect(useLabStore.getState().synth.tour).toBe(false);
    expect(useLabStore.getState().synth.vowelId).toBe("ii");

    const ctrl = labRuntime.getController();
    expect(ctrl).not.toBeNull();
    if (ctrl) {
      const raw = new Float32Array(ctrl.analyzer.rawSize);
      ctrl.analyzer.process(raw, 100);
    }

    store.toggleFreeze();
    expect(useLabStore.getState().frozen).toBe(true);
    const frozenSnap = labRuntime.getActiveTelemetry();
    expect(frozenSnap.timestampMs).toBe(100);

    if (ctrl) {
      ctrl.analyzer.process(new Float32Array(ctrl.analyzer.rawSize), 250);
    }
    expect(labRuntime.getActiveTelemetry().timestampMs).toBe(100);

    store.resetCalibration();
    expect(useLabStore.getState().frozen).toBe(false);
    expect(useLabStore.getState().targetId).toBe("aa");
    expect(useLabStore.getState().synth.tour).toBe(true);
  });
});
