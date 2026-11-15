import { chladniModes, type Modes } from "@/lib/chladni";
import { findVowel, LOCK_SCORE, VOWEL_TARGETS, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { getWindow } from "@/lib/dsp/windows";
import { THEME_EVENT } from "@/lib/theme";
import type { DSPFrameTelemetry } from "@/types/dsp";

/**
 * Every trace of the instrument is one of these functions: telemetry in, pixels out.
 * They run once per animation frame, so nothing here allocates: labels are constants
 * and every changing number is shown in the DOM by <Readout>, not painted.
 */

/** The canvas palette. It mirrors the CSS tokens and follows the theme: see syncInk(). */
export const INK = {
  bg: "#0a0a0b",
  surface: "#141416",
  line: "#2c2c33",
  grid: "#1c1c21",
  ink: "#f7f4ec",
  inkSoft: "rgba(247, 244, 236, 0.5)",
  inkFaint: "rgba(247, 244, 236, 0.22)",
  muted: "#9c9ca8",
  mutedSoft: "rgba(156, 156, 168, 0.4)",
  accent: "#ff4d00",
  accentSoft: "rgba(255, 77, 0, 0.4)",
  lpc: "#1fdcff",
  lpcSoft: "rgba(31, 220, 255, 0.38)",
  lock: "#19c98c",
  lockSoft: "rgba(25, 201, 140, 0.16)",
};

function soft(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Re-read the palette from the page's CSS tokens. Canvases redraw every frame, so they follow at once. */
export function syncInk(): void {
  if (typeof document === "undefined") return;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  INK.bg = read("--bg", INK.bg);
  INK.surface = read("--surface", INK.surface);
  INK.line = read("--line", INK.line);
  INK.grid = read("--grid", INK.grid);
  INK.ink = read("--ink", INK.ink);
  INK.muted = read("--muted", INK.muted);
  INK.accent = read("--accent", INK.accent);
  INK.lpc = read("--lpc", INK.lpc);
  INK.lock = read("--lock", INK.lock);
  INK.inkSoft = soft(INK.ink, 0.5);
  INK.inkFaint = soft(INK.ink, 0.22);
  INK.mutedSoft = soft(INK.muted, 0.4);
  INK.accentSoft = soft(INK.accent, 0.4);
  INK.lpcSoft = soft(INK.lpc, 0.38);
  INK.lockSoft = soft(INK.lock, 0.16);
}

if (typeof window !== "undefined") {
  syncInk();
  window.addEventListener(THEME_EVENT, syncInk);
}

export type TraceKind =
  | "mini"
  | "voice"
  | "samples"
  | "rawDecimated"
  | "preEmphasized"
  | "windowed"
  | "window"
  | "scope"
  | "pitch"
  | "nsdf"
  | "fft"
  | "fftHarmonics"
  | "lpc"
  | "lpcCoeffs"
  | "formants"
  | "spectrum"
  | "zplane"
  | "vowel"
  | "spectrogram"
  | "pitchTrack"
  | "figure";

export interface TrailView {
  f1: Float32Array;
  f2: Float32Array;
  head: number;
  count: number;
}

export interface DrawState {
  w: number;
  h: number;
  /** Axis text, in the text face. */
  font: string;
  fontStrong: string;
  fontGlyph: string;
  /** Pointer in CSS pixels, or -1 when it is outside. */
  px: number;
  py: number;
  targetId: string;
  /** No axes or labels: for small fragments. */
  bare: boolean;
  /** Slowly decaying amplitude peak, so the vertical scale does not twitch. */
  peak: number;
  modes: Modes;
  trail: TrailView | null;
  /** Optional frozen baseline telemetry for side-by-side BEFORE vs AFTER overlay. */
  baseline: DSPFrameTelemetry | null;
  /** When true, upper-half-plane F1 and F2 poles render with draggable handles. */
  draggablePoles: boolean;
  /** Currently focused pole for keyboard nudging (1 = F1, 2 = F2). */
  selectedPoleFormant: 1 | 2;
  /** Filled by the draw function while the pointer is over the plot. */
  hover: string;
  /** Spectrogram: its own scrolling bitmap, one reusable column and a colour table for the theme. */
  gram: HTMLCanvasElement | null;
  gramCtx: CanvasRenderingContext2D | null;
  gramCol: ImageData | null;
  lut: Uint8ClampedArray;
  lutKey: string;
  /** Timestamp of the last frame added, so a frozen frame is not painted twice. */
  gramStamp: number;
  /** Pitch track: the last few seconds of F0, 0 where unvoiced. */
  track: Float32Array;
  trackHead: number;
  trackStamp: number;
}

/** Frames kept by the pitch track: about four seconds at sixty a second. */
const TRACK_POINTS = 240;

export function createDrawState(): DrawState {
  return {
    w: 300,
    h: 150,
    font: "11px sans-serif",
    fontStrong: "600 11px sans-serif",
    fontGlyph: "500 15px sans-serif",
    px: -1,
    py: -1,
    targetId: "aa",
    bare: false,
    peak: 0.05,
    modes: { m: 2.8, n: 5.6 },
    trail: null,
    baseline: null,
    draggablePoles: false,
    selectedPoleFormant: 1,
    hover: "",
    gram: null,
    gramCtx: null,
    gramCol: null,
    lut: new Uint8ClampedArray(257 * 3),
    lutKey: "",
    gramStamp: -1,
    track: new Float32Array(TRACK_POINTS),
    trackHead: 0,
    trackStamp: -1,
  };
}

type Ctx = CanvasRenderingContext2D;
type DrawFn = (ctx: Ctx, s: DrawState, t: DSPFrameTelemetry) => void;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function followPeak(s: DrawState, x: Float32Array): number {
  let max = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] < 0 ? -x[i] : x[i];
    if (a > max) max = a;
  }
  const decay = max < s.peak * 0.25 ? 0.88 : 0.96;
  s.peak = Math.max(max, s.peak * decay, 1.5e-3);
  return s.peak;
}

/** Samples in one pitch period, or 0 when the frame is unvoiced. */
function periodOf(t: DSPFrameTelemetry): number {
  return t.voiced && t.stability.f0Hz > 0 ? t.analysisRate / t.stability.f0Hz : 0;
}

/** Start drawing at the largest peak of the first period, so a periodic wave stands still. */
function triggerIndex(x: Float32Array, period: number, room: number): number {
  if (period <= 0) return 0;
  const span = Math.min(Math.ceil(period), x.length - room);
  let best = 0;
  let max = -Infinity;
  for (let i = 0; i < span; i++) {
    if (x[i] > max) {
      max = x[i];
      best = i;
    }
  }
  return best;
}

function wave(ctx: Ctx, x: Float32Array, from: number, count: number, x0: number, w: number, mid: number, gain: number) {
  ctx.beginPath();
  const step = w / (count - 1);
  for (let i = 0; i < count; i++) {
    const y = mid - x[from + i] * gain;
    if (i === 0) ctx.moveTo(x0, y);
    else ctx.lineTo(x0 + i * step, y);
  }
  ctx.stroke();
}

function baseline(ctx: Ctx, x0: number, w: number, y: number) {
  ctx.strokeStyle = INK.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(y) + 0.5);
  ctx.lineTo(x0 + w, Math.round(y) + 0.5);
  ctx.stroke();
}

/* ── Time domain ──────────────────────────────────────────────────── */

const drawMini: DrawFn = (ctx, s, t) => {
  const x = t.timeDomainRaw;
  const from = triggerIndex(x, periodOf(t), 256);
  const gain = (s.h * 0.44) / followPeak(s, x);
  ctx.strokeStyle = t.voiced ? INK.ink : INK.muted;
  ctx.lineWidth = 1.25;
  wave(ctx, x, from, 256, 0, s.w, s.h / 2, gain);
};

const drawVoice: DrawFn = (ctx, s, t) => {
  const x = t.timeDomainRaw;
  const count = 384;
  const from = triggerIndex(x, periodOf(t), count);
  const mid = s.h / 2;
  const gain = (s.h * 0.42) / followPeak(s, x);
  baseline(ctx, 0, s.w, mid);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  wave(ctx, x, from, count, 0, s.w, mid, gain);
};

const drawSamples: DrawFn = (ctx, s, t) => {
  const x = t.stageBuffers.rawDecimated.length ? t.stageBuffers.rawDecimated : t.timeDomainRaw;
  const count = Math.max(24, Math.min(96, Math.floor(s.w / 7)));
  const from = triggerIndex(x, periodOf(t), count);
  const mid = s.h / 2;
  const gain = (s.h * 0.42) / followPeak(s, x);
  const step = s.w / count;
  baseline(ctx, 0, s.w, mid);
  ctx.strokeStyle = INK.inkSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const px = Math.round(step * (i + 0.5)) + 0.5;
    ctx.moveTo(px, mid);
    ctx.lineTo(px, mid - x[from + i] * gain);
  }
  ctx.stroke();
  ctx.fillStyle = INK.ink;
  for (let i = 0; i < count; i++) {
    const px = Math.round(step * (i + 0.5));
    ctx.fillRect(px - 1.5, mid - x[from + i] * gain - 1.5, 4, 4);
  }
};

/** Stage 2 input: 512 decimated samples before DC removal and pre-emphasis. */
const drawRawDecimated: DrawFn = (ctx, s, t) => {
  const x = t.stageBuffers.rawDecimated;
  const n = x.length;
  const padL = s.bare ? 0 : 8;
  const w = s.w - padL * 2;
  const mid = s.h / 2;
  const gain = (s.h * 0.42) / followPeak(s, x);
  baseline(ctx, padL, w, mid);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  wave(ctx, x, 0, n, padL, w, mid, gain);
  if (s.px >= padL && s.px <= padL + w && s.py >= 0) {
    const idx = Math.min(n - 1, Math.max(0, Math.round(((s.px - padL) / w) * (n - 1))));
    s.hover = `n = ${idx} · x[n] = ${x[idx].toFixed(4)}`;
  } else {
    s.hover = "";
  }
};

/** Stage 2 output / Stage 3 input: pre-emphasized y[n] = x[n] − α·x[n−1] over faint rawDecimated. */
const drawPreEmphasized: DrawFn = (ctx, s, t) => {
  const raw = t.stageBuffers.rawDecimated;
  const pre = t.stageBuffers.preEmphasized;
  const n = pre.length;
  const padL = s.bare ? 0 : 8;
  const w = s.w - padL * 2;
  const mid = s.h / 2;
  const gain = (s.h * 0.42) / followPeak(s, raw);
  baseline(ctx, padL, w, mid);
  ctx.strokeStyle = INK.inkFaint;
  ctx.lineWidth = 1;
  wave(ctx, raw, 0, n, padL, w, mid, gain);
  ctx.strokeStyle = INK.lpc;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  wave(ctx, pre, 0, n, padL, w, mid, gain);
  if (s.px >= padL && s.px <= padL + w && s.py >= 0) {
    const idx = Math.min(n - 1, Math.max(0, Math.round(((s.px - padL) / w) * (n - 1))));
    s.hover = `n = ${idx} · x[n] = ${raw[idx].toFixed(4)} → y[n] = ${pre[idx].toFixed(4)}`;
  } else {
    s.hover = "";
  }
};

/** Stage 3 output / Stage 4 input: windowed xw[n] = y[n]·w[n] with active w[n] envelope. */
const drawWindowed: DrawFn = (ctx, s, t) => {
  const pre = t.stageBuffers.preEmphasized;
  const win = t.stageBuffers.windowed;
  const weights = t.stageBuffers.windowWeights;
  const n = win.length;
  const padL = s.bare ? 0 : 8;
  const w = s.w - padL * 2;
  const mid = s.h / 2;
  const amp = s.h * 0.42;
  const gain = amp / followPeak(s, pre);
  baseline(ctx, padL, w, mid);

  const table = weights.length === n ? weights : getWindow(t.windowType, n).w;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = INK.mutedSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i += 4) {
    const px = padL + (i / (n - 1)) * w;
    if (i === 0) ctx.moveTo(px, mid - table[i] * amp);
    else ctx.lineTo(px, mid - table[i] * amp);
  }
  for (let i = n - 1; i >= 0; i -= 4) ctx.lineTo(padL + (i / (n - 1)) * w, mid + table[i] * amp);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = INK.inkFaint;
  ctx.lineWidth = 1;
  wave(ctx, pre, 0, n, padL, w, mid, gain);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  wave(ctx, win, 0, n, padL, w, mid, gain);
  if (s.px >= padL && s.px <= padL + w && s.py >= 0) {
    const idx = Math.min(n - 1, Math.max(0, Math.round(((s.px - padL) / w) * (n - 1))));
    s.hover = `n = ${idx} · w[n] = ${table[idx].toFixed(3)} · xw[n] = ${win[idx].toFixed(4)}`;
  } else {
    s.hover = "";
  }
};

/** x[n] under x[n]·w[n], with the window itself as a dashed envelope. */
const drawScope: DrawFn = (ctx, s, t) => {
  const raw = t.timeDomainRaw;
  const win = t.timeDomainWindowed;
  const n = raw.length;
  const padL = s.bare ? 0 : 8;
  const w = s.w - padL * 2;
  const mid = s.h / 2;
  const amp = s.h * 0.42;
  const gain = amp / followPeak(s, raw);
  baseline(ctx, padL, w, mid);

  const table = getWindow(t.windowType, n).w;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = INK.mutedSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i += 4) {
    const px = padL + (i / (n - 1)) * w;
    if (i === 0) ctx.moveTo(px, mid - table[i] * amp);
    else ctx.lineTo(px, mid - table[i] * amp);
  }
  for (let i = n - 1; i >= 0; i -= 4) ctx.lineTo(padL + (i / (n - 1)) * w, mid + table[i] * amp);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = INK.inkFaint;
  ctx.lineWidth = 1;
  wave(ctx, raw, 0, n, padL, w, mid, gain);
  if (s.baseline && s.baseline !== t) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = INK.accentSoft;
    ctx.lineWidth = 1.25;
    wave(ctx, s.baseline.timeDomainWindowed, 0, n, padL, w, mid, gain);
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  wave(ctx, win, 0, n, padL, w, mid, gain);
};

/** The wave with a mark at every period the pitch detector found. */
const drawPitch: DrawFn = (ctx, s, t) => {
  const x = t.timeDomainRaw;
  const count = 384;
  const period = periodOf(t);
  const from = triggerIndex(x, period, count);
  const mid = s.h * 0.54;
  const gain = (s.h * 0.36) / followPeak(s, x);
  baseline(ctx, 0, s.w, mid);
  ctx.strokeStyle = INK.inkSoft;
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  wave(ctx, x, from, count, 0, s.w, mid, gain);
  if (period <= 0) return;
  const pxPerSample = s.w / (count - 1);
  ctx.strokeStyle = INK.accent;
  ctx.fillStyle = INK.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k * period < count; k++) {
    const px = Math.round(k * period * pxPerSample) + 0.5;
    ctx.moveTo(px, 10);
    ctx.lineTo(px, s.h);
  }
  ctx.stroke();
  // One period, bracketed.
  const p1 = period * pxPerSample;
  ctx.fillRect(0, 9, p1, 2);
  if (!s.bare) {
    ctx.font = s.fontStrong;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("T0", 6, 16);
  }
};

/** Stage 5 output: McLeod Pitch Method NSDF curve n(τ) across lags τ = 0..255. */
const drawNsdf: DrawFn = (ctx, s, t) => {
  const nsdf = t.stageBuffers.nsdfCurve;
  const lags = nsdf.length;
  const padL = s.bare ? 0 : 32;
  const padR = s.bare ? 0 : 10;
  const padT = s.bare ? 6 : 14;
  const padB = s.bare ? 6 : 22;
  const w = s.w - padL - padR;
  const h = s.h - padT - padB;
  const mid = padT + h / 2;
  const amp = h * 0.45;

  baseline(ctx, padL, w, mid);
  if (!s.bare) {
    ctx.font = s.font;
    ctx.fillStyle = INK.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("+1.0", padL - 6, mid - amp);
    ctx.fillText("0.0", padL - 6, mid);
    ctx.fillText("−1.0", padL - 6, mid + amp);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("τ = 0", padL, padT + h + 6);
    ctx.textAlign = "center";
    ctx.fillText("128", padL + w * 0.5, padT + h + 6);
    ctx.textAlign = "right";
    ctx.fillText("255 samples", padL + w, padT + h + 6);
  }

  ctx.strokeStyle = INK.lpc;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let tau = 0; tau < lags; tau++) {
    const px = padL + (tau / (lags - 1)) * w;
    const py = mid - Math.max(-1, Math.min(1, nsdf[tau])) * amp;
    if (tau === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  const peakTau = t.stageBuffers.peakLagTau;
  if (peakTau > 0 && peakTau < lags) {
    const px = padL + (peakTau / (lags - 1)) * w;
    const tauIdx = Math.min(lags - 1, Math.round(peakTau));
    const py = mid - Math.max(-1, Math.min(1, nsdf[tauIdx])) * amp;
    ctx.strokeStyle = INK.accent;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, padT);
    ctx.lineTo(Math.round(px) + 0.5, padT + h);
    ctx.stroke();
    ctx.fillStyle = INK.accent;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    if (!s.bare) {
      ctx.font = s.fontStrong;
      ctx.textAlign = px > padL + w * 0.65 ? "right" : "left";
      ctx.textBaseline = "top";
      const labelX = px > padL + w * 0.65 ? px - 6 : px + 6;
      ctx.fillText(`τ = ${peakTau.toFixed(1)} → ${Math.round(t.stability.f0Hz)} Hz`, labelX, padT + 2);
    }
  }

  if (s.px >= padL && s.px <= padL + w && s.py >= 0) {
    const tau = Math.min(lags - 1, Math.max(0, Math.round(((s.px - padL) / w) * (lags - 1))));
    const hz = tau > 0 ? Math.round(t.analysisRate / tau) : 0;
    s.hover = `τ = ${tau} samples · NSDF ${nsdf[tau].toFixed(3)}${hz > 0 ? ` · ${hz} Hz` : ""}`;
  } else {
    s.hover = "";
  }
};

/* ── Frequency domain ─────────────────────────────────────────────── */

const MIN_DB = -100;
const MAX_DB = 6;
const DB_TICKS = [0, -20, -40, -60, -80] as const;
const DB_LABELS = ["0", "−20", "−40", "−60", "−80"] as const;
const KHZ_LABELS = ["0", "1 kHz", "2", "3", "4", "5", "6"] as const;
const F_LABELS = ["", "F1", "F2", "F3"] as const;

function spectrum(ctx: Ctx, s: DrawState, t: DSPFrameTelemetry, fft: boolean, lpc: boolean, formants: boolean) {
  const padL = s.bare ? 0 : 36;
  const padR = s.bare ? 0 : 8;
  const padT = s.bare ? 4 : 10;
  const padB = s.bare ? 0 : 22;
  const w = s.w - padL - padR;
  const h = s.h - padT - padB;
  const nyquist = t.analysisRate / 2;
  const bins = t.fftMagnitudeDb.length;
  const yScale = h / (MAX_DB - MIN_DB);

  ctx.lineWidth = 1;
  if (!s.bare) {
    ctx.font = s.font;
    ctx.fillStyle = INK.muted;
    ctx.strokeStyle = INK.grid;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    for (let i = 0; i < DB_TICKS.length; i++) {
      const y = Math.round(padT + (MAX_DB - DB_TICKS[i]) * yScale) + 0.5;
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.fillText(DB_LABELS[i], padL - 8, y);
    }
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let k = 0; k * 1000 < nyquist && k < KHZ_LABELS.length; k++) {
      ctx.fillText(KHZ_LABELS[k], padL + ((k * 1000) / nyquist) * w + (k === 0 ? 0 : -3), padT + h + 7);
    }
    // Reference formants of the chosen vowel: ticks on the top edge, never on the data.
    const target = findVowel(s.targetId);
    ctx.fillStyle = INK.muted;
    ctx.fillRect(padL + (target.targetF1 / nyquist) * w - 1, padT - 6, 2, 6);
    ctx.fillRect(padL + (target.targetF2 / nyquist) * w - 1, padT - 6, 2, 6);
    ctx.fillRect(padL + (target.targetF3 / nyquist) * w - 1, padT - 6, 2, 6);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, w, h);
  ctx.clip();

  if (s.baseline && s.baseline !== t) {
    ctx.setLineDash([4, 4]);
    if (fft) {
      ctx.strokeStyle = INK.mutedSoft;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const baseFft = s.baseline.fftMagnitudeDb;
      for (let b = 0; b < bins; b++) {
        const y = padT + (MAX_DB - baseFft[b]) * yScale;
        if (b === 0) ctx.moveTo(padL, y);
        else ctx.lineTo(padL + (b / (bins - 1)) * w, y);
      }
      ctx.stroke();
    }
    if (lpc) {
      ctx.strokeStyle = INK.lpcSoft;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const baseLpc = s.baseline.lpcEnvelopeDb;
      for (let b = 0; b < bins; b++) {
        const y = padT + (MAX_DB - baseLpc[b]) * yScale;
        if (b === 0) ctx.moveTo(padL, y);
        else ctx.lineTo(padL + (b / (bins - 1)) * w, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (fft) {
    ctx.strokeStyle = lpc ? INK.inkSoft : INK.ink;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    const mag = t.fftMagnitudeDb;
    for (let b = 0; b < bins; b++) {
      const y = padT + (MAX_DB - mag[b]) * yScale;
      if (b === 0) ctx.moveTo(padL, y);
      else ctx.lineTo(padL + (b / (bins - 1)) * w, y);
    }
    ctx.stroke();
  }

  if (lpc) {
    ctx.strokeStyle = INK.lpc;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    const env = t.lpcEnvelopeDb;
    for (let b = 0; b < bins; b++) {
      const y = padT + (MAX_DB - env[b]) * yScale;
      if (b === 0) ctx.moveTo(padL, y);
      else ctx.lineTo(padL + (b / (bins - 1)) * w, y);
    }
    ctx.stroke();
  }

  if (formants && t.formants.confidence > 0.05) {
    const f = t.formants;
    ctx.font = s.fontStrong;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let i = 1; i <= 3; i++) {
      const hz = i === 1 ? f.f1 : i === 2 ? f.f2 : f.f3;
      const bw = i === 1 ? f.b1 : i === 2 ? f.b2 : f.b3;
      if (hz <= 0 || hz >= nyquist) continue;
      const fx = padL + (hz / nyquist) * w;
      const bin = Math.min(bins - 1, Math.round((hz / nyquist) * (bins - 1)));
      const fy = padT + (MAX_DB - t.lpcEnvelopeDb[bin]) * yScale;
      ctx.strokeStyle = INK.accentSoft;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(fx) + 0.5, padT + h);
      ctx.lineTo(Math.round(fx) + 0.5, fy);
      ctx.stroke();
      ctx.fillStyle = INK.accent;
      // The bandwidth, to scale, 3 dB below the peak.
      const half = Math.max(2, ((bw / nyquist) * w) / 2);
      ctx.fillRect(fx - half, fy + 3 * yScale, half * 2, 2);
      ctx.beginPath();
      ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(F_LABELS[i], fx, Math.max(padT + 14, fy - 7));
    }
  }
  ctx.restore();

  if (s.px >= padL && s.px <= padL + w && s.py >= 0) {
    const u = (s.px - padL) / w;
    const bin = Math.min(bins - 1, Math.round(u * (bins - 1)));
    ctx.strokeStyle = INK.inkFaint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(s.px) + 0.5, padT);
    ctx.lineTo(Math.round(s.px) + 0.5, padT + h);
    ctx.stroke();
    s.hover = `${Math.round(u * nyquist)} Hz · FFT ${t.fftMagnitudeDb[bin].toFixed(1)} dB · LPC ${t.lpcEnvelopeDb[bin].toFixed(1)} dB`;
  } else {
    s.hover = "";
  }
}

const HARMONIC_LABELS = ["", "▲ F0", "▲ 2·F0", "▲ 3·F0", "▲ 4·F0"] as const;

/** Stage 4 output: 1024-pt FFT magnitude spectrum with harmonic peak markers (F0, 2·F0, 3·F0, 4·F0). */
const drawFftHarmonics: DrawFn = (ctx, s, t) => {
  spectrum(ctx, s, t, true, false, false);
  const f0 = t.stability.f0Hz;
  if (!t.voiced || f0 <= 0) return;

  const padL = s.bare ? 0 : 36;
  const padR = s.bare ? 0 : 8;
  const padT = s.bare ? 4 : 10;
  const padB = s.bare ? 0 : 22;
  const w = s.w - padL - padR;
  const h = s.h - padT - padB;
  const nyquist = t.analysisRate / 2;
  const bins = t.fftMagnitudeDb.length;
  const yScale = h / (MAX_DB - MIN_DB);

  ctx.save();
  ctx.font = s.fontStrong;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = INK.accent;
  ctx.strokeStyle = INK.accentSoft;
  ctx.lineWidth = 1;

  for (let k = 1; k <= 4; k++) {
    const targetHz = k * f0;
    if (targetHz >= nyquist) break;
    const centerBin = Math.round((targetHz / nyquist) * (bins - 1));
    let bestBin = centerBin;
    let bestDb = -Infinity;
    const lo = Math.max(1, centerBin - 3);
    const hi = Math.min(bins - 1, centerBin + 3);
    for (let b = lo; b <= hi; b++) {
      if (t.fftMagnitudeDb[b] > bestDb) {
        bestDb = t.fftMagnitudeDb[b];
        bestBin = b;
      }
    }
    const hx = padL + (bestBin / (bins - 1)) * w;
    const hy = Math.max(padT + 14, padT + (MAX_DB - bestDb) * yScale);
    ctx.beginPath();
    ctx.moveTo(Math.round(hx) + 0.5, padT + h);
    ctx.lineTo(Math.round(hx) + 0.5, hy);
    ctx.stroke();
    ctx.fillText(HARMONIC_LABELS[k], hx, hy - 3);
  }
  ctx.restore();
};

/** Stage 7 input: LPC predictor coefficients a[1..p] and normalized autocorrelation lags R[1..p]/R[0]. */
const drawLpcCoeffs: DrawFn = (ctx, s, t) => {
  const a = t.stageBuffers.lpcCoeffs;
  const r = t.stageBuffers.autocorrCoeffs;
  const p = a.length;
  const padL = s.bare ? 12 : 34;
  const padR = s.bare ? 12 : 14;
  const padT = s.bare ? 10 : 16;
  const padB = s.bare ? 10 : 24;
  const w = s.w - padL - padR;
  const h = s.h - padT - padB;
  const mid = padT + h / 2;

  let maxAbs = 1;
  for (let i = 0; i < p; i++) {
    const abs = Math.abs(a[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  const scale = (h * 0.44) / maxAbs;

  baseline(ctx, padL, w, mid);
  if (!s.bare) {
    ctx.font = s.font;
    ctx.fillStyle = INK.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${maxAbs.toFixed(1)}`, padL - 6, padT + h * 0.06);
    ctx.fillText("0", padL - 6, mid);
    ctx.fillText(`−${maxAbs.toFixed(1)}`, padL - 6, padT + h * 0.94);
  }

  if (p === 0) return;
  const step = w / p;
  const r0 = r.length > 0 && r[0] > 0 ? r[0] : 1;

  for (let k = 0; k < p; k++) {
    const cx = padL + step * (k + 0.5);
    // Autocorrelation stem R[k+1]/R[0] in muted ink
    if (k + 1 < r.length) {
      const rNorm = r[k + 1] / r0;
      const ry = mid - rNorm * (h * 0.42);
      ctx.strokeStyle = INK.inkFaint;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx - 3) + 0.5, mid);
      ctx.lineTo(Math.round(cx - 3) + 0.5, ry);
      ctx.stroke();
    }
    // Predictor stem a[k+1] in cyan LPC ink
    const ay = mid - a[k] * scale;
    ctx.strokeStyle = INK.lpc;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx + 2) + 0.5, mid);
    ctx.lineTo(Math.round(cx + 2) + 0.5, ay);
    ctx.stroke();
    ctx.fillStyle = INK.lpc;
    ctx.fillRect(Math.round(cx + 2) - 2, ay - 2, 5, 5);

    if (!s.bare && (p <= 14 || k % 2 === 0)) {
      ctx.fillStyle = INK.muted;
      ctx.font = s.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`a${k + 1}`, cx, padT + h + 6);
    }
  }

  if (s.px >= padL && s.px <= padL + w && s.py >= 0) {
    const idx = Math.min(p - 1, Math.max(0, Math.floor(((s.px - padL) / w) * p)));
    const rNorm = idx + 1 < r.length ? (r[idx + 1] / r0).toFixed(3) : "—";
    s.hover = `k = ${idx + 1} · a[${idx + 1}] = ${a[idx].toFixed(4)} · R[${idx + 1}]/R[0] = ${rNorm}`;
  } else {
    s.hover = "";
  }
};

const drawFft: DrawFn = (ctx, s, t) => spectrum(ctx, s, t, true, false, false);
const drawLpc: DrawFn = (ctx, s, t) => spectrum(ctx, s, t, true, true, false);
const drawFormants: DrawFn = (ctx, s, t) => spectrum(ctx, s, t, false, true, true);
const drawSpectrum: DrawFn = (ctx, s, t) => spectrum(ctx, s, t, true, true, true);

/* ── Z-plane ──────────────────────────────────────────────────────── */

const SPOKE_LABELS = ["", "1 kHz", "2", "3", "4", "5"] as const;

const drawZPlane: DrawFn = (ctx, s, t) => {
  const cx = s.w / 2;
  const cy = s.h / 2;
  const r = Math.min(s.w, s.h) * (s.bare ? 0.44 : 0.38);
  const nyquist = t.analysisRate / 2;

  ctx.lineWidth = 1;
  ctx.strokeStyle = INK.grid;
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.16, Math.round(cy) + 0.5);
  ctx.lineTo(cx + r * 1.16, Math.round(cy) + 0.5);
  ctx.moveTo(Math.round(cx) + 0.5, cy - r * 1.16);
  ctx.lineTo(Math.round(cx) + 0.5, cy + r * 1.16);
  for (let k = 1; k * 1000 < nyquist; k++) {
    const th = (2 * Math.PI * k * 1000) / t.analysisRate;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(th) * r, cy - Math.sin(th) * r);
  }
  ctx.stroke();

  if (!s.bare) {
    ctx.font = s.font;
    ctx.fillStyle = INK.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 1; k * 1000 < nyquist && k < SPOKE_LABELS.length; k++) {
      const th = (2 * Math.PI * k * 1000) / t.analysisRate;
      ctx.fillText(SPOKE_LABELS[k], cx + Math.cos(th) * (r + 18), cy - Math.sin(th) * (r + 14));
    }
    ctx.fillText("0", cx + r + 12, cy - 9);
    // A resonance 300 Hz wide sits on this ring: r = exp(−πB / fs).
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = INK.mutedSoft;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.exp((-Math.PI * 300) / t.analysisRate) * r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = INK.inkSoft;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  if (s.baseline && s.baseline !== t) {
    const basePoles = s.baseline.zPlanePoles;
    ctx.strokeStyle = INK.inkFaint;
    ctx.lineWidth = 1;
    for (let i = 0; i < basePoles.length; i++) {
      const bp = basePoles[i];
      if (bp.magnitude === 0) continue;
      ctx.beginPath();
      ctx.arc(cx + bp.re * r, cy - bp.im * r, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const poles = t.zPlanePoles;
  let nearest = -1;
  let nearestD = 16;
  for (let i = 0; i < poles.length; i++) {
    const p = poles[i];
    if (p.magnitude === 0) continue;
    const px = cx + p.re * r;
    const py = cy - p.im * r;
    if (s.px >= 0) {
      const d = Math.hypot(s.px - px, s.py - py);
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
    }
    const isFormant = p.formantIndex > 0;
    const upper = p.im >= 0;
    const isDraggablePole = s.draggablePoles && upper && (p.formantIndex === 1 || p.formantIndex === 2);
    if (isFormant && upper) {
      ctx.strokeStyle = INK.accentSoft;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    if (isDraggablePole) {
      const isSelected = p.formantIndex === s.selectedPoleFormant;
      ctx.strokeStyle = isSelected ? INK.lpc : INK.accentSoft;
      ctx.lineWidth = isSelected ? 1.75 : 1.25;
      ctx.beginPath();
      ctx.arc(px, py, isSelected ? 11 : 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = INK.accent;
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const z = isFormant ? 5 : 3.5;
      ctx.strokeStyle = isFormant ? (upper ? INK.accent : INK.accentSoft) : INK.muted;
      ctx.lineWidth = isFormant ? 2 : 1.25;
      ctx.beginPath();
      ctx.moveTo(px - z, py - z);
      ctx.lineTo(px + z, py + z);
      ctx.moveTo(px - z, py + z);
      ctx.lineTo(px + z, py - z);
      ctx.stroke();
    }
    if (isFormant && upper) {
      ctx.fillStyle = isDraggablePole && p.formantIndex === s.selectedPoleFormant ? INK.lpc : INK.accent;
      ctx.font = s.fontStrong;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        isDraggablePole ? `${F_LABELS[p.formantIndex]} ✥` : F_LABELS[p.formantIndex],
        px + (isDraggablePole ? 12 : 8),
        py - 4,
      );
    }
  }

  if (nearest >= 0) {
    const p = poles[nearest];
    s.hover = `z = ${p.re.toFixed(3)} ${p.im < 0 ? "−" : "+"} ${Math.abs(p.im).toFixed(3)}j · |z| ${p.magnitude.toFixed(3)} · ${Math.round(p.freqHz)} Hz · B ${Math.round(p.bandwidthHz)} Hz`;
  } else {
    s.hover = "";
  }
};

/** Hit-test the upper-half-plane F1 or F2 pole on the Z-plane canvas. */
export function pickFormantPole(s: DrawState, x: number, y: number, t: DSPFrameTelemetry): 1 | 2 | null {
  const cx = s.w / 2;
  const cy = s.h / 2;
  const r = Math.min(s.w, s.h) * (s.bare ? 0.44 : 0.38);
  let best: 1 | 2 | null = null;
  let bestD = 32;
  for (const p of t.zPlanePoles) {
    if (p.im < 0 || (p.formantIndex !== 1 && p.formantIndex !== 2)) continue;
    const px = cx + p.re * r;
    const py = cy - p.im * r;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      best = p.formantIndex as 1 | 2;
    }
  }
  return best;
}

/** Convert pointer (x, y) in CSS pixels on the Z-plane canvas into unit-circle (re, im). */
export function pointerToPole(s: DrawState, x: number, y: number): { re: number; im: number } {
  const cx = s.w / 2;
  const cy = s.h / 2;
  const r = Math.max(1, Math.min(s.w, s.h) * (s.bare ? 0.44 : 0.38));
  return {
    re: (x - cx) / r,
    im: Math.max(0.03, (cy - y) / r),
  };
}

/* ── Vowel space ──────────────────────────────────────────────────── */

export const VOWEL_AXES = { f1Min: 200, f1Max: 920, f2Min: 650, f2Max: 2550 } as const;
const F1_TICKS = [300, 500, 700, 900] as const;
const F1_TICK_LABELS = ["300", "500", "700", "900"] as const;
const F2_TICKS = [2400, 2000, 1600, 1200, 800] as const;
const F2_TICK_LABELS = ["2400", "2000", "1600", "1200", "800"] as const;
const GLYPHS = VOWEL_TARGETS.map(vowelGlyph);

const PAD_BARE = { l: 14, r: 14, t: 14, b: 14 };
const PAD_FULL = { l: 44, r: 20, t: 26, b: 30 };

// Plot box of the chart being drawn; module-level so the frame loop makes no closures.
let vx0 = 0;
let vy0 = 0;
let vw = 1;
let vh = 1;
// Phonetic convention: front vowels on the left (F2 falls to the right), open vowels at the bottom.
const xOf = (f2: number) => vx0 + (1 - clamp01((f2 - VOWEL_AXES.f2Min) / (VOWEL_AXES.f2Max - VOWEL_AXES.f2Min))) * vw;
const yOf = (f1: number) => vy0 + clamp01((f1 - VOWEL_AXES.f1Min) / (VOWEL_AXES.f1Max - VOWEL_AXES.f1Min)) * vh;

function setVowelBox(s: DrawState): void {
  const pad = s.bare ? PAD_BARE : PAD_FULL;
  vx0 = pad.l;
  vy0 = pad.t;
  vw = s.w - pad.l - pad.r;
  vh = s.h - pad.t - pad.b;
}

const drawVowel: DrawFn = (ctx, s, t) => {
  setVowelBox(s);
  const pad = s.bare ? PAD_BARE : PAD_FULL;
  const w = vw;
  const h = vh;
  const A = VOWEL_AXES;

  if (!s.bare) {
    ctx.font = s.font;
    ctx.fillStyle = INK.muted;
    ctx.strokeStyle = INK.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i < F1_TICKS.length; i++) {
      const y = Math.round(yOf(F1_TICKS[i])) + 0.5;
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.fillText(F1_TICK_LABELS[i], pad.l - 8, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < F2_TICKS.length; i++) {
      const x = Math.round(xOf(F2_TICKS[i])) + 0.5;
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
      ctx.fillText(F2_TICK_LABELS[i], x, pad.t + h + 8);
    }
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("F2, Hz", pad.l, 6);
    ctx.textAlign = "right";
    ctx.fillText("F1", pad.l - 8, 6);
  }

  const locked = t.formants.confidence > 0.05 && t.activeTargetMatch.convergenceScore >= LOCK_SCORE;

  for (let i = 0; i < VOWEL_TARGETS.length; i++) {
    const v = VOWEL_TARGETS[i];
    const vx = xOf(v.targetF2);
    const vy = yOf(v.targetF1);
    const selected = v.id === s.targetId;
    if (selected) {
      const rx = Math.max(15, (v.toleranceHz / (A.f2Max - A.f2Min)) * w * 1.3);
      const ry = Math.max(13, (v.toleranceHz / (A.f1Max - A.f1Min)) * h);
      ctx.beginPath();
      ctx.ellipse(vx, vy, rx, ry, 0, 0, Math.PI * 2);
      if (locked) {
        ctx.fillStyle = INK.lockSoft;
        ctx.fill();
      }
      ctx.strokeStyle = locked ? INK.lock : INK.ink;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
    ctx.fillStyle = selected ? INK.ink : INK.muted;
    ctx.font = s.fontGlyph;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(GLYPHS[i], vx, vy + 1);
  }

  // The comet: where (F1, F2) has just been, thinning with age.
  const trail = s.trail;
  if (trail && trail.count > 1) {
    const cap = trail.f1.length;
    const start = (trail.head - trail.count + cap) % cap;
    ctx.strokeStyle = INK.accent;
    ctx.lineCap = "round";
    for (let i = 1; i < trail.count; i++) {
      const a = (start + i - 1) % cap;
      const b = (start + i) % cap;
      const age = i / trail.count;
      ctx.globalAlpha = age * age * 0.8;
      ctx.lineWidth = 0.5 + age * 2.5;
      ctx.beginPath();
      ctx.moveTo(xOf(trail.f2[a]), yOf(trail.f1[a]));
      ctx.lineTo(xOf(trail.f2[b]), yOf(trail.f1[b]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  const hasBase = Boolean(
    s.baseline && s.baseline !== t && s.baseline.voiced && s.baseline.formants.f1 > 0 && s.baseline.formants.f2 > 0,
  );
  const bx = hasBase && s.baseline ? xOf(s.baseline.formants.f2) : 0;
  const by = hasBase && s.baseline ? yOf(s.baseline.formants.f1) : 0;

  if (hasBase) {
    ctx.strokeStyle = INK.lpc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.stroke();
    if (!s.bare) {
      ctx.font = s.fontStrong;
      ctx.fillStyle = INK.lpc;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("A", bx - 7, by - 4);
    }
  }

  if (t.voiced && t.formants.f1 > 0 && t.formants.f2 > 0) {
    const cx = xOf(t.formants.f2);
    const cy = yOf(t.formants.f1);
    if (hasBase) {
      const dx = cx - bx;
      const dy = cy - by;
      const dist = Math.hypot(dx, dy);
      if (dist > 7) {
        const ux = dx / dist;
        const uy = dy / dist;
        const sx = bx + ux * 6;
        const sy = by + uy * 6;
        const ex = cx - ux * 6;
        const ey = cy - uy * 6;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = INK.lpc;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);

        // Crisp arrowhead pointing from Reference A toward Active B
        const headLen = 7;
        const angle = Math.atan2(dy, dx);
        ctx.fillStyle = INK.lpc;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
    const target = findVowel(s.targetId);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = locked ? INK.lock : INK.inkSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(xOf(target.targetF2), yOf(target.targetF1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = locked ? INK.lock : INK.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    if (hasBase && !s.bare) {
      ctx.font = s.fontStrong;
      ctx.fillStyle = locked ? INK.lock : INK.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("B", cx + 7, cy - 4);
    }
  }
};

/** Which target, if any, is under a point of the vowel chart. */
export function pickVowel(s: DrawState, x: number, y: number): string | null {
  setVowelBox(s);
  let best: string | null = null;
  let bestD = 34;
  for (const v of VOWEL_TARGETS) {
    const d = Math.hypot(x - xOf(v.targetF2), y - yOf(v.targetF1));
    if (d < bestD) {
      bestD = d;
      best = v.id;
    }
  }
  return best;
}

/* ── The figure, as a dot matrix ──────────────────────────────────── */

const MAX_CELLS = 96;
const cosN = new Float32Array(MAX_CELLS);
const cosM = new Float32Array(MAX_CELLS);

/**
 * C(x, y) = cos(nπx) cos(mπy) − cos(mπx) cos(nπy) on a grid of dots; a dot is lit where the
 * plate would stay still. The cosines are separable, so a frame costs 2N of them, not N².
 */
export function paintDotFigure(ctx: Ctx, w: number, h: number, m: number, n: number, lit: string, dim: string | null) {
  const side = Math.min(w, h);
  const cells = Math.max(24, Math.min(MAX_CELLS, Math.floor(side / 6)));
  const pitch = side / cells;
  const x0 = (w - side) / 2;
  const y0 = (h - side) / 2;
  for (let i = 0; i < cells; i++) {
    const u = ((i + 0.5) / cells) * 2 - 1;
    cosN[i] = Math.cos(n * Math.PI * u);
    cosM[i] = Math.cos(m * Math.PI * u);
  }
  // A dot is lit when |C| is small against the local slope, which keeps the lines even in width.
  const slope = (n + m) * 0.9;
  const band = (2.2 / cells) * slope;
  const full = Math.max(1.5, pitch * 0.62);
  if (dim) {
    ctx.fillStyle = dim;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        ctx.fillRect(x0 + i * pitch + (pitch - 1) / 2, y0 + j * pitch + (pitch - 1) / 2, 1, 1);
      }
    }
  }
  ctx.fillStyle = lit;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const c = cosN[i] * cosM[j] - cosM[i] * cosN[j];
      const a = 1 - (c < 0 ? -c : c) / band;
      if (a <= 0.15) continue;
      const d = full * (a > 1 ? 1 : a);
      ctx.fillRect(x0 + i * pitch + (pitch - d) / 2, y0 + j * pitch + (pitch - d) / 2, d, d);
    }
  }
}

const targetModes: Modes = { m: 0, n: 0 };

const drawFigure: DrawFn = (ctx, s, t) => {
  if (t.voiced && t.formants.f1 > 0 && t.formants.f2 > 0) {
    chladniModes(t.formants.f1, t.formants.f2, targetModes);
    s.modes.m += (targetModes.m - s.modes.m) * 0.12;
    s.modes.n += (targetModes.n - s.modes.n) * 0.12;
  }
  paintDotFigure(ctx, s.w, s.h, s.modes.m, s.modes.n, INK.ink, INK.line);
};

// ── Spectrogram: time runs left to right, frequency upward, loudness as heat ──

const GRAM_MAX_HZ = 5000;
const GRAM_FLOOR_DB = -95;
const GRAM_CEIL_DB = -18;
/** Pixels the picture moves per frame. */
const GRAM_STEP = 2;
const GRAM_KHZ = ["0", "1 kHz", "2", "3", "4", "5"];

function hexInto(hex: string, out: Uint8ClampedArray, o: number): void {
  const n = parseInt(hex.slice(1), 16);
  out[o] = n >> 16;
  out[o + 1] = (n >> 8) & 255;
  out[o + 2] = n & 255;
}

/** Heat from the ground colour through the accent to the ink; entry 256 is the formant colour. */
function buildLut(s: DrawState): void {
  const stops = new Uint8ClampedArray(9);
  hexInto(INK.bg, stops, 0);
  hexInto(INK.accent, stops, 3);
  hexInto(INK.ink, stops, 6);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    const from = u < 0.6 ? 0 : 3;
    const k = u < 0.6 ? u / 0.6 : (u - 0.6) / 0.4;
    for (let c = 0; c < 3; c++) s.lut[i * 3 + c] = stops[from + c] + (stops[from + 3 + c] - stops[from + c]) * k;
  }
  hexInto(INK.lpc, s.lut, 256 * 3);
}

const drawSpectrogram: DrawFn = (ctx, s, t) => {
  const padL = s.bare ? 0 : 36;
  const padT = s.bare ? 0 : 8;
  const padB = s.bare ? 0 : 8;
  const w = Math.max(8, Math.floor(s.w - padL - (s.bare ? 0 : 8)));
  const h = Math.max(8, Math.floor(s.h - padT - padB));

  if (!s.gram || s.gram.width !== w || s.gram.height !== h) {
    s.gram = document.createElement("canvas");
    s.gram.width = w;
    s.gram.height = h;
    s.gramCtx = s.gram.getContext("2d");
    s.gramCol = null;
    s.lutKey = "";
  }
  const g = s.gramCtx;
  if (!g) return;
  const key = INK.bg + INK.accent + INK.ink + INK.lpc;
  if (s.lutKey !== key) {
    s.lutKey = key;
    buildLut(s);
    g.fillStyle = INK.bg;
    g.fillRect(0, 0, w, h);
  }

  if (t.timestampMs !== s.gramStamp) {
    s.gramStamp = t.timestampMs;
    g.globalCompositeOperation = "copy";
    g.drawImage(s.gram, -GRAM_STEP, 0);
    g.globalCompositeOperation = "source-over";
    const col = (s.gramCol ??= g.createImageData(GRAM_STEP, h));
    const data = col.data;
    const bins = t.fftMagnitudeDb.length;
    const binsPerHz = bins / (t.analysisRate / 2);
    const lut = s.lut;
    for (let y = 0; y < h; y++) {
      const bin = Math.min(bins - 1, Math.round((1 - y / (h - 1)) * GRAM_MAX_HZ * binsPerHz));
      const v = clamp01((t.fftMagnitudeDb[bin] - GRAM_FLOOR_DB) / (GRAM_CEIL_DB - GRAM_FLOOR_DB));
      const i = ((v * 255) | 0) * 3;
      for (let x = 0; x < GRAM_STEP; x++) {
        const o = (y * GRAM_STEP + x) * 4;
        data[o] = lut[i];
        data[o + 1] = lut[i + 1];
        data[o + 2] = lut[i + 2];
        data[o + 3] = 255;
      }
    }
    // The tracked formants leave a trail on top, the way a phonetician reads a spectrogram.
    if (t.voiced && t.formants.confidence > 0.05) {
      for (let f = 0; f < 3; f++) {
        const hz = f === 0 ? t.formants.f1 : f === 1 ? t.formants.f2 : t.formants.f3;
        if (!(hz > 0) || hz >= GRAM_MAX_HZ) continue;
        const y0 = Math.round((1 - hz / GRAM_MAX_HZ) * (h - 1));
        for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y0); y++) {
          for (let x = 0; x < GRAM_STEP; x++) {
            const o = (y * GRAM_STEP + x) * 4;
            data[o] = lut[768];
            data[o + 1] = lut[769];
            data[o + 2] = lut[770];
          }
        }
      }
    }
    g.putImageData(col, w - GRAM_STEP, 0);
  }

  ctx.drawImage(s.gram, padL, padT, w, h);
  if (!s.bare) {
    ctx.font = s.font;
    ctx.fillStyle = INK.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let k = 0; k < GRAM_KHZ.length; k++) {
      ctx.fillText(GRAM_KHZ[k], padL - 8, padT + (1 - (k * 1000) / GRAM_MAX_HZ) * (h - 1));
    }
  }
};

// ── Pitch track: F0 over the last few seconds, on a scale where octaves are equal steps ──

const TRACK_MIN_HZ = 70;
const TRACK_MAX_HZ = 480;
const TRACK_TICKS = [100, 200, 400];
const TRACK_LABELS = ["100", "200", "400 Hz"];
const TRACK_SPAN = Math.log(TRACK_MAX_HZ / TRACK_MIN_HZ);

const drawPitchTrack: DrawFn = (ctx, s, t) => {
  if (t.timestampMs !== s.trackStamp) {
    s.trackStamp = t.timestampMs;
    s.track[s.trackHead] = t.voiced ? t.stability.f0Hz : 0;
    s.trackHead = (s.trackHead + 1) % s.track.length;
  }
  const padL = s.bare ? 0 : 44;
  const padT = 8;
  const w = s.w - padL - (s.bare ? 0 : 8);
  const h = s.h - padT - 8;
  const yOf = (hz: number) => padT + (1 - Math.log(hz / TRACK_MIN_HZ) / TRACK_SPAN) * h;

  ctx.lineWidth = 1;
  ctx.strokeStyle = INK.grid;
  ctx.font = s.font;
  ctx.fillStyle = INK.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.beginPath();
  for (let i = 0; i < TRACK_TICKS.length; i++) {
    const y = Math.round(yOf(TRACK_TICKS[i])) + 0.5;
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
    if (!s.bare) ctx.fillText(TRACK_LABELS[i], padL - 8, y);
  }
  ctx.stroke();

  const n = s.track.length;
  ctx.strokeStyle = INK.accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let pen = false;
  let lastX = 0;
  let lastY = 0;
  for (let i = 0; i < n; i++) {
    const hz = s.track[(s.trackHead + i) % n];
    if (hz >= TRACK_MIN_HZ && hz <= TRACK_MAX_HZ) {
      lastX = padL + (i / (n - 1)) * w;
      lastY = yOf(hz);
      if (pen) ctx.lineTo(lastX, lastY);
      else ctx.moveTo(lastX, lastY);
      pen = true;
    } else {
      pen = false;
    }
  }
  ctx.stroke();
  if (pen) {
    ctx.fillStyle = INK.accent;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
};

export const DRAW: Record<TraceKind, DrawFn> = {
  mini: drawMini,
  voice: drawVoice,
  samples: drawSamples,
  rawDecimated: drawRawDecimated,
  preEmphasized: drawPreEmphasized,
  windowed: drawWindowed,
  window: drawScope,
  scope: drawScope,
  pitch: drawPitch,
  nsdf: drawNsdf,
  fft: drawFft,
  fftHarmonics: drawFftHarmonics,
  lpc: drawLpc,
  lpcCoeffs: drawLpcCoeffs,
  formants: drawFormants,
  spectrum: drawSpectrum,
  zplane: drawZPlane,
  vowel: drawVowel,
  spectrogram: drawSpectrogram,
  pitchTrack: drawPitchTrack,
  figure: drawFigure,
};
