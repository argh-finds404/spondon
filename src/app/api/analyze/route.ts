import { analyzeRecording } from "@/lib/dsp/offline";
import { VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { decodeWav, WavError } from "@/lib/dsp/wav";
import { CORS_HEADERS, jsonError, preflight } from "../http";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SECONDS = 30;
const MIN_SECONDS = 0.1;
const ACCEPTED_TYPES = ["audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave", "application/octet-stream"];

export async function POST(request: Request) {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.includes(type)) return jsonError(415, "Send a WAV file with Content-Type: audio/wav.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return jsonError(413, `The body must be ${MAX_BYTES} bytes or less.`);

  const params = new URL(request.url).searchParams;
  const targetId = params.get("target");
  const target = targetId ? VOWEL_TARGETS.find((v) => v.id === targetId) : undefined;
  if (targetId && !target) return jsonError(400, `target must be one of: ${VOWEL_TARGETS.map((v) => v.id).join(", ")}.`);

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return jsonError(413, `The body must be ${MAX_BYTES} bytes or less.`);

  let wav;
  try {
    wav = decodeWav(body);
  } catch (error) {
    if (error instanceof WavError) return jsonError(400, error.message);
    throw error;
  }
  const duration = wav.samples.length / wav.sampleRate;
  if (duration > MAX_SECONDS) return jsonError(413, `Recordings must be ${MAX_SECONDS} s or shorter.`);
  if (duration < MIN_SECONDS) return jsonError(400, `Recordings must be at least ${MIN_SECONDS} s long.`);

  // Audio is analysed in memory and discarded with the request; nothing is stored or logged.
  const result = analyzeRecording(wav.samples, wav.sampleRate, { hopMs: 10, target });
  return Response.json(result, { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}

export const OPTIONS = preflight;
