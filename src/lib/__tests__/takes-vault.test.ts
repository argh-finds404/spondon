import { beforeEach, describe, expect, it } from "vitest";
import { analyzeTakeAtTime, ingestAudioFileOrBuffer, telemetryFromSavedTake } from "@/lib/dsp/file-ingest";
import { synthesizeVoice } from "@/lib/dsp/synth";
import { encodeWav } from "@/lib/dsp/wav";
import {
  clearMemoryVault,
  deleteTake,
  exportTakeBundleJson,
  getTake,
  importTakeBundleJson,
  listTakes,
  saveTake,
  updateTakeNotes,
  type SavedTake,
} from "@/lib/storage/takes-vault";

function makeSampleTake(overrides: Partial<SavedTake> = {}): SavedTake {
  const wav = encodeWav(new Float32Array(2400), 48000);
  return {
    id: "take-1",
    title: "Baseline /aa/ take",
    createdAt: 1_700_000_000_000,
    sourceType: "mic",
    targetVowel: "aa",
    notes: "Steady jaw opening",
    durationSec: 1.2,
    sampleRate: 48000,
    wavBytes: wav,
    summary: {
      f0Hz: 140,
      f1Hz: 750,
      f2Hz: 1180,
      f3Hz: 2540,
      jitterPercent: 0.42,
      shimmerDb: 0.2,
      rmsDb: -18.5,
      nearestVowel: "aa",
      convergenceScore: 94.5,
      distanceBark: 0.14,
      voicedFraction: 0.92,
    },
    representativeFrame: {
      timestampMs: 600,
      sampleRate: 48000,
      analysisRate: 12000,
      windowType: "hamming",
      voiced: true,
      fftMagnitudeDb: new Array(512).fill(-60),
      lpcEnvelopeDb: new Array(512).fill(-55),
      timeDomainRaw: new Array(512).fill(0),
      timeDomainWindowed: new Array(512).fill(0),
      zPlanePoles: [{ re: 0.88, im: 0.36, freqHz: 750, bandwidthHz: 85, formantIndex: 1 }],
      f0Hz: 140,
      f1: 750,
      f2: 1180,
      f3: 2540,
      b1: 85,
      b2: 95,
      b3: 130,
      chladniM: 2.8,
      chladniN: 5.6,
    },
    ...overrides,
  };
}

describe("takes-vault local storage", () => {
  beforeEach(() => {
    clearMemoryVault();
  });

  it("saves and lists takes sorted newest first", async () => {
    const older = makeSampleTake({ id: "t-old", createdAt: 1000, title: "Older take" });
    const newer = makeSampleTake({ id: "t-new", createdAt: 5000, title: "Newer take" });
    const mid = makeSampleTake({ id: "t-mid", createdAt: 3000, title: "Middle take" });

    await saveTake(older);
    await saveTake(newer);
    await saveTake(mid);

    const listed = await listTakes();
    expect(listed.map((t) => t.id)).toEqual(["t-new", "t-mid", "t-old"]);
  });

  it("updates title and observation notes persistently", async () => {
    const take = makeSampleTake({ id: "t-note" });
    await saveTake(take);

    const updated = await updateTakeNotes("t-note", "After jaw drop", "F1 rose cleanly from 690 Hz to 755 Hz");
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("After jaw drop");

    const fetched = await getTake("t-note");
    expect(fetched?.title).toBe("After jaw drop");
    expect(fetched?.notes).toBe("F1 rose cleanly from 690 Hz to 755 Hz");
  });

  it("deletes takes without leaving stale records", async () => {
    await saveTake(makeSampleTake({ id: "t-1", createdAt: 100 }));
    await saveTake(makeSampleTake({ id: "t-2", createdAt: 200 }));

    await deleteTake("t-1");
    const listed = await listTakes();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("t-2");
    expect(await getTake("t-1")).toBeNull();
  });

  it("round-trips .spondon.json bundles with binary wavBytes intact", async () => {
    const pcm = synthesizeVoice({ sampleRate: 48000, f0Hz: 145, formants: [310, 2320, 2950], durationSec: 0.4, seed: 3 });
    const wav = encodeWav(pcm, 48000);
    const original = makeSampleTake({
      id: "bundle-orig",
      title: "High front /ii/",
      notes: "Tongue high and front; F2 > 2200 Hz",
      wavBytes: wav,
      targetVowel: "ii",
    });

    const json = exportTakeBundleJson(original);
    const imported = await importTakeBundleJson(json);

    expect(imported.id).toBe("bundle-orig");
    expect(imported.title).toBe("High front /ii/");
    expect(imported.notes).toBe("Tongue high and front; F2 > 2200 Hz");
    expect(Array.from(imported.wavBytes)).toEqual(Array.from(wav));

    // Importing the same bundle again creates a non-colliding copy in the vault
    const duplicate = await importTakeBundleJson(json);
    expect(duplicate.id).not.toBe(imported.id);
    expect(await listTakes()).toHaveLength(2);
  });

  it("rejects malformed bundle strings", async () => {
    await expect(importTakeBundleJson("not valid json")).rejects.toThrow();
    await expect(importTakeBundleJson(JSON.stringify({ format: "wrong" }))).rejects.toThrow();
  });
});

describe("file-ingest real DSP extraction", () => {
  it("analyzes a WAV File locally and recovers formants, target vowel, and scrubbed telemetry", async () => {
    const sr = 48000;
    const pcm = synthesizeVoice({
      sampleRate: sr,
      f0Hz: 150,
      formants: [310, 2320, 2950],
      durationSec: 0.8,
      jitterPercent: 0.3,
      seed: 9,
    });
    const wavBytes = encodeWav(pcm, sr);
    const file = new File([wavBytes], "vowel-ii-sample.wav", { type: "audio/wav" });

    const take = await ingestAudioFileOrBuffer(file, "ii", { notes: "Test /ii/ upload" });

    expect(take.sourceType).toBe("upload");
    expect(take.fileName).toBe("vowel-ii-sample.wav");
    expect(take.summary.nearestVowel).toBe("ii");
    expect(take.summary.f1Hz).toBeGreaterThan(220);
    expect(take.summary.f1Hz).toBeLessThan(430);
    expect(take.summary.f2Hz).toBeGreaterThan(2050);
    expect(take.summary.f2Hz).toBeLessThan(2600);
    expect(take.representativeFrame.fftMagnitudeDb).toHaveLength(512);
    expect(take.representativeFrame.lpcEnvelopeDb).toHaveLength(512);

    const hydratedTelemetry = telemetryFromSavedTake(take);
    expect(hydratedTelemetry.voiced).toBe(true);
    expect(hydratedTelemetry.formants.f2).toBeGreaterThan(2050);

    const scrubbedTelemetry = analyzeTakeAtTime(take, 0.5);
    expect(scrubbedTelemetry.fftMagnitudeDb).toHaveLength(512);
    expect(scrubbedTelemetry.voiced).toBe(true);
  });

  it("rejects clips shorter than 0.1s and handles quiet/unvoiced buffers without NaNs", async () => {
    const tooShort = new Float32Array(2000);
    await expect(
      ingestAudioFileOrBuffer({ pcm: tooShort, sampleRate: 48000 }, "aa", { sourceType: "mic" }),
    ).rejects.toThrow(/at least 0\.1 seconds/i);

    const silent = new Float32Array(24000);
    const take = await ingestAudioFileOrBuffer({ pcm: silent, sampleRate: 48000 }, "aa", {
      sourceType: "upload",
      title: "Silence check",
    });
    expect(take.summary.voicedFraction).toBe(0);
    expect(Number.isFinite(take.summary.f0Hz)).toBe(true);
    expect(Number.isFinite(take.summary.f1Hz)).toBe(true);
    expect(Number.isFinite(take.summary.f2Hz)).toBe(true);
    expect(Number.isFinite(take.representativeFrame.chladniM)).toBe(true);
  });

  it("extracts measurable formant and Bark deltas between /aa/ and /ii/ takes", async () => {
    const sr = 48000;
    const takeA = await ingestAudioFileOrBuffer(
      { pcm: synthesizeVoice({ sampleRate: sr, f0Hz: 140, formants: [750, 1180, 2540], durationSec: 0.7, seed: 1 }), sampleRate: sr },
      "aa",
      { sourceType: "synth" },
    );
    const takeB = await ingestAudioFileOrBuffer(
      { pcm: synthesizeVoice({ sampleRate: sr, f0Hz: 140, formants: [310, 2320, 2950], durationSec: 0.7, seed: 2 }), sampleRate: sr },
      "ii",
      { sourceType: "synth" },
    );

    expect(takeA.summary.f1Hz).toBeGreaterThan(takeB.summary.f1Hz + 200);
    expect(takeB.summary.f2Hz).toBeGreaterThan(takeA.summary.f2Hz + 700);
    const telB = telemetryFromSavedTake(takeB);
    expect(telB.formants.f2).toBeGreaterThan(2050);
    expect(telB.stability.f0Hz).toBeGreaterThan(100);
  });

  it("sanitizes non-finite numeric fields and rejects truncated WAV payloads on bundle import", async () => {
    const validTake = makeSampleTake({ id: "sanitized-import" });
    const parsed = JSON.parse(exportTakeBundleJson(validTake));
    parsed.take.summary.f1Hz = null;
    parsed.take.summary.convergenceScore = "bad";
    parsed.take.durationSec = null;

    const imported = await importTakeBundleJson(JSON.stringify(parsed));
    expect(imported.summary.f1Hz).toBe(0);
    expect(imported.summary.convergenceScore).toBe(0);
    expect(imported.durationSec).toBe(0);
    expect(Number.isFinite(imported.representativeFrame.f1)).toBe(true);

    parsed.take.wavBase64 = "";
    parsed.take.wavBytes = [1, 2, 3];
    await expect(importTakeBundleJson(JSON.stringify(parsed))).rejects.toThrow(/WAV audio payload/i);
  });
});
