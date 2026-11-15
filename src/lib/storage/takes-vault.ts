import type { WindowType } from "@/types/dsp";

export type TakeSourceType = "mic" | "upload" | "synth";

export interface SavedTakePole {
  re: number;
  im: number;
  freqHz: number;
  bandwidthHz: number;
  formantIndex?: number;
}

export interface SavedTakeSummary {
  f0Hz: number;
  f1Hz: number;
  f2Hz: number;
  f3Hz: number;
  jitterPercent: number;
  shimmerDb: number;
  rmsDb: number;
  nearestVowel: string;
  convergenceScore: number;
  distanceBark: number;
  voicedFraction: number;
}

export interface SavedTakeRepresentativeFrame {
  timestampMs: number;
  sampleRate: number;
  analysisRate: number;
  windowType: WindowType;
  voiced: boolean;
  fftMagnitudeDb: number[];
  lpcEnvelopeDb: number[];
  timeDomainRaw: number[];
  timeDomainWindowed: number[];
  zPlanePoles: SavedTakePole[];
  f0Hz: number;
  f1: number;
  f2: number;
  f3: number;
  b1: number;
  b2: number;
  b3: number;
  chladniM: number;
  chladniN: number;
}

export interface SavedTake {
  id: string;
  title: string;
  createdAt: number;
  sourceType: TakeSourceType;
  fileName?: string;
  targetVowel: string | null;
  notes: string;
  durationSec: number;
  sampleRate: number;
  /** 16-bit mono WAV encoded via encodeWav() for instant playback & download. */
  wavBytes: Uint8Array;
  summary: SavedTakeSummary;
  representativeFrame: SavedTakeRepresentativeFrame;
}

const DB_NAME = "spondon-vault-v1";
const DB_VERSION = 1;
const STORE_NAME = "takes";
const BUNDLE_FORMAT = "spondon-take-v1";

/** Automatic in-memory fallback when IndexedDB is unavailable (e.g. Node / Vitest or restricted storage). */
const memoryVault = new Map<string, SavedTake>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function cloneTake(take: SavedTake): SavedTake {
  return {
    ...take,
    wavBytes: new Uint8Array(take.wavBytes),
    summary: { ...take.summary },
    representativeFrame: {
      ...take.representativeFrame,
      fftMagnitudeDb: take.representativeFrame.fftMagnitudeDb.slice(),
      lpcEnvelopeDb: take.representativeFrame.lpcEnvelopeDb.slice(),
      timeDomainRaw: take.representativeFrame.timeDomainRaw.slice(),
      timeDomainWindowed: take.representativeFrame.timeDomainWindowed.slice(),
      zPlanePoles: take.representativeFrame.zPlanePoles.map((p) => ({ ...p })),
    },
  };
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open SPONDON IndexedDB vault."));
  });
}

function hydrateStoredTake(raw: SavedTake): SavedTake {
  return {
    ...raw,
    wavBytes: raw.wavBytes instanceof Uint8Array ? new Uint8Array(raw.wavBytes) : new Uint8Array(raw.wavBytes),
  };
}

/** Clear all in-memory takes (intended for test isolation in Node environments). */
export function clearMemoryVault(): void {
  memoryVault.clear();
}

/** Return all saved takes sorted newest first (`createdAt` descending). */
export async function listTakes(): Promise<SavedTake[]> {
  if (!hasIndexedDb()) {
    return Array.from(memoryVault.values())
      .map(cloneTake)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  const db = await openVaultDb();
  try {
    return await new Promise<SavedTake[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = ((req.result as SavedTake[] | undefined) ?? [])
          .map(hydrateStoredTake)
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error ?? new Error("Failed to read takes from IndexedDB."));
    });
  } finally {
    db.close();
  }
}

/** Retrieve a single take by ID, or `null` if not found. */
export async function getTake(id: string): Promise<SavedTake | null> {
  if (!hasIndexedDb()) {
    const found = memoryVault.get(id);
    return found ? cloneTake(found) : null;
  }
  const db = await openVaultDb();
  try {
    return await new Promise<SavedTake | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result ? hydrateStoredTake(req.result as SavedTake) : null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read take from IndexedDB."));
    });
  } finally {
    db.close();
  }
}

/** Insert or overwrite a `SavedTake` record in the local vault. */
export async function saveTake(take: SavedTake): Promise<void> {
  const clean = cloneTake(take);
  if (!hasIndexedDb()) {
    memoryVault.set(clean.id, clean);
    return;
  }
  const db = await openVaultDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(clean);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save take to IndexedDB."));
      tx.onabort = () => reject(tx.error ?? new Error("Saving take to IndexedDB was aborted."));
    });
  } finally {
    db.close();
  }
}

/** Update the title and written observation notes of an existing take. */
export async function updateTakeNotes(id: string, title: string, notes: string): Promise<SavedTake | null> {
  const existing = await getTake(id);
  if (!existing) return null;
  const updated: SavedTake = {
    ...existing,
    title: title.trim() || existing.title,
    notes,
  };
  await saveTake(updated);
  return updated;
}

/** Permanently remove a take from the local vault. */
export async function deleteTake(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryVault.delete(id);
    return;
  }
  const db = await openVaultDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete take from IndexedDB."));
    });
  } finally {
    db.close();
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

interface ExportedTakeBundle {
  format: typeof BUNDLE_FORMAT;
  exportedAt: number;
  take: Omit<SavedTake, "wavBytes"> & { wavBase64: string };
}

/** Serialize a take (audio WAV + notes + telemetry) into a portable `.spondon.json` string. */
export function exportTakeBundleJson(take: SavedTake): string {
  const { wavBytes, ...rest } = take;
  const payload: ExportedTakeBundle = {
    format: BUNDLE_FORMAT,
    exportedAt: Date.now(),
    take: {
      ...rest,
      wavBase64: uint8ToBase64(wavBytes),
    },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse a `.spondon.json` bundle, validate its structure, persist it into the local vault,
 * and return the hydrated `SavedTake`.
 */
export async function importTakeBundleJson(jsonStr: string): Promise<SavedTake> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Invalid .spondon.json file: could not parse JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Partial<ExportedTakeBundle>).format !== BUNDLE_FORMAT ||
    !(parsed as Partial<ExportedTakeBundle>).take
  ) {
    throw new Error("Unrecognised bundle format: expected a spondon-take-v1 export.");
  }

  const rawTake = (parsed as ExportedTakeBundle).take as Omit<SavedTake, "wavBytes"> & {
    wavBase64?: unknown;
    wavBytes?: unknown;
  };

  if (
    typeof rawTake.id !== "string" ||
    !rawTake.id ||
    typeof rawTake.title !== "string" ||
    typeof rawTake.sampleRate !== "number" ||
    !Number.isFinite(rawTake.sampleRate) ||
    rawTake.sampleRate <= 0 ||
    !rawTake.summary ||
    !rawTake.representativeFrame
  ) {
    throw new Error("Incomplete .spondon.json bundle: missing required take fields.");
  }

  const finiteOr = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  let wavBytes: Uint8Array;
  if (typeof rawTake.wavBase64 === "string" && rawTake.wavBase64.length > 0) {
    wavBytes = base64ToUint8(rawTake.wavBase64);
  } else if (Array.isArray(rawTake.wavBytes)) {
    wavBytes = new Uint8Array(rawTake.wavBytes.map((n) => Number(n) & 0xff));
  } else {
    throw new Error("Incomplete .spondon.json bundle: missing audio payload.");
  }
  if (wavBytes.byteLength < 44) {
    throw new Error("Incomplete .spondon.json bundle: invalid or truncated WAV audio payload.");
  }

  const existing = await getTake(rawTake.id);
  const safeId = existing ? `${rawTake.id}-imp-${Date.now()}` : rawTake.id;

  const rawSummary = rawTake.summary as Partial<SavedTake["summary"]>;
  const cleanSummary: SavedTake["summary"] = {
    f0Hz: finiteOr(rawSummary.f0Hz, 0),
    f1Hz: finiteOr(rawSummary.f1Hz, 0),
    f2Hz: finiteOr(rawSummary.f2Hz, 0),
    f3Hz: finiteOr(rawSummary.f3Hz, 0),
    jitterPercent: finiteOr(rawSummary.jitterPercent, 0),
    shimmerDb: finiteOr(rawSummary.shimmerDb, 0),
    rmsDb: finiteOr(rawSummary.rmsDb, -100),
    nearestVowel:
      typeof rawSummary.nearestVowel === "string" && rawSummary.nearestVowel
        ? rawSummary.nearestVowel
        : "aa",
    convergenceScore: finiteOr(rawSummary.convergenceScore, 0),
    distanceBark: finiteOr(rawSummary.distanceBark, 0),
    voicedFraction: finiteOr(rawSummary.voicedFraction, 0),
  };

  const rep = rawTake.representativeFrame;
  const hydrated: SavedTake = {
    id: safeId,
    title: rawTake.title.trim() || "Imported take",
    createdAt: finiteOr(rawTake.createdAt, Date.now()),
    sourceType:
      rawTake.sourceType === "mic" || rawTake.sourceType === "upload" || rawTake.sourceType === "synth"
        ? rawTake.sourceType
        : "upload",
    fileName: typeof rawTake.fileName === "string" ? rawTake.fileName : undefined,
    targetVowel: typeof rawTake.targetVowel === "string" ? rawTake.targetVowel : null,
    notes: typeof rawTake.notes === "string" ? rawTake.notes : "",
    durationSec: finiteOr(rawTake.durationSec, 0),
    sampleRate: rawTake.sampleRate,
    wavBytes,
    summary: cleanSummary,
    representativeFrame: {
      timestampMs: finiteOr(rep.timestampMs, 0),
      sampleRate: finiteOr(rep.sampleRate, rawTake.sampleRate),
      analysisRate: finiteOr(rep.analysisRate, 12000),
      windowType: rep.windowType ?? "hamming",
      voiced: Boolean(rep.voiced),
      fftMagnitudeDb: Array.isArray(rep.fftMagnitudeDb)
        ? rep.fftMagnitudeDb.map((v) => finiteOr(v, -100))
        : [],
      lpcEnvelopeDb: Array.isArray(rep.lpcEnvelopeDb)
        ? rep.lpcEnvelopeDb.map((v) => finiteOr(v, -100))
        : [],
      timeDomainRaw: Array.isArray(rep.timeDomainRaw)
        ? rep.timeDomainRaw.map((v) => finiteOr(v, 0))
        : [],
      timeDomainWindowed: Array.isArray(rep.timeDomainWindowed)
        ? rep.timeDomainWindowed.map((v) => finiteOr(v, 0))
        : [],
      zPlanePoles: Array.isArray(rep.zPlanePoles)
        ? rep.zPlanePoles
            .filter((p) => p && typeof p === "object")
            .map((p) => ({
              re: finiteOr(p.re, 0),
              im: finiteOr(p.im, 0),
              freqHz: finiteOr(p.freqHz, 0),
              bandwidthHz: finiteOr(p.bandwidthHz, 0),
              formantIndex: finiteOr(p.formantIndex, 0),
            }))
        : [],
      f0Hz: finiteOr(rep.f0Hz, cleanSummary.f0Hz),
      f1: finiteOr(rep.f1, cleanSummary.f1Hz),
      f2: finiteOr(rep.f2, cleanSummary.f2Hz),
      f3: finiteOr(rep.f3, cleanSummary.f3Hz),
      b1: finiteOr(rep.b1, 0),
      b2: finiteOr(rep.b2, 0),
      b3: finiteOr(rep.b3, 0),
      chladniM: finiteOr(rep.chladniM, 2.8),
      chladniN: finiteOr(rep.chladniN, 5.6),
    },
  };

  await saveTake(hydrated);
  return hydrated;
}
