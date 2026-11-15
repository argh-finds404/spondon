import { synthesizeVoice } from "@/lib/dsp/synth";
import { findVowel } from "@/lib/dsp/vowel-targets";

/**
 * One short sung vowel, the way a key on an instrument sounds a note. The same source-filter voice the
 * lab analyses, rendered once per vowel and kept. Only ever called from a key press, so the browser
 * allows the sound.
 */
let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
const buffers = new Map<string, AudioBuffer>();

const SECONDS = 0.9;
const ATTACK = 0.02;
const RELEASE = 0.28;

function render(context: AudioContext, id: string): AudioBuffer {
  const v = findVowel(id);
  const sr = context.sampleRate;
  const x = synthesizeVoice({
    sampleRate: sr,
    f0Hz: 150,
    formants: [v.targetF1, v.targetF2, v.targetF3],
    durationSec: SECONDS,
    jitterPercent: 0.4,
    seed: 3,
  });
  const attack = Math.round(ATTACK * sr);
  const release = Math.round(RELEASE * sr);
  for (let i = 0; i < attack; i++) x[i] *= i / attack;
  for (let i = 0; i < release; i++) x[x.length - 1 - i] *= i / release;
  const buffer = context.createBuffer(1, x.length, sr);
  buffer.copyToChannel(x, 0);
  return buffer;
}

export function playVowel(id: string, volume = 0.32): void {
  ctx ??= new AudioContext();
  void ctx.resume();
  let buffer = buffers.get(id);
  if (!buffer) {
    buffer = render(ctx, id);
    buffers.set(id, buffer);
  }
  playing?.stop();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start();
  playing = src;
}
