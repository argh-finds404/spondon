// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encodeWav } from "@/lib/dsp/wav";
import { POST as analyze } from "../analyze/route";
import { GET as synth } from "../synth/route";
import { GET as vowels, OPTIONS } from "../vowels/route";

const BASE = "http://localhost/api";

describe("GET /api/vowels", () => {
  it("lists eight vowels with Bark coordinates and figure modes", async () => {
    const res = await vowels();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.vowels).toHaveLength(8);
    const aa = body.vowels.find((v: { id: string }) => v.id === "aa");
    expect(aa).toMatchObject({ banglaSymbol: "আ", targetF1: 750, targetF2: 1180 });
    expect(aa.bark.f1).toBeGreaterThan(6);
    expect(aa.modes.n).toBeGreaterThan(aa.modes.m);
  });

  it("answers a CORS preflight", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("GET /api/synth", () => {
  it("returns a 16-bit mono WAV of the requested length", async () => {
    const res = await synth(new Request(`${BASE}/synth?vowel=ii&f0=180&duration=0.5&rate=16000`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(0.5 * 16000 * 2);
    // Soft edges: the file starts and ends at silence.
    expect(view.getInt16(44, true)).toBe(0);
  });

  it("is deterministic for the same parameters", async () => {
    const url = `${BASE}/synth?vowel=oo&f0=120&jitter=1&duration=0.2&rate=8000`;
    const a = new Uint8Array(await (await synth(new Request(url))).arrayBuffer());
    const b = new Uint8Array(await (await synth(new Request(url))).arrayBuffer());
    expect(a).toEqual(b);
  });

  it.each([
    ["vowel=zz", /vowel must be one of/],
    ["f0=20", /f0 must be a number from 60 to 400/],
    ["f0=abc", /f0 must be/],
    ["jitter=9", /jitter must be/],
    ["duration=60", /duration must be/],
    ["rate=11111", /rate must be one of/],
  ])("rejects %s", async (query, message) => {
    const res = await synth(new Request(`${BASE}/synth?${query}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
  });
});

describe("POST /api/analyze", () => {
  const post = (body: BodyInit, type = "audio/wav", query = "") =>
    analyze(new Request(`${BASE}/analyze${query}`, { method: "POST", headers: { "content-type": type }, body }));

  it("measures a WAV produced by /api/synth", async () => {
    const wav = await (await synth(new Request(`${BASE}/synth?vowel=uu&f0=150&duration=1.5&rate=48000`))).arrayBuffer();
    const res = await post(wav, "audio/wav", "?target=uu");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sampleRate).toBe(48000);
    expect(body.hopMs).toBe(10);
    expect(body.frames.length).toBe(150);
    expect(Math.abs(body.summary.f0Hz - 150)).toBeLessThan(1.5);
    expect(Math.abs(body.summary.f1Hz - 310)).toBeLessThan(60);
    expect(Math.abs(body.summary.f2Hz - 870)).toBeLessThan(60);
    expect(body.summary.nearestVowel).toBe("uu");
    expect(body.summary.target.convergenceScore).toBeGreaterThan(80);
  });

  it("refuses the wrong content type", async () => {
    expect((await post("hello", "text/plain")).status).toBe(415);
  });

  it("refuses something that is not a WAV", async () => {
    const res = await post(new TextEncoder().encode("not audio at all"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/RIFF/);
  });

  it("refuses an unknown target", async () => {
    expect((await post(encodeWav(new Float32Array(8000), 8000), "audio/wav", "?target=xx")).status).toBe(400);
  });

  it("refuses recordings that are too short or too long", async () => {
    expect((await post(encodeWav(new Float32Array(400), 8000))).status).toBe(400);
    expect((await post(encodeWav(new Float32Array(8000 * 31), 8000))).status).toBe(413);
  });

  it("refuses bodies over 4 MB", async () => {
    expect((await post(new Uint8Array(4 * 1024 * 1024 + 1))).status).toBe(413);
  });
});
