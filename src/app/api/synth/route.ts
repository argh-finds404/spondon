import { synthesizeVoice } from "@/lib/dsp/synth";
import { VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { encodeWav } from "@/lib/dsp/wav";
import { CORS_HEADERS, jsonError, numberParam, preflight } from "../http";

const SYNTH_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000] as const;
const FADE_SEC = 0.01;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const vowelId = params.get("vowel") ?? "aa";
  const vowel = VOWEL_TARGETS.find((v) => v.id === vowelId);
  if (!vowel) return jsonError(400, `vowel must be one of: ${VOWEL_TARGETS.map((v) => v.id).join(", ")}.`);

  const f0 = numberParam(params, "f0", 140, 60, 400);
  const jitter = numberParam(params, "jitter", 0.4, 0, 5);
  const shimmer = numberParam(params, "shimmer", 0, 0, 3);
  const duration = numberParam(params, "duration", 1.5, 0.1, 5);
  const rate = numberParam(params, "rate", 16000, 8000, 48000);
  for (const v of [f0, jitter, shimmer, duration, rate]) if (typeof v === "string") return jsonError(400, v);
  if (!(SYNTH_RATES as readonly number[]).includes(rate as number)) {
    return jsonError(400, `rate must be one of: ${SYNTH_RATES.join(", ")}.`);
  }
  const sampleRate = rate as number;

  const samples = synthesizeVoice({
    sampleRate,
    f0Hz: f0 as number,
    formants: [vowel.targetF1, vowel.targetF2, vowel.targetF3],
    durationSec: duration as number,
    jitterPercent: jitter as number,
    shimmerDb: shimmer as number,
    seed: 7,
  });
  // The synth renders a seamless loop; a file played once needs soft edges instead.
  const fade = Math.min(Math.round(FADE_SEC * sampleRate), samples.length >> 1);
  for (let i = 0; i < fade; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }

  return new Response(encodeWav(samples, sampleRate), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "audio/wav",
      "Content-Disposition": `inline; filename="spondon-${vowel.id}-${f0}hz.wav"`,
      // Same parameters, same bytes: the synth is seeded.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const OPTIONS = preflight;
