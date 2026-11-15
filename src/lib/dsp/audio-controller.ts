import type { DSPFrameTelemetry, VowelTarget } from "@/types/dsp";
import { VoiceAnalyzer, type AnalyzerOptions } from "./analyzer";
import { synthesizeVoice, type FormantKeyframe, type Formants3 } from "./synth";
import { findVowel } from "./vowel-targets";

/**
 * silent: the synthetic voice is analysed straight from its buffer; no AudioContext, no sound.
 * synth:  the same buffer is played through Web Audio and read back from an AnalyserNode.
 * mic:    the microphone feeds that AnalyserNode instead. Nothing is recorded or sent anywhere.
 * stream: a shared browser tab / YouTube / music stream feeds that AnalyserNode (video track stopped immediately).
 */
export type SourceMode = "silent" | "synth" | "mic" | "stream";
export type AudioSourceMode = SourceMode;

export interface SynthSettings {
  vowelId: string;
  f0Hz: number;
  /** Scales F1..F3 together, like a longer or shorter vocal tract. */
  formantShift: number;
  jitterPercent: number;
  /** Glide around all the vowels instead of holding one. */
  tour: boolean;
}

export const DEFAULT_SYNTH: SynthSettings = {
  vowelId: "aa",
  f0Hz: 140,
  formantShift: 1,
  jitterPercent: 0.4,
  tour: true,
};

/** Once round the vowel quadrilateral: low back, front, high front, centre, high back, and home. */
export const TOUR_ORDER = ["aa", "ae", "e", "ii", "er", "uu", "o", "oo"] as const;
const HOLD_SEC = 0.9;
const GLIDE_SEC = 0.6;
const SILENT_RATE = 48000;

type Listener = (telemetry: DSPFrameTelemetry) => void;

export class AudioController {
  mode: SourceMode = "silent";
  settings: SynthSettings;
  analyzer: VoiceAnalyzer;
  volume = 0.4;
  onStreamEnded: (() => void) | null = null;

  private raw: Float32Array<ArrayBuffer>;
  private loop: Float32Array<ArrayBuffer> = new Float32Array(0);
  private listeners = new Set<Listener>();
  private rafId = 0;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private out: GainNode | null = null;
  private stream: MediaStream | null = null;
  private voice: { src: AudioBufferSourceNode; gain: GainNode; startedAt: number } | null = null;

  constructor(settings: Partial<SynthSettings> = {}, options: Partial<AnalyzerOptions> = {}) {
    this.settings = { ...DEFAULT_SYNTH, ...settings };
    this.analyzer = new VoiceAnalyzer(SILENT_RATE, options);
    this.analyzer.target = findVowel(this.settings.vowelId);
    this.raw = new Float32Array(this.analyzer.rawSize);
    this.renderLoop();
  }

  get telemetry(): DSPFrameTelemetry {
    return this.analyzer.telemetry;
  }

  /** Return the raw PCM slice of the most recent frame (or seed one from the synth loop if none ran yet). */
  getCurrentRawSlice(): Float32Array {
    if (!this.analyzer.hasCapturedRaw() && this.loop.length > 0) {
      const length = this.loop.length;
      for (let k = 0; k < this.raw.length; k++) {
        this.raw[k] = this.loop[k % length];
      }
      this.analyzer.process(this.raw, 0);
    }
    return this.analyzer.getLastRawInput();
  }

  /** Frames are produced only while someone is listening. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.rafId && typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(this.tick);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    };
  }

  setSettings(patch: Partial<SynthSettings>): void {
    Object.assign(this.settings, patch);
    this.renderLoop();
    if (this.mode === "synth") this.playLoop();
  }

  setOptions(patch: Partial<AnalyzerOptions>): void {
    Object.assign(this.analyzer.options, patch);
  }

  setTarget(target: VowelTarget): void {
    this.analyzer.target = target;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  /** Must be called from a user gesture: browsers only start audio, or ask for the microphone/tab, on one. */
  async start(mode: "synth" | "mic" | "stream"): Promise<void> {
    this.release();
    const ctx = new AudioContext();
    this.ctx = ctx;
    try {
      if (mode === "mic") {
        // The browser's speech clean-up would reshape the very resonances being measured.
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } else if (mode === "stream") {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error("Tab audio capture is not supported in this browser.");
        }
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
        });
        const audioTrack = displayStream.getAudioTracks()[0];
        displayStream.getVideoTracks().forEach((t) => t.stop());
        if (!audioTrack) {
          displayStream.getTracks().forEach((t) => t.stop());
          throw new Error("Enable 'Share tab audio' in the browser picker to analyze YouTube or music streams.");
        }
        audioTrack.addEventListener("ended", () => {
          this.onStreamEnded?.();
        });
        this.stream = new MediaStream([audioTrack]);
      }
      await ctx.resume();
      this.useRate(ctx.sampleRate);
      if (this.analyzer.rawSize > 32768) throw new Error(`Unsupported sample rate: ${ctx.sampleRate} Hz`);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = this.analyzer.rawSize;
      this.analyser = analyser;
      if ((mode === "mic" || mode === "stream") && this.stream) {
        // Analysed, never routed to the speakers (prevents double-echo).
        ctx.createMediaStreamSource(this.stream).connect(analyser);
      } else {
        this.out = ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(ctx.destination);
        this.playLoop();
      }
      this.mode = mode;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** Back to the silent voice. */
  stop(): void {
    this.release();
    this.mode = "silent";
    this.useRate(SILENT_RATE);
  }

  private release(): void {
    this.voice?.src.stop();
    this.voice = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    this.out = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  private useRate(sampleRate: number): void {
    if (this.analyzer.sampleRate === sampleRate) return;
    const previous = this.analyzer;
    this.analyzer = new VoiceAnalyzer(sampleRate, previous.options);
    this.analyzer.target = previous.target;
    this.raw = new Float32Array(this.analyzer.rawSize);
    this.renderLoop();
  }

  private renderLoop(): void {
    const s = this.settings;
    const shifted = (id: string): Formants3 => {
      const v = findVowel(id);
      return [v.targetF1 * s.formantShift, v.targetF2 * s.formantShift, v.targetF3 * s.formantShift];
    };
    let track: FormantKeyframe[] | undefined;
    if (s.tour) {
      track = [];
      let t = 0;
      for (const id of TOUR_ORDER) {
        track.push({ tSec: t, formants: shifted(id) }, { tSec: t + HOLD_SEC, formants: shifted(id) });
        t += HOLD_SEC + GLIDE_SEC;
      }
      track.push({ tSec: t, formants: shifted(TOUR_ORDER[0]) });
    }
    this.loop = synthesizeVoice({
      sampleRate: this.analyzer.sampleRate,
      f0Hz: s.f0Hz,
      jitterPercent: s.jitterPercent,
      track,
      formants: shifted(s.vowelId),
      durationSec: 2,
      seed: 7,
    });
  }

  /** Swap in the current loop with a 40 ms crossfade, keeping its place in the tour. */
  private playLoop(): void {
    const { ctx, analyser, out, loop } = this;
    if (!ctx || !analyser || !out) return;
    const buffer = ctx.createBuffer(1, loop.length, ctx.sampleRate);
    buffer.copyToChannel(loop, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(analyser);
    gain.connect(out);
    const now = ctx.currentTime;
    const previous = this.voice;
    const offset = previous ? (now - previous.startedAt) % buffer.duration : 0;
    gain.gain.setValueAtTime(previous ? 0 : 1, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.04);
    src.start(now, offset);
    if (previous) {
      previous.gain.gain.setValueAtTime(1, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + 0.04);
      previous.src.stop(now + 0.06);
    }
    this.voice = { src, gain, startedAt: now - offset };
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const { raw, analyser } = this;
    if (this.mode !== "silent" && analyser) {
      analyser.getFloatTimeDomainData(raw);
    } else {
      const { loop } = this;
      const length = loop.length;
      let i = (Math.floor((now / 1000) * this.analyzer.sampleRate) - raw.length) % length;
      if (i < 0) i += length;
      for (let k = 0; k < raw.length; k++) {
        raw[k] = loop[i];
        if (++i === length) i = 0;
      }
    }
    const telemetry = this.analyzer.process(raw, now);
    for (const listener of this.listeners) listener(telemetry);
  };
}
