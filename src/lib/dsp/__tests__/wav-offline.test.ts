import { describe, expect, it } from "vitest";
import { analyzeRecording } from "../offline";
import { synthesizeVoice } from "../synth";
import { findVowel } from "../vowel-targets";
import { decodeWav, encodeWav, WavError } from "../wav";

/** Build a WAV with any encoding, interleaving the given channels. */
function makeWav(channels: number[][], sampleRate: number, format: number, bits: number): Uint8Array {
  const n = channels[0].length;
  const bps = bits / 8;
  const block = bps * channels.length;
  const out = new Uint8Array(44 + n * block);
  const view = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, 36 + n * block, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, bits, true);
  tag(36, "data");
  view.setUint32(40, n * block, true);
  for (let i = 0; i < n; i++) {
    channels.forEach((ch, c) => {
      const o = 44 + i * block + c * bps;
      const v = ch[i];
      if (format === 3) view.setFloat32(o, v, true);
      else if (bits === 8) view.setUint8(o, Math.round(v * 127 + 128));
      else if (bits === 16) view.setInt16(o, Math.round(v * 32767), true);
      else if (bits === 24) {
        const s = Math.round(v * 8388607);
        view.setUint8(o, s & 0xff);
        view.setUint8(o + 1, (s >> 8) & 0xff);
        view.setUint8(o + 2, (s >> 16) & 0xff);
      } else view.setInt32(o, Math.round(v * 2147483647), true);
    });
  }
  return out;
}

describe("WAV codec", () => {
  it("round-trips 16-bit mono within 1.5 quantisation steps (encode x32767, decode /32768)", () => {
    const x = Float32Array.from({ length: 480 }, (_, i) => 0.9 * Math.sin(i / 7));
    const back = decodeWav(encodeWav(x, 48000));
    expect(back.sampleRate).toBe(48000);
    expect(back.channels).toBe(1);
    expect(back.samples.length).toBe(480);
    for (let i = 0; i < x.length; i++) expect(Math.abs(back.samples[i] - x[i])).toBeLessThan(1.5 / 32767);
  });

  it("reads every supported encoding and mixes channels to mono", () => {
    const left = [0.5, -0.25, 0.75, 0];
    const right = [0.5, 0.25, -0.75, 0.5];
    const mono = [0.5, 0, 0, 0.25];
    for (const [format, bits, tol] of [
      [1, 8, 1 / 64],
      [1, 16, 1e-4],
      [1, 24, 1e-6],
      [1, 32, 1e-8],
      [3, 32, 1e-7],
    ] as const) {
      const decoded = decodeWav(makeWav([left, right], 22050, format, bits));
      expect(decoded.channels).toBe(2);
      decoded.samples.forEach((v, i) => expect(Math.abs(v - mono[i]), `${format}/${bits}`).toBeLessThan(tol));
    }
  });

  it("skips unknown chunks and their pad byte", () => {
    const base = encodeWav(Float32Array.from([0.5, -0.5]), 8000);
    // Insert a 3-byte LIST chunk (padded to 4) between fmt and data.
    const extra = Uint8Array.from([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]);
    const wav = new Uint8Array(base.length + extra.length);
    wav.set(base.subarray(0, 36));
    wav.set(extra, 36);
    wav.set(base.subarray(36), 36 + extra.length);
    expect(Array.from(decodeWav(wav).samples, (v) => Math.round(v * 2) / 2)).toEqual([0.5, -0.5]);
  });

  it("rejects files that are not WAV or not supported", () => {
    expect(() => decodeWav(new TextEncoder().encode("ID3 definitely an mp3"))).toThrow(WavError);
    expect(() => decodeWav(makeWav([[0]], 48000, 2, 16))).toThrow(/Unsupported encoding: format 2/);
    expect(() => decodeWav(makeWav([[0]], 1000, 1, 16))).toThrow(/sample rate/);
    expect(() => decodeWav(encodeWav(new Float32Array(4), 8000).subarray(0, 30))).toThrow(WavError);
  });
});

describe("offline analysis of a recording", () => {
  it("tracks a glide from /ɑː/ to /iː/ and summarises it", () => {
    const aa = findVowel("aa");
    const ii = findVowel("ii");
    const sampleRate = 16000;
    const samples = synthesizeVoice({
      sampleRate,
      f0Hz: 130,
      track: [
        { tSec: 0, formants: [aa.targetF1, aa.targetF2, aa.targetF3] },
        { tSec: 0.8, formants: [aa.targetF1, aa.targetF2, aa.targetF3] },
        { tSec: 1.2, formants: [ii.targetF1, ii.targetF2, ii.targetF3] },
        { tSec: 2, formants: [ii.targetF1, ii.targetF2, ii.targetF3] },
      ],
    });
    const result = analyzeRecording(samples, sampleRate, { hopMs: 10, target: ii });
    expect(result.durationSec).toBe(2);
    expect(result.frames.length).toBe(200);
    expect(result.summary.voicedFraction).toBeGreaterThan(0.9);
    expect(Math.abs(result.summary.f0Hz - 130)).toBeLessThan(1.5);

    const at = (t: number) => result.frames.find((f) => Math.abs(f.t - t) < 0.006)!;
    expect(Math.abs(at(0.6).f1 - aa.targetF1)).toBeLessThan(60);
    expect(Math.abs(at(0.6).f2 - aa.targetF2)).toBeLessThan(60);
    expect(Math.abs(at(1.9).f1 - ii.targetF1)).toBeLessThan(60);
    expect(Math.abs(at(1.9).f2 - ii.targetF2)).toBeLessThan(80);
    expect(result.summary.target?.id).toBe("ii");
  });

  it("reports silence as silence", () => {
    const result = analyzeRecording(new Float32Array(8000), 8000);
    expect(result.summary.voicedFraction).toBe(0);
    expect(result.summary.f0Hz).toBe(0);
    expect(result.summary.nearestVowel).toBeNull();
    expect(result.frames.every((f) => !f.voiced && f.f1 === 0)).toBe(true);
  });
});
