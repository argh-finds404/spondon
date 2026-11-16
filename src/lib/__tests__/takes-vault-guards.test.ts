import { afterAll, describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/dsp/wav";

// A browser that has IndexedDB but refuses to open it, as some private modes do.
vi.stubGlobal("indexedDB", {
  open() {
    const request: { error: Error; onerror?: () => void } = { error: new Error("blocked") };
    setTimeout(() => request.onerror?.(), 0);
    return request;
  },
});
afterAll(() => vi.unstubAllGlobals());

const { exportTakeBundleJson, importTakeBundleJson, isVaultPersistent, listTakes, saveTake, deleteTake } = await import(
  "@/lib/storage/takes-vault"
);

function take(id: string) {
  return {
    id,
    title: "Held /iː/",
    createdAt: Date.now(),
    sourceType: "mic" as const,
    targetVowel: "ii",
    notes: "",
    durationSec: 0.1,
    sampleRate: 8000,
    wavBytes: encodeWav(new Float32Array(800), 8000),
    summary: { f0Hz: 180, f1Hz: 290, f2Hz: 2300, f3Hz: 2950, jitterPercent: 0.4, shimmerDb: 0.1, rmsDb: -20, nearestVowel: "ii", convergenceScore: 97, distanceBark: 0.2, voicedFraction: 1 },
    representativeFrame: {
      timestampMs: 0, sampleRate: 8000, analysisRate: 8000, windowType: "hamming" as const, voiced: true,
      fftMagnitudeDb: [], lpcEnvelopeDb: [], timeDomainRaw: [], timeDomainWindowed: [], zPlanePoles: [],
      f0Hz: 180, f1: 290, f2: 2300, f3: 2950, b1: 60, b2: 90, b3: 120, chladniM: 1.3, chladniN: 8.2,
    },
  };
}

describe("takes vault when the browser refuses storage", () => {
  it("keeps takes in memory instead of failing, and says they will not persist", async () => {
    await saveTake(take("a"));
    await saveTake(take("b"));
    expect((await listTakes()).map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(isVaultPersistent()).toBe(false);
    await deleteTake("a");
    expect((await listTakes()).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("importing a take from a file", () => {
  it("replaces a window type the analyser does not know, and caps oversized arrays", async () => {
    const bundle = JSON.parse(exportTakeBundleJson(take("c")));
    bundle.take.representativeFrame.windowType = "kaiser<script>";
    bundle.take.representativeFrame.fftMagnitudeDb = new Array(100_000).fill(-40);
    bundle.take.representativeFrame.zPlanePoles = new Array(1000).fill({ re: 0.5, im: 0.5, freqHz: 900, bandwidthHz: 80 });
    const imported = await importTakeBundleJson(JSON.stringify(bundle));
    expect(imported.representativeFrame.windowType).toBe("hamming");
    expect(imported.representativeFrame.fftMagnitudeDb.length).toBe(4096);
    expect(imported.representativeFrame.zPlanePoles.length).toBe(64);
  });

  it("refuses a file that is not a SPONDON take", async () => {
    await expect(importTakeBundleJson("{ \"format\": \"something-else\" }")).rejects.toThrow(/Unrecognised bundle/);
    await expect(importTakeBundleJson("not json")).rejects.toThrow(/could not parse/);
  });
});
