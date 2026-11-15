import type { DSPFrameTelemetry, VowelTarget } from "@/types/dsp";
import { VoiceAnalyzer, type AnalyzerOptions } from "./analyzer";
import { generateSignal, type WaveKind } from "./signals";
import { synthesizeVoice, type FormantKeyframe, type Formants3 } from "./synth";
import { findVowel } from "./vowel-targets";

/**
 * silent: the synthetic voice is analysed straight from its buffer; no AudioContext, no sound.
 * synth:  the same buffer is played through Web Audio and read back from an AnalyserNode.
 * mic:    the microphone feeds that AnalyserNode instead. Nothing is sent anywhere; a 3 s clip is kept
 *         in memory only if you ask for one, and is wiped when the microphone is released.
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
  /** "voice" is the vowel synthesiser; anything else swaps in a classroom test signal. */
  wave: WaveKind;
  /** Fundamental of the test signal, in Hz. */
  waveHz: number;
}

export const DEFAULT_SYNTH: SynthSettings = {
  vowelId: "aa",
  f0Hz: 140,
  formantShift: 1,
  jitterPercent: 0.4,
  tour: true,
  wave: "voice",
  waveHz: 440,
};

/** Once round the vowel quadrilateral: low back, front, high front, centre, high back, and home. */
export const TOUR_ORDER = ["aa", "ae", "e", "ii", "er", "uu", "o", "oo"] as const;
const HOLD_SEC = 0.9;
const GLIDE_SEC = 0.6;
const SILENT_RATE = 48000;

type Listener = (telemetry: DSPFrameTelemetry) => void;

/** Runs on the audio thread and hands every block of samples to the page, in order and without gaps. */
const TAP_SOURCE =
  'registerProcessor("spondon-tap",class extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice());return true}})';

export class AudioController {
  mode: SourceMode = "silent";
  settings: SynthSettings;
  analyzer: VoiceAnalyzer;
  volume = 0.4;
  inputGain = 2.5;
  deviceLabel: string | null = null;
  isRecordingClip = false;
  hasRecordedClip = false;
  playingRecordedClip = false;
  recordingProgress = 0;
  onStreamEnded: (() => void) | null = null;
  onRecordingStateChange: (() => void) | null = null;

  private raw: Float32Array<ArrayBuffer>;
  private loop: Float32Array<ArrayBuffer> = new Float32Array(0);
  private recordBuf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private recordWritePos = 0;
  private recordNotified = 0;
  private tap: AudioWorkletNode | null = null;
  private tapModule: Promise<void> | null = null;
  private autoGain = 2.5;
  private listeners = new Set<Listener>();
  private rafId = 0;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private inGain: GainNode | null = null;
  private out: GainNode | null = null;
  private stream: MediaStream | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
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

  setInputGain(gain: number): void {
    this.inputGain = Math.max(0.5, Math.min(12, gain));
    if (this.inGain && this.ctx) {
      this.inGain.gain.setTargetAtTime(this.inputGain, this.ctx.currentTime, 0.02);
    }
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
        const micTrack = this.stream.getAudioTracks()[0];
        if (!micTrack) {
          throw new Error("No microphone audio track was returned by the browser.");
        }
        this.deviceLabel = micTrack.label || "Microphone active";
        micTrack.addEventListener("ended", () => {
          this.onStreamEnded?.();
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
        this.deviceLabel = audioTrack.label || "Shared tab audio";
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
      analyser.smoothingTimeConstant = 0;
      this.analyser = analyser;
      if ((mode === "mic" || mode === "stream") && this.stream) {
        // Analysed through a clean pre-gain node, never routed live to speakers (prevents feedback/echo).
        const inGain = ctx.createGain();
        inGain.gain.value = mode === "mic" ? this.inputGain : 1;
        this.inGain = inGain;
        const srcNode = ctx.createMediaStreamSource(this.stream);
        this.streamSource = srcNode;
        srcNode.connect(inGain);
        inGain.connect(analyser);
        this.out = ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(ctx.destination);
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

  /**
   * Record a short clip from the live microphone into memory, so it can be replayed and re-analysed.
   * Samples are taken on the audio thread, one block after another, so the clip has no seams.
   * It is never written to disk or sent anywhere, and is wiped when the microphone is released.
   */
  startRecordingClip(durationSec = 3): void {
    const ctx = this.ctx;
    if (this.mode !== "mic" || !ctx || !this.inGain) return;
    this.stopRecordedPlayback();
    this.closeTap();
    this.recordBuf = new Float32Array(Math.round(ctx.sampleRate * durationSec));
    this.recordWritePos = 0;
    this.recordNotified = 0;
    this.recordingProgress = 0;
    this.isRecordingClip = true;
    this.onRecordingStateChange?.();
    void this.openTap(ctx);
  }

  private async openTap(ctx: AudioContext): Promise<void> {
    try {
      this.tapModule ??= ctx.audioWorklet.addModule(
        URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" })),
      );
      await this.tapModule;
      // The source may have been switched while the module loaded.
      if (ctx !== this.ctx || !this.inGain || !this.isRecordingClip) return;
      const tap = new AudioWorkletNode(ctx, "spondon-tap", { numberOfInputs: 1, numberOfOutputs: 0 });
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => this.appendRecorded(event.data);
      this.inGain.connect(tap);
      this.tap = tap;
    } catch {
      this.isRecordingClip = false;
      this.onRecordingStateChange?.();
    }
  }

  private closeTap(): void {
    if (!this.tap) return;
    this.tap.port.onmessage = null;
    try {
      this.inGain?.disconnect(this.tap);
    } catch {
      /* already disconnected */
    }
    this.tap = null;
  }

  private appendRecorded(chunk: Float32Array): void {
    if (!this.isRecordingClip) return;
    const count = Math.min(chunk.length, this.recordBuf.length - this.recordWritePos);
    for (let k = 0; k < count; k++) this.recordBuf[this.recordWritePos + k] = chunk[k];
    this.recordWritePos += count;
    this.recordingProgress = this.recordWritePos / this.recordBuf.length;
    if (this.recordWritePos >= this.recordBuf.length) {
      this.closeTap();
      // Bring the clip's peak to 0.55 so playback is clear but never clips.
      let peak = 0;
      for (let i = 0; i < this.recordBuf.length; i++) {
        const v = this.recordBuf[i] < 0 ? -this.recordBuf[i] : this.recordBuf[i];
        if (v > peak) peak = v;
      }
      if (peak > 1e-4) {
        const scale = Math.min(12, 0.55 / peak);
        for (let i = 0; i < this.recordBuf.length; i++) this.recordBuf[i] *= scale;
      }
      this.isRecordingClip = false;
      this.hasRecordedClip = true;
      this.recordingProgress = 1;
      this.setPlayRecordedClip(true, true);
    } else if (this.recordingProgress - this.recordNotified >= 0.02) {
      // About fifty progress updates a clip, not one per audio block.
      this.recordNotified = this.recordingProgress;
      this.onRecordingStateChange?.();
    }
  }

  /** Play back the recorded 3-second voice clip in a continuous loop (and through speakers so the user hears it). */
  setPlayRecordedClip(play: boolean, audible = true): void {
    if (!this.hasRecordedClip || this.recordBuf.length === 0) return;
    this.isRecordingClip = false;
    this.playingRecordedClip = play;
    if (play && this.ctx && this.analyser && this.out) {
      // Disconnect live mic from analyser while playing back the recorded clip
      try {
        this.inGain?.disconnect(this.analyser);
      } catch {
        /* already disconnected */
      }
      this.out.gain.value = audible ? this.volume : 0;
      this.playBufferLoop(this.recordBuf);
    } else {
      this.stopRecordedPlayback();
    }
    this.onRecordingStateChange?.();
  }

  stopRecordedPlayback(): void {
    this.playingRecordedClip = false;
    this.voice?.src.stop();
    this.voice = null;
    if (this.mode === "mic" && this.inGain && this.analyser) {
      try {
        this.inGain.connect(this.analyser);
      } catch {
        /* already connected */
      }
    }
  }

  /** Back to the silent voice. */
  stop(): void {
    this.release();
    this.mode = "silent";
    this.deviceLabel = null;
    this.isRecordingClip = false;
    this.playingRecordedClip = false;
    this.hasRecordedClip = false;
    this.recordBuf = new Float32Array(0);
    this.recordingProgress = 0;
    this.useRate(SILENT_RATE);
    this.onRecordingStateChange?.();
  }

  private release(): void {
    this.closeTap();
    this.tapModule = null;
    this.voice?.src.stop();
    this.voice = null;
    this.streamSource?.disconnect();
    this.streamSource = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    this.inGain = null;
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
    if (s.wave !== "voice") {
      this.loop = generateSignal({ wave: s.wave, hz: s.waveHz, sampleRate: this.analyzer.sampleRate, seed: 7 });
      return;
    }
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
    this.playBufferLoop(this.loop);
  }

  private playBufferLoop(buf: Float32Array<ArrayBuffer>): void {
    const { ctx, analyser, out } = this;
    if (!ctx || !analyser || !out || buf.length === 0) return;
    const buffer = ctx.createBuffer(1, buf.length, ctx.sampleRate);
    buffer.copyToChannel(buf, 0);
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
    const { raw, analyser, ctx } = this;
    if (this.mode !== "silent" && analyser) {
      if (ctx && ctx.state === "suspended") void ctx.resume();
      analyser.getFloatTimeDomainData(raw);

      // Automatic software leveler for live microphone so quiet laptop mics work out of the box
      if (this.mode === "mic" && !this.playingRecordedClip) {
        let peak = 0;
        for (let k = 0; k < raw.length; k++) {
          const a = raw[k] < 0 ? -raw[k] : raw[k];
          if (a > peak) peak = a;
        }
        const targetGain = peak > 0.0012 ? Math.min(10, Math.max(1, 0.35 / peak)) : 1;
        this.autoGain += (targetGain - this.autoGain) * 0.25;
        if (this.autoGain > 1.02) {
          for (let k = 0; k < raw.length; k++) raw[k] *= this.autoGain;
        }
      }
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
