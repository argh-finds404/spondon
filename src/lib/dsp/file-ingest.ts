import { chladniModes } from "@/lib/chladni";
import { analyzeRecording } from "@/lib/dsp/offline";
import { createStageTraceBuffers, FRAME_SIZE, VoiceAnalyzer } from "@/lib/dsp/analyzer";
import { DEFAULT_TARGET, evaluateTargetConvergence, findVowel, nearestVowel } from "@/lib/dsp/vowel-targets";
import { decodeWav, encodeWav } from "@/lib/dsp/wav";
import type { SavedTake, SavedTakePole, SavedTakeRepresentativeFrame, TakeSourceType } from "@/lib/storage/takes-vault";
import type { ComplexPoint, DSPFrameTelemetry, VowelTarget } from "@/types/dsp";

export const MAX_INGEST_SECONDS = 30;
export const MIN_INGEST_SECONDS = 0.1;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface IngestOptions {
  title?: string;
  notes?: string;
  sourceType?: TakeSourceType;
  targetVowel?: string | null;
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRiffWave(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const v = new Uint8Array(buf, 0, 12);
  return (
    v[0] === 0x52 &&
    v[1] === 0x49 &&
    v[2] === 0x46 &&
    v[3] === 0x46 &&
    v[8] === 0x57 &&
    v[9] === 0x41 &&
    v[10] === 0x56 &&
    v[11] === 0x45
  );
}

function mixDownChannels(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (channels <= 1) return new Float32Array(buffer.getChannelData(0));
  const mono = new Float32Array(length);
  const inv = 1 / channels;
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] += ch[i] * inv;
    }
  }
  return mono;
}

function clampPcm(pcm: Float32Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs <= 1) return pcm;
  const out = new Float32Array(pcm.length);
  const scale = 0.98 / maxAbs;
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * scale;
  return out;
}

function defaultTitleFor(sourceType: TakeSourceType, fileName?: string, vowelId?: string): string {
  if (fileName) {
    return fileName.replace(/\.[^/.]+$/, "").trim() || "Uploaded audio";
  }
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const prefix = sourceType === "mic" ? "Mic note" : sourceType === "synth" ? "Synth take" : "Audio take";
  return vowelId ? `${prefix} · /${vowelId}/ (${time})` : `${prefix} (${time})`;
}

/**
 * Decode an uploaded audio `File` (WAV directly, or MP3/M4A/OGG/WebM/FLAC via AudioContext)
 * into a 30s-capped mono `Float32Array` buffer and sample rate.
 */
async function decodeInputFile(file: File): Promise<{ pcm: Float32Array; sampleRate: number; fileName: string }> {
  if (file.size <= 0) throw new Error("The selected audio file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Audio files must be 50 MB or smaller.");
  }
  const bytes = await file.arrayBuffer();
  if (isRiffWave(bytes)) {
    try {
      const decoded = decodeWav(bytes);
      return { pcm: decoded.samples, sampleRate: decoded.sampleRate, fileName: file.name };
    } catch {
      // Fall back to browser decodeAudioData for compressed WAV codecs (e.g. ADPCM/MP3 inside WAV).
    }
  }

  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!AudioCtx) {
    throw new Error("Web Audio decodeAudioData is unavailable in this environment for non-WAV files.");
  }

  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(bytes.slice(0));
    const pcm = mixDownChannels(audioBuffer);
    return { pcm, sampleRate: audioBuffer.sampleRate, fileName: file.name };
  } catch {
    throw new Error(`Could not decode "${file.name}". Try a standard .wav, .mp3, .m4a, .ogg or .webm audio file.`);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Step a fresh VoiceAnalyzer over up to 6 trailing hops ending at `endSample` so its median smoother
 * and telemetry match a live real-time pass over that slice.
 */
function evaluateFrameEndingAt(
  samples: Float32Array,
  sampleRate: number,
  endSample: number,
  hopSamples: number,
  target: VowelTarget,
): DSPFrameTelemetry {
  const analyzer = new VoiceAnalyzer(sampleRate);
  analyzer.target = target;
  const size = analyzer.rawSize;
  const padded = new Float32Array(size + samples.length);
  padded.set(samples, size);

  const clampedEnd = Math.max(hopSamples, Math.min(samples.length, Math.round(endSample)));
  const startStep = Math.max(hopSamples, clampedEnd - 5 * hopSamples);
  let last = analyzer.telemetry;
  for (let end = startStep; end <= clampedEnd; end += hopSamples) {
    last = analyzer.process(padded.subarray(end, end + size), (end / sampleRate) * 1000);
  }
  if (clampedEnd > startStep && (clampedEnd - startStep) % hopSamples !== 0) {
    last = analyzer.process(padded.subarray(clampedEnd, clampedEnd + size), (clampedEnd / sampleRate) * 1000);
  }
  return last;
}

function buildRepresentativeFrame(t: DSPFrameTelemetry): SavedTakeRepresentativeFrame {
  const poles: SavedTakePole[] = [];
  for (const p of t.zPlanePoles) {
    if (p.magnitude <= 0) continue;
    poles.push({
      re: Number(p.re.toFixed(5)),
      im: Number(p.im.toFixed(5)),
      freqHz: Math.round(p.freqHz),
      bandwidthHz: Math.round(p.bandwidthHz),
      formantIndex: p.formantIndex,
    });
  }
  const modes = { m: 2.8, n: 5.6 };
  if (t.formants.f1 > 0 && t.formants.f2 > 0) {
    chladniModes(t.formants.f1, t.formants.f2, modes);
  }
  return {
    timestampMs: Math.round(t.timestampMs),
    sampleRate: t.sampleRate,
    analysisRate: t.analysisRate,
    windowType: t.windowType,
    voiced: t.voiced,
    fftMagnitudeDb: Array.from(t.fftMagnitudeDb, (v) => Number(v.toFixed(2))),
    lpcEnvelopeDb: Array.from(t.lpcEnvelopeDb, (v) => Number(v.toFixed(2))),
    timeDomainRaw: Array.from(t.timeDomainRaw, (v) => Number(v.toFixed(5))),
    timeDomainWindowed: Array.from(t.timeDomainWindowed, (v) => Number(v.toFixed(5))),
    zPlanePoles: poles,
    f0Hz: Number(t.stability.f0Hz.toFixed(1)),
    f1: Math.round(t.formants.f1),
    f2: Math.round(t.formants.f2),
    f3: Math.round(t.formants.f3),
    b1: Math.round(t.formants.b1),
    b2: Math.round(t.formants.b2),
    b3: Math.round(t.formants.b3),
    chladniM: Number(modes.m.toFixed(2)),
    chladniN: Number(modes.n.toFixed(2)),
  };
}

/**
 * Decode an uploaded File or analyze an in-memory PCM buffer using SPONDON's real DSP pipeline,
 * picking the most stable voiced representative frame and producing a storable `SavedTake`.
 */
export async function ingestAudioFileOrBuffer(
  fileOrPcm: File | { pcm: Float32Array; sampleRate: number },
  targetVowel: string | null = null,
  options: Omit<IngestOptions, "targetVowel"> = {},
): Promise<SavedTake> {
  let pcm: Float32Array;
  let sampleRate: number;
  let fileName: string | undefined;
  let sourceType: TakeSourceType;

  if (!("pcm" in fileOrPcm)) {
    const decoded = await decodeInputFile(fileOrPcm);
    pcm = decoded.pcm;
    sampleRate = decoded.sampleRate;
    fileName = decoded.fileName;
    sourceType = options.sourceType ?? "upload";
  } else {
    pcm = fileOrPcm.pcm;
    sampleRate = fileOrPcm.sampleRate;
    sourceType = options.sourceType ?? "mic";
  }

  if (sampleRate < 4000 || sampleRate > 192000) {
    throw new Error(`Unsupported audio sample rate: ${sampleRate} Hz.`);
  }
  const maxSamples = Math.round(MAX_INGEST_SECONDS * sampleRate);
  const sliced = clampPcm(pcm.length > maxSamples ? pcm.subarray(0, maxSamples) : pcm);
  const durationSec = sliced.length / sampleRate;
  if (durationSec < MIN_INGEST_SECONDS) {
    throw new Error(`Audio clip must be at least ${MIN_INGEST_SECONDS} seconds long.`);
  }

  const hopMs = durationSec > 8 ? 20 : 10;
  const targetObj = targetVowel ? findVowel(targetVowel) : undefined;
  const analysis = analyzeRecording(sliced, sampleRate, { hopMs, target: targetObj });

  // Locate the representative slice: voiced frame closest to the recording's median F1/F2,
  // or peak-RMS slice if the recording contains no voiced vowels.
  const hopSamples = Math.max(1, Math.round((hopMs / 1000) * sampleRate));
  const { summary } = analysis;
  let bestTimeSec = durationSec * 0.5;
  let bestScore = Infinity;

  const trackedFrames = analysis.frames.filter((fr) => fr.voiced && fr.f1 > 0 && fr.f2 > 0);
  if (trackedFrames.length > 0 && summary.f1Hz > 0 && summary.f2Hz > 0) {
    for (const fr of trackedFrames) {
      const df1 = (fr.f1 - summary.f1Hz) / Math.max(1, summary.f1Hz);
      const df2 = (fr.f2 - summary.f2Hz) / Math.max(1, summary.f2Hz);
      const err = df1 * df1 + df2 * df2;
      if (err < bestScore) {
        bestScore = err;
        bestTimeSec = fr.t;
      }
    }
  } else {
    // Fallback: pick loudest window in signal
    const win = Math.min(sliced.length, Math.round(0.05 * sampleRate));
    let bestRms = -1;
    for (let start = 0; start + win <= sliced.length; start += Math.max(1, hopSamples * 2)) {
      let sumSq = 0;
      for (let i = 0; i < win; i += 4) {
        const v = sliced[start + i];
        sumSq += v * v;
      }
      if (sumSq > bestRms) {
        bestRms = sumSq;
        bestTimeSec = (start + win) / sampleRate;
      }
    }
  }

  const resolvedNearestId =
    summary.nearestVowel ??
    (summary.f1Hz > 0 && summary.f2Hz > 0 ? nearestVowel(summary.f1Hz, summary.f2Hz).id : DEFAULT_TARGET.id);
  const evalTarget = targetObj ?? findVowel(resolvedNearestId);
  const repTelemetry = evaluateFrameEndingAt(sliced, sampleRate, bestTimeSec * sampleRate, hopSamples, evalTarget);
  const match = evaluateTargetConvergence(
    {
      f1: summary.f1Hz || repTelemetry.formants.f1,
      f2: summary.f2Hz || repTelemetry.formants.f2,
      f3: summary.f3Hz || repTelemetry.formants.f3,
      b1: repTelemetry.formants.b1,
      b2: repTelemetry.formants.b2,
      b3: repTelemetry.formants.b3,
      confidence: summary.voicedFraction > 0 ? Math.max(0.5, repTelemetry.formants.confidence) : repTelemetry.formants.confidence,
    },
    evalTarget,
  );

  const wavBytes = encodeWav(sliced, sampleRate);
  const repFrame = buildRepresentativeFrame(repTelemetry);

  return {
    id: createId(),
    title: options.title?.trim() || defaultTitleFor(sourceType, fileName, resolvedNearestId),
    createdAt: Date.now(),
    sourceType,
    ...(fileName ? { fileName } : {}),
    targetVowel: targetVowel ?? resolvedNearestId,
    notes: options.notes ?? "",
    durationSec: Number(durationSec.toFixed(2)),
    sampleRate,
    wavBytes,
    summary: {
      f0Hz: summary.f0Hz || Number(repTelemetry.stability.f0Hz.toFixed(1)),
      f1Hz: summary.f1Hz || Math.round(repTelemetry.formants.f1),
      f2Hz: summary.f2Hz || Math.round(repTelemetry.formants.f2),
      f3Hz: summary.f3Hz || Math.round(repTelemetry.formants.f3),
      jitterPercent: summary.jitterPercent,
      shimmerDb: summary.shimmerDb,
      rmsDb: Number(repTelemetry.stability.rmsDb.toFixed(1)),
      nearestVowel: resolvedNearestId,
      convergenceScore: Number((analysis.summary.target?.convergenceScore ?? match.convergenceScore).toFixed(1)),
      distanceBark: Number((analysis.summary.target?.distanceBark ?? match.distanceBark).toFixed(2)),
      voicedFraction: summary.voicedFraction,
    },
    representativeFrame: repFrame,
  };
}

/**
 * Reconstruct a full `DSPFrameTelemetry` object from a `SavedTake`'s `representativeFrame`
 * so SPONDON's real canvas renderers (`<Trace>`, `draw.ts`) can draw or overlay it directly.
 */
export function telemetryFromSavedTake(take: SavedTake): DSPFrameTelemetry {
  const rep = take.representativeFrame;
  const target = findVowel(take.targetVowel ?? take.summary.nearestVowel ?? DEFAULT_TARGET.id);
  const f1 = rep.f1 || take.summary.f1Hz;
  const f2 = rep.f2 || take.summary.f2Hz;
  const f3 = rep.f3 || take.summary.f3Hz;
  const poles: ComplexPoint[] = rep.zPlanePoles.map((p) => {
    const magnitude = Math.hypot(p.re, p.im);
    const angleRad = Math.atan2(p.im, p.re);
    return {
      re: p.re,
      im: p.im,
      magnitude,
      angleRad,
      freqHz: p.freqHz,
      bandwidthHz: p.bandwidthHz,
      formantIndex: p.formantIndex ?? 0,
    };
  });

  const formants = {
    f1,
    f2,
    f3,
    b1: rep.b1,
    b2: rep.b2,
    b3: rep.b3,
    confidence: rep.voiced && f1 > 0 && f2 > 0 ? 0.9 : 0,
  };
  const activeTargetMatch = evaluateTargetConvergence(formants, target);

  const fftArr = new Float32Array(FRAME_SIZE);
  fftArr.fill(-120);
  for (let i = 0; i < Math.min(FRAME_SIZE, rep.fftMagnitudeDb.length); i++) {
    fftArr[i] = rep.fftMagnitudeDb[i];
  }

  const lpcArr = new Float32Array(FRAME_SIZE);
  lpcArr.fill(-120);
  for (let i = 0; i < Math.min(FRAME_SIZE, rep.lpcEnvelopeDb.length); i++) {
    lpcArr[i] = rep.lpcEnvelopeDb[i];
  }

  const rawArr = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < Math.min(FRAME_SIZE, rep.timeDomainRaw.length); i++) {
    rawArr[i] = rep.timeDomainRaw[i];
  }

  const winArr = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < Math.min(FRAME_SIZE, rep.timeDomainWindowed.length); i++) {
    winArr[i] = rep.timeDomainWindowed[i];
  }

  return {
    timestampMs: rep.timestampMs,
    sampleRate: rep.sampleRate || take.sampleRate,
    analysisRate: rep.analysisRate || 12000,
    windowType: rep.windowType || "hamming",
    voiced: rep.voiced,
    timeDomainRaw: rawArr,
    timeDomainWindowed: winArr,
    fftMagnitudeDb: fftArr,
    lpcEnvelopeDb: lpcArr,
    lpcCoefficients: [],
    zPlanePoles: poles,
    formants,
    stability: {
      f0Hz: rep.f0Hz || take.summary.f0Hz,
      pitchConfidence: rep.voiced ? 0.9 : 0,
      jitterPercent: take.summary.jitterPercent,
      shimmerDb: take.summary.shimmerDb,
      rmsDb: take.summary.rmsDb,
      zeroCrossingRate: 0,
      syllablesPerSec: 0,
    },
    activeTargetMatch,
    stageBuffers: createStageTraceBuffers(12),
  };
}

const decodedCache = new Map<string, { sampleRate: number; samples: Float32Array }>();

/**
 * Decode a `SavedTake`'s embedded WAV (cached in memory per take ID) and run `VoiceAnalyzer`
 * cleanly at the requested timestamp `timeSec` so users can scrub across long recordings.
 */
export function analyzeTakeAtTime(take: SavedTake, timeSec: number): DSPFrameTelemetry {
  let cached = decodedCache.get(take.id);
  if (!cached) {
    const wav = decodeWav(take.wavBytes);
    cached = { sampleRate: wav.sampleRate, samples: wav.samples };
    if (decodedCache.size > 24) {
      const oldest = decodedCache.keys().next().value;
      if (oldest) decodedCache.delete(oldest);
    }
    decodedCache.set(take.id, cached);
  }
  const target = findVowel(take.targetVowel ?? take.summary.nearestVowel ?? DEFAULT_TARGET.id);
  const hopSamples = Math.max(1, Math.round(0.01 * cached.sampleRate));
  const endSample = Math.max(hopSamples, Math.min(cached.samples.length, Math.round(timeSec * cached.sampleRate)));
  return evaluateFrameEndingAt(cached.samples, cached.sampleRate, endSample, hopSamples, target);
}
