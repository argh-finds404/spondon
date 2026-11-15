import type { VowelTarget } from "@/types/dsp";
import { VoiceAnalyzer } from "./analyzer";
import { evaluateTargetConvergence, nearestVowel } from "./vowel-targets";

export interface RecordingFrame {
  /** Seconds from the start of the recording to the end of the analysis window. */
  t: number;
  /** 0 where unvoiced. */
  f0: number;
  /** 0 where no formant was tracked. */
  f1: number;
  f2: number;
  f3: number;
  voiced: boolean;
}

export interface RecordingSummary {
  voicedFraction: number;
  /** Medians over the frames that carry a value; 0 when none do. */
  f0Hz: number;
  f1Hz: number;
  f2Hz: number;
  f3Hz: number;
  jitterPercent: number;
  shimmerDb: number;
  nearestVowel: string | null;
  target?: { id: string; distanceBark: number; convergenceScore: number };
}

export interface RecordingAnalysis {
  sampleRate: number;
  durationSec: number;
  hopMs: number;
  frames: RecordingFrame[];
  summary: RecordingSummary;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length & 1 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/**
 * Run the live analyser over a whole recording, one frame every hopMs, exactly as the
 * lab would see it streamed. The first frames see leading silence, like a live start.
 */
export function analyzeRecording(
  samples: Float32Array,
  sampleRate: number,
  options: { hopMs?: number; target?: VowelTarget } = {},
): RecordingAnalysis {
  const hopMs = options.hopMs ?? 10;
  const analyzer = new VoiceAnalyzer(sampleRate);
  if (options.target) analyzer.target = options.target;
  const size = analyzer.rawSize;
  const padded = new Float32Array(size + samples.length);
  padded.set(samples, size);
  const hop = Math.max(1, Math.round((hopMs / 1000) * sampleRate));

  const frames: RecordingFrame[] = [];
  const f0s: number[] = [];
  const f1s: number[] = [];
  const f2s: number[] = [];
  const f3s: number[] = [];
  const jitters: number[] = [];
  const shimmers: number[] = [];
  let voicedCount = 0;
  for (let end = hop; end <= samples.length; end += hop) {
    const t = analyzer.process(padded.subarray(end, end + size), (end / sampleRate) * 1000);
    const st = t.stability;
    const tracked = t.voiced && t.formants.confidence > 0.05 && t.formants.f1 > 0 && t.formants.f2 > 0;
    const frame: RecordingFrame = {
      t: round(end / sampleRate, 3),
      f0: t.voiced ? round(st.f0Hz, 1) : 0,
      f1: tracked ? Math.round(t.formants.f1) : 0,
      f2: tracked ? Math.round(t.formants.f2) : 0,
      f3: tracked && t.formants.f3 > 0 ? Math.round(t.formants.f3) : 0,
      voiced: t.voiced,
    };
    frames.push(frame);
    if (t.voiced) {
      voicedCount++;
      f0s.push(st.f0Hz);
      if (st.jitterPercent > 0) jitters.push(st.jitterPercent);
      if (st.shimmerDb > 0) shimmers.push(st.shimmerDb);
    }
    if (tracked) {
      f1s.push(t.formants.f1);
      f2s.push(t.formants.f2);
      if (t.formants.f3 > 0) f3s.push(t.formants.f3);
    }
  }

  const summary: RecordingSummary = {
    voicedFraction: frames.length ? round(voicedCount / frames.length, 3) : 0,
    f0Hz: round(median(f0s), 1),
    f1Hz: Math.round(median(f1s)),
    f2Hz: Math.round(median(f2s)),
    f3Hz: Math.round(median(f3s)),
    jitterPercent: round(median(jitters), 3),
    shimmerDb: round(median(shimmers), 3),
    nearestVowel: f1s.length ? nearestVowel(median(f1s), median(f2s)).id : null,
  };
  if (options.target) {
    const match = evaluateTargetConvergence(
      { f1: median(f1s), f2: median(f2s), f3: median(f3s), b1: 0, b2: 0, b3: 0, confidence: 1 },
      options.target,
    );
    summary.target = {
      id: options.target.id,
      distanceBark: round(match.distanceBark, 3),
      convergenceScore: round(match.convergenceScore, 1),
    };
  }
  return {
    sampleRate,
    durationSec: round(samples.length / sampleRate, 3),
    hopMs,
    frames,
    summary,
  };
}
