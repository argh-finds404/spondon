import { chladniModes } from "@/lib/chladni";
import { hzToBark, VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";
import { CORS_HEADERS, preflight } from "../http";

export async function GET() {
  const vowels = VOWEL_TARGETS.map((v) => {
    const modes = chladniModes(v.targetF1, v.targetF2);
    return {
      ...v,
      bark: {
        f1: Math.round(hzToBark(v.targetF1) * 1000) / 1000,
        f2: Math.round(hzToBark(v.targetF2) * 1000) / 1000,
      },
      modes: { m: Math.round(modes.m * 1000) / 1000, n: Math.round(modes.n * 1000) / 1000 },
    };
  });
  return Response.json(
    { vowels },
    { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}

export const OPTIONS = preflight;
