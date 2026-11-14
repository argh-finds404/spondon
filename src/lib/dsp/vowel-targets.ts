import type { FormantPeak, TargetMatch, VowelTarget } from "@/types/dsp";

/**
 * Reference formants for eight vowels. Typical adult values from the phonetics
 * literature, rounded; a starting point for practice, not a norm for any one speaker.
 */
export const VOWEL_TARGETS: VowelTarget[] = [
  {
    id: "aa",
    symbol: "ɑː",
    banglaSymbol: "আ",
    label: "Low back unrounded",
    targetF1: 750,
    targetF2: 1180,
    targetF3: 2540,
    toleranceHz: 110,
    articulation: "Drop the jaw wide; keep the tongue low and relaxed.",
  },
  {
    id: "ii",
    symbol: "iː",
    banglaSymbol: "ই",
    label: "High front unrounded",
    targetF1: 280,
    targetF2: 2280,
    targetF3: 2950,
    toleranceHz: 130,
    articulation: "Arch the tongue high toward the hard palate; spread the lips gently.",
  },
  {
    id: "uu",
    symbol: "uː",
    banglaSymbol: "উ",
    label: "High back rounded",
    targetF1: 310,
    targetF2: 870,
    targetF3: 2250,
    toleranceHz: 100,
    articulation: "Round the lips forward; raise the back of the tongue.",
  },
  {
    id: "e",
    symbol: "e",
    banglaSymbol: "এ",
    label: "Mid-high front",
    targetF1: 430,
    targetF2: 1980,
    targetF3: 2560,
    toleranceHz: 120,
    articulation: "Tongue mid-high and forward; lip corners neutral.",
  },
  {
    id: "oo",
    symbol: "ɔ",
    banglaSymbol: "অ",
    label: "Low-mid back rounded",
    targetF1: 560,
    targetF2: 920,
    targetF3: 2500,
    toleranceHz: 100,
    articulation: "Round the lips slightly; open the back of the throat.",
  },
  {
    id: "o",
    symbol: "o",
    banglaSymbol: "ও",
    label: "Mid-high back rounded",
    targetF1: 410,
    targetF2: 810,
    targetF3: 2400,
    toleranceHz: 100,
    articulation: "Round the lips; lift the back of the tongue.",
  },
  {
    id: "ae",
    symbol: "æ",
    label: "Near-low front, as in “ash”",
    targetF1: 680,
    targetF2: 1750,
    targetF3: 2450,
    toleranceHz: 120,
    articulation: "Open the front of the mouth wide; lower the jaw.",
  },
  {
    id: "er",
    symbol: "ɜː",
    label: "Mid central, as in “bird”",
    targetF1: 490,
    targetF2: 1380,
    targetF3: 2480,
    toleranceHz: 110,
    articulation: "Let the tongue rest in the middle: a neutral, even tube.",
  },
];

export const DEFAULT_TARGET = VOWEL_TARGETS[0];

export function findVowel(id: string | null | undefined): VowelTarget {
  return VOWEL_TARGETS.find((v) => v.id === id) ?? DEFAULT_TARGET;
}

/** The vowel's letter as people write it: Bangla where there is one, else IPA between slashes. */
export function vowelGlyph(v: VowelTarget): string {
  return v.banglaSymbol ?? `/${v.symbol}/`;
}

/** Traunmüller (1990): critical-band rate in Bark. */
export function hzToBark(hz: number): number {
  return (26.81 * hz) / (1960 + hz) - 0.53;
}

export function distanceBark(f1: number, f2: number, target: VowelTarget): number {
  return Math.hypot(hzToBark(f1) - hzToBark(target.targetF1), hzToBark(f2) - hzToBark(target.targetF2));
}

export function nearestVowel(f1: number, f2: number): VowelTarget {
  let best = VOWEL_TARGETS[0];
  let bestD = Infinity;
  for (const v of VOWEL_TARGETS) {
    const d = distanceBark(f1, f2, v);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

export const GUIDANCE = {
  silent: "Waiting for a voiced sound.",
  locked: "Locked on. Hold it there.",
  open: "Open the jaw a little more.",
  close: "Close the jaw a little; raise the tongue.",
  front: "Bring the tongue forward; spread the lips.",
  back: "Pull the tongue back; round the lips.",
} as const;

/** A score of 80 or more counts as on the vowel (about half a Bark away). */
export const LOCK_SCORE = 80;

/**
 * Distance from the measured (F1, F2) to a target, in Hz and in Bark, a 0..100 score
 * (a Gaussian of the Bark distance, 1 Bark wide) and which way to move.
 * F1 rises as the mouth opens; F2 rises as the tongue moves forward and the lips spread.
 */
export function evaluateTargetConvergence(
  formants: FormantPeak,
  target: VowelTarget,
  out: TargetMatch = {
    targetId: target.id,
    euclideanDistanceHz: 0,
    distanceBark: 0,
    convergenceScore: 0,
    guidance: GUIDANCE.silent,
  },
): TargetMatch {
  out.targetId = target.id;
  if (!(formants.f1 > 0) || !(formants.f2 > 0)) {
    out.euclideanDistanceHz = 0;
    out.distanceBark = 0;
    out.convergenceScore = 0;
    out.guidance = GUIDANCE.silent;
    return out;
  }
  const d1 = hzToBark(formants.f1) - hzToBark(target.targetF1);
  const d2 = hzToBark(formants.f2) - hzToBark(target.targetF2);
  const bark = Math.hypot(d1, d2);
  out.euclideanDistanceHz = Math.hypot(formants.f1 - target.targetF1, formants.f2 - target.targetF2);
  out.distanceBark = bark;
  out.convergenceScore = 100 * Math.exp(-0.5 * bark * bark);
  if (out.convergenceScore >= LOCK_SCORE) out.guidance = GUIDANCE.locked;
  else if (Math.abs(d1) >= Math.abs(d2)) out.guidance = d1 < 0 ? GUIDANCE.open : GUIDANCE.close;
  else out.guidance = d2 < 0 ? GUIDANCE.front : GUIDANCE.back;
  return out;
}
