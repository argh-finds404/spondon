"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prov } from "@/components/instrument/controls";
import { InstrumentSelect, type SelectOption } from "@/components/instrument/InstrumentSelect";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Trace } from "@/components/instrument/Trace";
import { analyzeTakeAtTime, ingestAudioFileOrBuffer, telemetryFromSavedTake } from "@/lib/dsp/file-ingest";
import { computeVocalTractArea, solveBurgLPC } from "@/lib/dsp/models";
import { extractTopSpectralPeaks, TRACT_SECTIONS } from "@/lib/dsp/regime";
import { synthesizeVoice } from "@/lib/dsp/synth";
import { evaluateTargetConvergence, findVowel, nearestVowel, VOWEL_TARGETS, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { decodeWav } from "@/lib/dsp/wav";
import {
  deleteTake,
  exportTakeBundleJson,
  importTakeBundleJson,
  isVaultPersistent,
  listTakes,
  saveTake,
  updateTakeNotes,
  type SavedTake,
  type TakeSourceType,
} from "@/lib/storage/takes-vault";
import { labRuntime, useLabStore, type ShapeModel } from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";

type SlotBMode = "saved" | "mic" | "synth";
type SourceFilter = "all" | TakeSourceType;
type CompareTab = "morph3d" | "spectra" | "notes";

const REC_DURATION_OPTIONS: readonly SelectOption<string>[] = [
  { value: "3", label: "3 sec", hint: "Quick vowel" },
  { value: "5", label: "5 sec", hint: "Default" },
  { value: "10", label: "10 sec", hint: "Phrase" },
  { value: "15", label: "15 sec", hint: "Long take" },
];

const TARGET_VOWEL_OPTIONS: readonly SelectOption<string>[] = [
  { value: "auto", label: "Auto-detect vowel", hint: "Nearest in Bark" },
  ...VOWEL_TARGETS.map((v) => ({
    value: v.id,
    badge: v.banglaSymbol ?? `/${v.symbol}/`,
    banglaBadge: Boolean(v.banglaSymbol),
    label: v.banglaSymbol ? `/${v.symbol}/ · ${v.label.split(",")[0]}` : v.label.split(",")[0],
    hint: `${v.targetF1}/${v.targetF2} Hz`,
  })),
];

const SYNTH_REF_OPTIONS: readonly SelectOption<string>[] = VOWEL_TARGETS.map((v) => ({
  value: v.id,
  badge: v.banglaSymbol ?? `/${v.symbol}/`,
  banglaBadge: Boolean(v.banglaSymbol),
  label: v.banglaSymbol ? `Synth /${v.symbol}/` : `Synth ${v.label.split(",")[0]}`,
  hint: `${v.targetF1} · ${v.targetF2} Hz`,
}));

const SHAPE_OPTIONS: readonly SelectOption<ShapeModel>[] = [
  { value: "square", label: "Square plate", hint: "Chladni C(x,z)=0" },
  { value: "circular", label: "Bessel drum", hint: "Circular J_m(αr)" },
  { value: "harmonic", label: "Harmonic field", hint: "3D FFT wave mesh" },
  { value: "tract", label: "3D Vocal tract", hint: "Glottis → lips tube" },
];

function formatTimeStamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Just now";
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "spondon-take"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDelta(valA: number, valB: number, decimals = 0, unit = ""): string {
  if (!(valA > 0) && !(valB > 0)) return "—";
  const diff = valB - valA;
  const sign = diff > 0 ? "+" : "";
  const formatted = decimals > 0 ? diff.toFixed(decimals) : Math.round(diff).toString();
  return `${sign}${formatted}${unit ? ` ${unit}` : ""}`;
}

/** Compute vocal-tract area array from time-domain frame so saved takes also drive the 3D Vocal Tract tube. */
function deriveTractAreaForFrame(frame: DSPFrameTelemetry): Float32Array {
  const out = new Float32Array(TRACT_SECTIONS).fill(0.5);
  let energy = 0;
  for (let i = 0; i < frame.timeDomainRaw.length; i++) {
    energy += frame.timeDomainRaw[i] * frame.timeDomainRaw[i];
  }
  if (energy > 1e-8) {
    const pre = new Float32Array(frame.timeDomainRaw.length);
    pre[0] = frame.timeDomainRaw[0] * 0.03;
    for (let i = 1; i < pre.length; i++) {
      pre[i] = frame.timeDomainRaw[i] - 0.97 * frame.timeDomainRaw[i - 1];
    }
    const burg = solveBurgLPC(pre, 12);
    computeVocalTractArea(burg.reflectionK, out);
  }
  return out;
}

/** Linearly blend two telemetry frames at morph factor u in [0, 1] (0 = A, 1 = B) for smooth 60 fps 3D & 2D morphing. */
export function interpolateTelemetry(
  a: DSPFrameTelemetry,
  b: DSPFrameTelemetry,
  areaA: Float32Array,
  areaB: Float32Array,
  u: number,
  targetVowelId: string,
  out: DSPFrameTelemetry,
): DSPFrameTelemetry {
  const k = Math.max(0, Math.min(1, u));
  const inv = 1 - k;
  out.sampleRate = b.sampleRate || a.sampleRate;
  out.analysisRate = b.analysisRate || a.analysisRate || 12000;
  out.vtlScale = b.vtlScale || a.vtlScale || 1;
  out.formants.f1 = a.formants.f1 * inv + b.formants.f1 * k;
  out.formants.f2 = a.formants.f2 * inv + b.formants.f2 * k;
  out.formants.f3 = a.formants.f3 * inv + b.formants.f3 * k;
  out.formants.b1 = a.formants.b1 * inv + b.formants.b1 * k;
  out.formants.b2 = a.formants.b2 * inv + b.formants.b2 * k;
  out.formants.b3 = a.formants.b3 * inv + b.formants.b3 * k;
  out.voiced = (a.voiced || b.voiced) && out.formants.f1 > 80 && out.formants.f2 > 200;
  out.formants.confidence = out.voiced ? Math.max(a.formants.confidence, b.formants.confidence, 0.85) : 0;
  out.stability.f0Hz = a.stability.f0Hz * inv + b.stability.f0Hz * k;
  out.stability.rmsDb = a.stability.rmsDb * inv + b.stability.rmsDb * k;
  out.stability.pitchConfidence = out.voiced ? 0.9 : 0;

  for (let i = 0; i < out.fftMagnitudeDb.length; i++) {
    out.fftMagnitudeDb[i] = (a.fftMagnitudeDb[i] ?? -120) * inv + (b.fftMagnitudeDb[i] ?? -120) * k;
    out.lpcEnvelopeDb[i] = (a.lpcEnvelopeDb[i] ?? -120) * inv + (b.lpcEnvelopeDb[i] ?? -120) * k;
  }
  for (let i = 0; i < out.vocalTractArea.length; i++) {
    out.vocalTractArea[i] = (areaA[i] ?? 0.5) * inv + (areaB[i] ?? 0.5) * k;
  }
  extractTopSpectralPeaks(out.fftMagnitudeDb, out.analysisRate, out.regime.topPeaks);
  evaluateTargetConvergence(out.formants, findVowel(targetVowelId), out.activeTargetMatch, out.vtlScale);
  return out;
}

interface MetricSnapshot {
  f0Hz: number;
  f1: number;
  f2: number;
  f3: number;
  bark: number;
  jitter: number;
  score: number;
  vowelId: string;
}

function snapshotFromTelemetry(t: DSPFrameTelemetry, targetVowelId?: string | null): MetricSnapshot {
  const target = targetVowelId ? findVowel(targetVowelId) : findVowel(t.activeTargetMatch.targetId);
  return {
    f0Hz: t.voiced ? t.stability.f0Hz : 0,
    f1: t.voiced ? t.formants.f1 : 0,
    f2: t.voiced ? t.formants.f2 : 0,
    f3: t.voiced ? t.formants.f3 : 0,
    bark: t.voiced ? t.activeTargetMatch.distanceBark : 0,
    jitter: t.stability.jitterPercent,
    score: t.voiced ? t.activeTargetMatch.convergenceScore : 0,
    vowelId: target.id,
  };
}

function LiveSlotBDeltaStrip({
  refA,
  targetVowelId,
}: {
  refA: MetricSnapshot | null;
  targetVowelId: string;
}) {
  const f0Ref = useRef<HTMLSpanElement>(null);
  const f1Ref = useRef<HTMLSpanElement>(null);
  const f2Ref = useRef<HTMLSpanElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const vowelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let last = 0;
    return labRuntime.subscribe((t) => {
      const now = performance.now();
      if (now - last < 90) return;
      last = now;
      const b = snapshotFromTelemetry(t, targetVowelId);
      const setCell = (el: HTMLSpanElement | null, val: number, aVal: number | undefined, unit: string, dec = 0) => {
        if (!el) return;
        const valText = val > 0 ? `${dec > 0 ? val.toFixed(dec) : Math.round(val)}${unit}` : "—";
        const diffText =
          refA && val > 0 && aVal && aVal > 0 ? ` (${formatDelta(aVal, val, dec, unit.trim())})` : "";
        el.textContent = `${valText}${diffText}`;
      };
      setCell(f0Ref.current, b.f0Hz, refA?.f0Hz, " Hz");
      setCell(f1Ref.current, b.f1, refA?.f1, " Hz");
      setCell(f2Ref.current, b.f2, refA?.f2, " Hz");
      setCell(scoreRef.current, b.score, refA?.score, "%");
      if (vowelRef.current) {
        if (t.voiced && t.formants.f1 > 0 && t.formants.f2 > 0) {
          const detected = nearestVowel(t.formants.f1, t.formants.f2);
          vowelRef.current.textContent = detected.banglaSymbol
            ? `${detected.banglaSymbol} /${detected.symbol}/`
            : `/${detected.symbol}/`;
        } else {
          const tgt = findVowel(targetVowelId);
          vowelRef.current.textContent = `Listening (target /${tgt.symbol}/)`;
        }
      }
    });
  }, [refA, targetVowelId]);

  return (
    <div data-ui className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
      {[
        { label: "Live F0", ref: f0Ref },
        { label: "Live F1", ref: f1Ref },
        { label: "Live F2", ref: f2Ref },
        { label: "Match", ref: scoreRef },
        { label: "Detected", ref: vowelRef },
      ].map((item) => (
        <div key={item.label} className="bg-surface px-3.5 py-2.5">
          <div className="ui-label text-[11px]">{item.label}</div>
          <span ref={item.ref} className="ui-fig mt-0.5 block text-[13.5px] font-medium text-ink">
            —
          </span>
        </div>
      ))}
    </div>
  );
}

interface TakeCardProps {
  take: SavedTake;
  isA: boolean;
  isB: boolean;
  isPlaying: boolean;
  onPinA: (take: SavedTake) => void;
  onLoadB: (take: SavedTake) => void;
  onPlayToggle: (take: SavedTake) => void;
  onDelete: (id: string) => void;
  onSaveNotes: (id: string, title: string, notes: string) => Promise<void>;
}

function TakeCard({
  take,
  isA,
  isB,
  isPlaying,
  onPinA,
  onLoadB,
  onPlayToggle,
  onDelete,
  onSaveNotes,
}: TakeCardProps) {
  const [title, setTitle] = useState(take.title);
  const [notes, setNotes] = useState(take.notes);
  const [expanded, setExpanded] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    [],
  );

  const vowelObj = findVowel(take.targetVowel ?? take.summary.nearestVowel);
  const dirty = title !== take.title || notes !== take.notes;

  const commitNotes = async () => {
    await onSaveNotes(take.id, title, notes);
    setSaveHint("Saved");
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setSaveHint(null), 1500);
  };

  return (
    <article
      className={`ui-panel flex flex-col transition-[border-color,transform,background-color] duration-200 ease-(--ease-out) ${isA && isB
        ? "border-accent"
        : isA
          ? "border-lpc"
          : isB
            ? "border-accent/80"
            : "border-line hover:border-control"
        }`}
    >
      <div className="flex items-start justify-between gap-2.5 px-3.5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-raised px-1.5 py-0.5 font-semibold tracking-wide text-muted uppercase">
              {take.sourceType}
            </span>
            {isA && <span className="rounded bg-lpc px-1.5 py-0.5 font-semibold text-bg">REF A</span>}
            {isB && <span className="rounded bg-accent px-1.5 py-0.5 font-semibold text-accent-ink">TAKE B</span>}
            <span className="ui-fig text-muted">
              {take.durationSec.toFixed(1)}s · {formatTimeStamp(take.createdAt)}
            </span>
          </div>
          <input
            type="text"
            aria-label="Take title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (dirty) void commitNotes();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="mt-1 w-full rounded-(--radius-sm) border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-semibold text-ink transition-colors hover:border-line focus:border-accent focus:bg-raised focus:outline-none"
          />
          <p className="ui-fig mt-0.5 px-1 text-[12px] text-muted">
            F0 {take.summary.f0Hz > 0 ? Math.round(take.summary.f0Hz) : "—"} · F1{" "}
            {take.summary.f1Hz > 0 ? take.summary.f1Hz : "—"} · F2{" "}
            {take.summary.f2Hz > 0 ? take.summary.f2Hz : "—"} Hz
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end pr-0.5">
          <span lang={vowelObj.banglaSymbol ? "bn" : undefined} className="bn text-[22px] leading-none text-ink">
            {vowelGlyph(vowelObj)}
          </span>
          {vowelObj.banglaSymbol && <span className="ui-fig mt-0.5 text-[11px] text-muted">/{vowelObj.symbol}/</span>}
        </div>
      </div>

      {/* Compact Action Strip */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-raised/30 px-3 py-2">
        <button
          type="button"
          onClick={() => onPinA(take)}
          aria-pressed={isA}
          className={`rounded-(--radius-sm) border px-2.5 py-1 text-[12px] font-medium transition-all duration-150 ${isA
            ? "border-lpc bg-lpc text-bg font-semibold"
            : "border-line bg-surface text-ink hover:border-lpc"
            }`}
        >
          {isA ? "✓ Ref A" : "Set A"}
        </button>
        <button
          type="button"
          onClick={() => onLoadB(take)}
          aria-pressed={isB}
          className={`rounded-(--radius-sm) border px-2.5 py-1 text-[12px] font-medium transition-all duration-150 ${isB
            ? "border-accent bg-accent text-accent-ink font-semibold"
            : "border-line bg-surface text-ink hover:border-accent"
            }`}
        >
          {isB ? "✓ Take B" : "Set B"}
        </button>
        <button
          type="button"
          onClick={() => onPlayToggle(take)}
          className="rounded-(--radius-sm) border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:border-ink"
        >
          {isPlaying ? "■ Stop" : "▶ Play"}
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto rounded-(--radius-sm) px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:text-ink"
        >
          {expanded ? "Close ▲" : notes.trim() ? "Notes ●" : "Notes ▾"}
        </button>
      </div>

      {/* Smooth Animated Accordion Drawer for Notes & Export */}
      <div className="drawer-grid" data-open={expanded}>
        <div className="drawer-inner">
          <div className="border-t border-line bg-raised/45 px-3.5 py-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
              <label htmlFor={`note-${take.id}`}>Observation notes</label>
              <span className="ui-fig text-lock">{dirty ? "Unsaved" : saveHint ?? "Synced"}</span>
            </div>
            <textarea
              id={`note-${take.id}`}
              rows={2}
              placeholder="Write observations (e.g. lowered jaw — F1 shifted closer to target)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (dirty) void commitNotes();
              }}
              className="w-full resize-y rounded-(--radius-sm) border border-line bg-surface p-2 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    downloadBlob(
                      new Blob([new Uint8Array(take.wavBytes)], { type: "audio/wav" }),
                      `${slugify(title)}.wav`,
                    )
                  }
                  className="rounded-(--radius-sm) border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-ink"
                >
                  ⬇ .WAV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const committedTitle = title.trim() || take.title;
                    if (dirty) void commitNotes();
                    downloadBlob(
                      new Blob([exportTakeBundleJson({ ...take, title: committedTitle, notes })], {
                        type: "application/json",
                      }),
                      `${slugify(committedTitle)}.spondon.json`,
                    );
                  }}
                  className="rounded-(--radius-sm) border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-ink"
                >
                  Export .json
                </button>
              </div>
              <button
                type="button"
                onClick={() => onDelete(take.id)}
                className="rounded-(--radius-sm) px-2 py-1 text-[11px] font-medium text-muted hover:text-accent"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Uncluttered Local-First Takes Studio with Custom Animated Dropdowns and a Real-Time
 * 60 fps 3D A <-> B Acoustic Morphing Stage.
 */
export function CompareWorkspace() {
  const [takes, setTakes] = useState<SavedTake[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [takeAId, setTakeAId] = useState<string | null>(null);
  const [takeBId, setTakeBId] = useState<string | null>(null);
  const [slotBMode, setSlotBMode] = useState<SlotBMode>("saved");
  const [compareTab, setCompareTab] = useState<CompareTab>("morph3d");

  const [scrubASec, setScrubASec] = useState<number | null>(null);
  const [scrubBSec, setScrubBSec] = useState<number | null>(null);

  const [recDurationStr, setRecDurationStr] = useState<string>("5");
  const recDuration = Number(recDurationStr) || 5;
  const [targetVowelChoice, setTargetVowelChoice] = useState<string>("auto");
  const [synthVowelChoice, setSynthVowelChoice] = useState<string>("aa");
  const [filterSource, setFilterSource] = useState<SourceFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // 3D Morphing state (0 = 100% Take A, 1 = 100% Take B)
  const [autoMorph, setAutoMorph] = useState(true);
  const [morphMix, setMorphMix] = useState(1);
  const [compareShape, setCompareShape] = useState<ShapeModel>("square");

  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null);
  const [sequencePlaying, setSequencePlaying] = useState(false);

  const isRecordingClip = useLabStore((s) => s.isRecordingClip);
  const recordingProgress = useLabStore((s) => s.recordingProgress);
  const excitePlate = useLabStore((s) => s.excitePlate);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playbackSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const seqCancelRef = useRef(false);
  const wasLiveMicBeforeRecRef = useRef(false);
  const liveVuRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  // Initial load from IndexedDB vault
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await listTakes();
        if (cancelled) return;
        setTakes(items);
        if (!isVaultPersistent()) {
          setErrorMsg("This browser is not letting the site keep data, so takes last only until you close the tab.");
        }
        if (items.length >= 2) {
          setTakeAId(items[1].id);
          setTakeBId(items[0].id);
        } else if (items.length === 1) {
          setTakeBId(items[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Could not open IndexedDB vault.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live VU meter during recording
  useEffect(() => {
    if (!isRecordingClip) return;
    return labRuntime.subscribe(() => {
      const bar = liveVuRef.current;
      if (!bar) return;
      const db = labRuntime.getLiveRmsDb();
      const pct = Math.max(3, Math.min(100, ((db + 72) / 68) * 100));
      bar.style.width = `${pct.toFixed(1)}%`;
    });
  }, [isRecordingClip]);

  const stopPlayback = useCallback(() => {
    seqCancelRef.current = true;
    setSequencePlaying(false);
    setPlayingTakeId(null);
    if (playbackSrcRef.current) {
      try {
        playbackSrcRef.current.onended = null;
        playbackSrcRef.current.stop();
      } catch {
        // already stopped
      }
      playbackSrcRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (useLabStore.getState().isRecordingClip) {
        labRuntime.getController()?.stopRecordingClip();
      }
      stopPlayback();
      void playbackCtxRef.current?.close();
      playbackCtxRef.current = null;
    };
  }, [stopPlayback]);

  const playTakeAudio = useCallback(async (take: SavedTake): Promise<void> => {
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio playback is not available in this browser.");
    }
    const ctx = playbackCtxRef.current ?? new AudioCtx();
    playbackCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const decoded = decodeWav(take.wavBytes);
    const buffer = ctx.createBuffer(1, decoded.samples.length, decoded.sampleRate);
    buffer.copyToChannel(new Float32Array(decoded.samples), 0);

    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.85;
      src.connect(gain);
      gain.connect(ctx.destination);
      playbackSrcRef.current = src;
      setPlayingTakeId(take.id);
      src.onended = () => {
        if (playbackSrcRef.current === src) playbackSrcRef.current = null;
        setPlayingTakeId((cur) => (cur === take.id ? null : cur));
        resolve();
      };
      src.start();
    });
  }, []);

  const handleTogglePlayTake = async (take: SavedTake) => {
    if (playingTakeId === take.id) {
      stopPlayback();
      return;
    }
    stopPlayback();
    seqCancelRef.current = false;
    try {
      await playTakeAudio(take);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not play audio clip.");
    }
  };

  const takeAIdRef = useRef<string | null>(null);
  const takeBIdRef = useRef<string | null>(null);
  useEffect(() => {
    takeAIdRef.current = takeAId;
    takeBIdRef.current = takeBId;
  }, [takeAId, takeBId]);

  const refreshAndSelectNew = useCallback(async (saved: SavedTake, pinIfEmpty = true) => {
    const items = await listTakes();
    setTakes(items);
    const curA = takeAIdRef.current;
    const curB = takeBIdRef.current;
    if (pinIfEmpty && !curA && curB && curB !== saved.id) {
      takeAIdRef.current = curB;
      setTakeAId(curB);
    }
    takeBIdRef.current = saved.id;
    setTakeBId(saved.id);
    setSlotBMode("saved");
    setScrubBSec(null);
  }, []);

  const resolvedTarget = targetVowelChoice === "auto" ? null : targetVowelChoice;

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setErrorMsg(null);
    setBusyMessage(`Analyzing ${files.length === 1 ? files[0].name : `${files.length} files`} locally…`);
    try {
      let lastSaved: SavedTake | null = null;
      for (const file of files) {
        const take = await ingestAudioFileOrBuffer(file, resolvedTarget, { sourceType: "upload" });
        await saveTake(take);
        lastSaved = take;
        await refreshAndSelectNew(take, true);
      }
      if (lastSaved) {
        setStatusMsg(
          files.length === 1
            ? `Saved "${lastSaved.title}" (${lastSaved.durationSec.toFixed(1)}s) to IndexedDB.`
            : `Saved ${files.length} audio files to IndexedDB.`,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not decode or analyze audio file.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleImportBundles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    setBusyMessage("Importing .spondon.json bundle…");
    try {
      let last: SavedTake | null = null;
      for (const file of Array.from(fileList)) {
        const text = await file.text();
        last = await importTakeBundleJson(text);
        await refreshAndSelectNew(last, true);
      }
      if (last) {
        setStatusMsg(`Imported "${last.title}" into your local vault.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to import .spondon.json bundle.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleStartRecording = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    stopPlayback();

    const store = useLabStore.getState();
    wasLiveMicBeforeRecRef.current = store.sourceMode === "mic" && slotBMode === "mic";

    if (store.sourceMode !== "mic") {
      await store.setSourceMode("mic");
    }
    const latest = useLabStore.getState();
    if (latest.sourceMode !== "mic") {
      setErrorMsg(latest.micError ?? "Microphone permission is required to record a note.");
      return;
    }

    const ctrl = labRuntime.getController();
    if (!ctrl) return;

    ctrl.startRecordingClip(recDuration, {
      autoPlay: false,
      onComplete: (pcm, sr) => {
        void (async () => {
          if (!mountedRef.current) {
            if (!wasLiveMicBeforeRecRef.current) {
              await useLabStore.getState().setSourceMode("silent");
            }
            return;
          }
          setBusyMessage("Analyzing recorded microphone clip…");
          try {
            const take = await ingestAudioFileOrBuffer({ pcm, sampleRate: sr }, resolvedTarget, {
              sourceType: "mic",
            });
            await saveTake(take);
            if (!mountedRef.current) return;
            await refreshAndSelectNew(take, true);
            if (!mountedRef.current) return;
            setStatusMsg(`Recorded & saved "${take.title}" (${take.durationSec.toFixed(1)}s).`);
          } catch (err) {
            if (mountedRef.current) {
              setErrorMsg(err instanceof Error ? err.message : "Recorded clip was too short to analyze.");
            }
          } finally {
            if (mountedRef.current) setBusyMessage(null);
            if (!wasLiveMicBeforeRecRef.current) {
              await useLabStore.getState().setSourceMode("silent");
            }
          }
        })();
      },
    });
  };

  const handleStopRecordingEarly = () => {
    labRuntime.getController()?.stopRecordingClip();
  };

  const handleSaveSynthReference = async (vowelId: string) => {
    setErrorMsg(null);
    setBusyMessage(`Rendering synthetic /${vowelId}/ reference…`);
    try {
      const v = findVowel(vowelId);
      const pcm = synthesizeVoice({
        sampleRate: 48000,
        f0Hz: 140,
        formants: [v.targetF1, v.targetF2, v.targetF3],
        durationSec: 1.5,
        jitterPercent: 0.4,
        seed: 7,
      });
      const take = await ingestAudioFileOrBuffer({ pcm, sampleRate: 48000 }, v.id, {
        title: `Reference · ${v.banglaSymbol ? `${v.banglaSymbol} /${v.symbol}/` : `/${v.symbol}/`}`,
        notes: `Built-in source-filter reference: F1 ${v.targetF1} Hz, F2 ${v.targetF2} Hz, F3 ${v.targetF3} Hz.`,
        sourceType: "synth",
      });
      await saveTake(take);
      await refreshAndSelectNew(take, true);
      setStatusMsg(`Created synthetic /${v.symbol}/ reference take.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not generate synthetic take.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleCreateStarterPair = async () => {
    setErrorMsg(null);
    setBusyMessage("Generating synthetic /aa/ vs /ii/ starter pair…");
    try {
      const aa = findVowel("aa");
      const ii = findVowel("ii");
      const pcmA = synthesizeVoice({
        sampleRate: 48000,
        f0Hz: 140,
        formants: [aa.targetF1, aa.targetF2, aa.targetF3],
        durationSec: 1.4,
        jitterPercent: 0.4,
        seed: 7,
      });
      const pcmB = synthesizeVoice({
        sampleRate: 48000,
        f0Hz: 165,
        formants: [ii.targetF1, ii.targetF2, ii.targetF3],
        durationSec: 1.4,
        jitterPercent: 0.35,
        seed: 11,
      });
      const createdA = await ingestAudioFileOrBuffer({ pcm: pcmA, sampleRate: 48000 }, aa.id, {
        title: `Reference A · ${aa.banglaSymbol} /${aa.symbol}/`,
        notes: "Open low-back vowel baseline (high F1 ~750 Hz, low F2 ~1180 Hz).",
        sourceType: "synth",
      });
      const createdB = await ingestAudioFileOrBuffer({ pcm: pcmB, sampleRate: 48000 }, ii.id, {
        title: `Take B · ${ii.banglaSymbol} /${ii.symbol}/`,
        notes: "High-front vowel comparison (low F1 ~280 Hz, high F2 ~2280 Hz).",
        sourceType: "synth",
      });
      await saveTake(createdA);
      await saveTake(createdB);
      const items = await listTakes();
      setTakes(items);
      setTakeAId(createdA.id);
      setTakeBId(createdB.id);
      setSlotBMode("saved");
      setAutoMorph(true);
      setScrubASec(null);
      setScrubBSec(null);
      setStatusMsg("Created /aa/ vs /ii/ starter pair — watch the 3D stage morph between A and B.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not create starter pair.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleDeleteTake = async (id: string) => {
    if (playingTakeId === id) stopPlayback();
    let items: SavedTake[];
    try {
      await deleteTake(id);
      items = await listTakes();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not delete the take.");
      return;
    }
    setTakes(items);
    if (takeAId === id) {
      setTakeAId(null);
      setScrubASec(null);
    }
    if (takeBId === id) {
      setTakeBId(items.find((x) => x.id !== takeAId)?.id ?? items[0]?.id ?? null);
      setScrubBSec(null);
    }
  };

  const handleSaveNotes = async (id: string, title: string, notes: string) => {
    let updated: SavedTake | null;
    try {
      updated = await updateTakeNotes(id, title, notes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not save the notes.");
      return;
    }
    if (!updated) return;
    setTakes((prev) => prev.map((t) => (t.id === id ? updated : t)));
  };

  const takeA = useMemo(() => takes.find((t) => t.id === takeAId) ?? null, [takes, takeAId]);
  const takeB = useMemo(() => takes.find((t) => t.id === takeBId) ?? null, [takes, takeBId]);

  const handleSwitchSlotBMode = async (next: SlotBMode) => {
    stopPlayback();
    setSlotBMode(next);
    const store = useLabStore.getState();
    if (next === "mic") {
      await store.setSourceMode("mic");
      if (useLabStore.getState().frozen) useLabStore.getState().toggleFreeze();
      if (takeA?.targetVowel) store.selectTarget(takeA.targetVowel, false);
    } else if (next === "synth") {
      if (store.sourceMode !== "synth") await store.setSourceMode("synth");
      if (useLabStore.getState().frozen) useLabStore.getState().toggleFreeze();
    } else if (store.sourceMode === "mic") {
      await store.setSourceMode("silent");
    }
  };

  const frameA = useMemo<DSPFrameTelemetry | null>(() => {
    if (!takeA) return null;
    const f = scrubASec !== null ? analyzeTakeAtTime(takeA, scrubASec) : telemetryFromSavedTake(takeA);
    f.vocalTractArea.set(deriveTractAreaForFrame(f));
    return f;
  }, [takeA, scrubASec]);

  const frameB = useMemo<DSPFrameTelemetry | null>(() => {
    if (slotBMode !== "saved" || !takeB) return null;
    const f = scrubBSec !== null ? analyzeTakeAtTime(takeB, scrubBSec) : telemetryFromSavedTake(takeB);
    f.vocalTractArea.set(deriveTractAreaForFrame(f));
    return f;
  }, [slotBMode, takeB, scrubBSec]);

  const activeTargetVowel =
    (slotBMode === "saved" ? takeB?.targetVowel ?? takeB?.summary.nearestVowel : null) ??
    takeA?.targetVowel ??
    takeA?.summary.nearestVowel ??
    "aa";

  // Smooth rAF oscillation driving morphMix (0 <-> 1) when Auto-morph is enabled
  useEffect(() => {
    if (!autoMorph || slotBMode !== "saved" || !frameA || !frameB) return;
    let raf = 0;
    const start = performance.now();
    let lastStatePush = 0;
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      const u = 0.5 - 0.5 * Math.cos(elapsed * 1.65);
      if (now - lastStatePush >= 32) {
        lastStatePush = now;
        setMorphMix(Number(u.toFixed(3)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoMorph, slotBMode, frameA, frameB]);

  const morphedFrame = useMemo<DSPFrameTelemetry | null>(() => {
    if (slotBMode !== "saved") return null;
    if (!frameA || !frameB || !takeB) return frameB ?? frameA ?? null;
    const base = telemetryFromSavedTake(takeB);
    return interpolateTelemetry(
      frameA,
      frameB,
      frameA.vocalTractArea,
      frameB.vocalTractArea,
      morphMix,
      activeTargetVowel,
      base,
    );
  }, [slotBMode, frameA, frameB, takeB, morphMix, activeTargetVowel]);

  const metricsA = useMemo<MetricSnapshot | null>(() => {
    if (!takeA) return null;
    if (frameA && scrubASec !== null) {
      return snapshotFromTelemetry(frameA, takeA.targetVowel ?? takeA.summary.nearestVowel);
    }
    return {
      f0Hz: takeA.summary.f0Hz,
      f1: takeA.summary.f1Hz,
      f2: takeA.summary.f2Hz,
      f3: takeA.summary.f3Hz,
      bark: takeA.summary.distanceBark,
      jitter: takeA.summary.jitterPercent,
      score: takeA.summary.convergenceScore,
      vowelId: takeA.summary.nearestVowel,
    };
  }, [takeA, frameA, scrubASec]);

  const metricsB = useMemo<MetricSnapshot | null>(() => {
    if (slotBMode !== "saved" || !takeB) return null;
    if (frameB && scrubBSec !== null) return snapshotFromTelemetry(frameB, activeTargetVowel);
    return {
      f0Hz: takeB.summary.f0Hz,
      f1: takeB.summary.f1Hz,
      f2: takeB.summary.f2Hz,
      f3: takeB.summary.f3Hz,
      bark: takeB.summary.distanceBark,
      jitter: takeB.summary.jitterPercent,
      score: takeB.summary.convergenceScore,
      vowelId: takeB.summary.nearestVowel,
    };
  }, [slotBMode, takeB, frameB, scrubBSec, activeTargetVowel]);

  const filteredTakes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return takes.filter((t) => {
      if (filterSource !== "all" && t.sourceType !== filterSource) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        (t.fileName?.toLowerCase().includes(q) ?? false) ||
        t.summary.nearestVowel.toLowerCase().includes(q)
      );
    });
  }, [takes, filterSource, searchQuery]);

  const handlePlaySequence = async () => {
    if (!takeA || !takeB || slotBMode !== "saved") return;
    if (sequencePlaying) {
      stopPlayback();
      return;
    }
    stopPlayback();
    seqCancelRef.current = false;
    setSequencePlaying(true);
    try {
      await playTakeAudio(takeA);
      if (seqCancelRef.current) return;
      await new Promise((r) => setTimeout(r, 250));
      if (seqCancelRef.current) return;
      await playTakeAudio(takeB);
    } finally {
      setSequencePlaying(false);
    }
  };

  const stageTelemetryFor3D = slotBMode === "saved" ? (morphedFrame ?? frameB ?? frameA) : null;

  return (
    <main id="content" className="wrap min-h-svh pt-(--nav-h) pb-14 text-[14px] leading-[1.4]">
      {/* Clean Spacious Page Header */}
      <header className="flex flex-wrap items-end justify-between gap-6 py-5">
        <div>
          <p className="ui-label flex items-center gap-2 text-[12px]">
            <Prov kind="measured">Local IndexedDB vault · zero server uploads</Prov>
          </p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-ink">
            Compare &amp; Morph Takes
          </h1>
        </div>

        {/* Streamlined Capture & Ingest Bar */}
        <div
          aria-label="Capture or import audio takes"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) void handleUploadFiles(e.dataTransfer.files);
          }}
          className={`flex flex-wrap items-center gap-2.5 rounded-(--radius) border p-2 transition-colors ${dragOver ? "border-accent bg-raised" : "border-line bg-surface"
            }`}
        >
          <InstrumentSelect
            ariaLabel="Target vowel"
            size="sm"
            value={targetVowelChoice}
            options={TARGET_VOWEL_OPTIONS}
            onChange={setTargetVowelChoice}
            className="w-[215px]"
            menuWidthClass="w-[280px]"
          />

          <InstrumentSelect
            ariaLabel="Recording duration"
            size="sm"
            value={recDurationStr}
            options={REC_DURATION_OPTIONS}
            onChange={setRecDurationStr}
            disabled={isRecordingClip}
            className="w-[100px]"
            menuWidthClass="w-[180px]"
          />

          {!isRecordingClip ? (
            <button
              type="button"
              onClick={() => void handleStartRecording()}
              disabled={Boolean(busyMessage)}
              className="btn btn-sm"
            >
              ● Record
            </button>
          ) : (
            <button type="button" onClick={handleStopRecordingEarly} className="btn btn-sm animate-pulse">
              ■ Stop ({(recordingProgress * recDuration).toFixed(1)}s)
            </button>
          )}

          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.aac,.flac"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleUploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={Boolean(busyMessage)}
            onClick={() => audioInputRef.current?.click()}
            className="btn btn-quiet btn-sm"
          >
            ↑ Upload audio
          </button>

          <div className="flex items-center gap-1.5 border-l border-line pl-2">
            <InstrumentSelect
              ariaLabel="Synthetic reference vowel"
              size="sm"
              align="right"
              value={synthVowelChoice}
              options={SYNTH_REF_OPTIONS}
              onChange={setSynthVowelChoice}
              className="w-[155px]"
              menuWidthClass="w-[240px]"
            />
            <button
              type="button"
              disabled={Boolean(busyMessage)}
              onClick={() => void handleSaveSynthReference(synthVowelChoice)}
              className="rounded-(--radius-sm) border border-line bg-raised px-2.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-accent"
            >
              + Add
            </button>
          </div>
        </div>
      </header>

      {/* Live recording meter or status toast */}
      {(isRecordingClip || busyMessage || statusMsg || errorMsg || dragOver) && (
        <div className="ui-panel mb-4 px-4 py-2.5 text-[12.5px]">
          {isRecordingClip && (
            <div className="flex items-center gap-3">
              <span className="font-semibold text-accent">● RECORDING</span>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded-(--radius-sm) border border-line bg-raised">
                <div ref={liveVuRef} className="h-full w-[4%] bg-accent transition-[width] duration-75" />
              </div>
              <span className="ui-fig text-muted">{Math.round(recordingProgress * 100)}%</span>
            </div>
          )}
          {dragOver && <p className="font-medium text-accent">Drop audio files (.wav, .mp3, .m4a, .ogg, .webm) to analyze locally…</p>}
          {busyMessage && <p className="text-ink">{busyMessage}</p>}
          {statusMsg && !busyMessage && <p className="text-lock">{statusMsg}</p>}
          {errorMsg && (
            <p role="alert" className="text-accent">
              {errorMsg}
            </p>
          )}
        </div>
      )}

      {/* Clean Two-Column Studio */}
      <div className="grid grid-cols-12 items-start gap-5">
        {/* LEFT SIDEBAR (4 cols): Saved Takes Vault */}
        <section aria-label="Saved takes and notes" className="col-span-12 flex flex-col gap-3 lg:col-span-4">
          <div className="ui-panel p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="tablist" aria-label="Filter takes by source" className="seg">
                {(["all", "mic", "upload", "synth"] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    role="tab"
                    aria-selected={filterSource === src}
                    onClick={() => setFilterSource(src)}
                  >
                    {src === "all" ? `All (${takes.length})` : src.toUpperCase()}
                  </button>
                ))}
              </div>

              <input
                ref={bundleInputRef}
                type="file"
                accept=".json,.spondon.json,application/json"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleImportBundles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={Boolean(busyMessage)}
                onClick={() => bundleInputRef.current?.click()}
                className="text-[12px] font-medium text-muted transition-colors hover:text-ink"
              >
                Import .json
              </button>
            </div>

            {takes.length > 2 && (
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title or notes…"
                className="mt-2.5 h-9 w-full rounded-(--radius-sm) border border-line bg-raised px-3 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
            )}
          </div>

          {loading ? (
            <div className="ui-panel p-6 text-center text-muted">Loading local IndexedDB vault…</div>
          ) : filteredTakes.length === 0 ? (
            <div className="ui-panel flex flex-col items-start gap-3.5 p-5">
              <h2 className="text-[16px] font-semibold text-ink">
                {takes.length === 0 ? "Start with two takes" : "No matching takes"}
              </h2>
              <p className="text-[13.5px] leading-relaxed text-muted">
                {takes.length === 0
                  ? "Record your voice, upload an audio file, or load a synthetic /ɑː/ vs /iː/ pair to see the 3D morphing stage in action."
                  : "Clear the search filter to see all saved takes."}
              </p>
              {takes.length === 0 && (
                <button
                  type="button"
                  onClick={() => void handleCreateStarterPair()}
                  disabled={Boolean(busyMessage)}
                  className="btn btn-sm"
                >
                  Load /ɑː/ vs /iː/ 3D starter pair
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredTakes.map((take) => (
                <TakeCard
                  key={take.id}
                  take={take}
                  isA={takeAId === take.id}
                  isB={slotBMode === "saved" && takeBId === take.id}
                  isPlaying={playingTakeId === take.id}
                  onPinA={(t) => {
                    setTakeAId(t.id);
                    setScrubASec(null);
                  }}
                  onLoadB={(t) => {
                    setSlotBMode("saved");
                    setTakeBId(t.id);
                    setScrubBSec(null);
                  }}
                  onPlayToggle={(t) => void handleTogglePlayTake(t)}
                  onDelete={(id) => void handleDeleteTake(id)}
                  onSaveNotes={handleSaveNotes}
                />
              ))}
            </div>
          )}
        </section>

        {/* RIGHT STAGE (8 cols): Clean Focused Comparison & 3D Morphing Studio */}
        <section aria-label="A versus B acoustic comparison" className="col-span-12 flex flex-col gap-4 lg:col-span-8">
          {/* Unified Top Bar: A vs B Assignment + 4-Metric Visual Diff */}
          <div className="ui-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
                <span className="inline-flex items-center gap-1.5 rounded-(--radius-sm) border border-lpc/40 bg-raised px-2.5 py-1">
                  <span className="h-2 w-2 rounded-full bg-lpc" aria-hidden />
                  <span className="font-semibold text-ink">A:</span>
                  <span className="max-w-[18ch] truncate text-muted">{takeA ? takeA.title : "None"}</span>
                  {takeA && (
                    <button
                      type="button"
                      onClick={() => {
                        setTakeAId(null);
                        setScrubASec(null);
                      }}
                      className="ml-1 text-[11px] text-muted hover:text-accent"
                    >
                      ✕
                    </button>
                  )}
                </span>
                <span className="text-muted">→</span>
                <div role="radiogroup" aria-label="Active B source" className="seg">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotBMode === "saved"}
                    onClick={() => void handleSwitchSlotBMode("saved")}
                  >
                    Saved B
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotBMode === "mic"}
                    data-hot={slotBMode === "mic"}
                    onClick={() => void handleSwitchSlotBMode("mic")}
                  >
                    Live Mic
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotBMode === "synth"}
                    onClick={() => void handleSwitchSlotBMode("synth")}
                  >
                    Live Synth
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {takeA && takeB && slotBMode === "saved" && (
                  <button type="button" onClick={() => void handlePlaySequence()} className="btn btn-quiet btn-sm">
                    {sequencePlaying ? "■ Stop A → B" : "▶ Hear A → B"}
                  </button>
                )}
                <Link href="/lab" className="ui-tab px-2 text-[13px] font-medium">
                  Full lab →
                </Link>
              </div>
            </div>

            {/* Clean 4-Metric Diff Row */}
            {slotBMode !== "saved" ? (
              <LiveSlotBDeltaStrip refA={metricsA} targetVowelId={activeTargetVowel} />
            ) : (
              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
                {(
                  [
                    ["Pitch F0", metricsA?.f0Hz ?? 0, metricsB?.f0Hz ?? 0, 400, "Hz"],
                    ["Formant F1", metricsA?.f1 ?? 0, metricsB?.f1 ?? 0, 1000, "Hz"],
                    ["Formant F2", metricsA?.f2 ?? 0, metricsB?.f2 ?? 0, 2800, "Hz"],
                    ["Target Match", metricsA?.score ?? 0, metricsB?.score ?? 0, 100, "%"],
                  ] as const
                ).map(([label, aVal, bVal, scaleMax, unit]) => {
                  const fmt = (v: number) => (v > 0 ? `${Math.round(v)} ${unit}` : "—");
                  const pctA = Math.min(100, Math.max(0, (aVal / scaleMax) * 100));
                  const pctB = Math.min(100, Math.max(0, (bVal / scaleMax) * 100));
                  const hasBoth = aVal > 0 && bVal > 0 && takeA && takeB;
                  return (
                    <div key={label} className="bg-surface px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="ui-label text-[11.5px]">{label}</span>
                        {hasBoth && (
                          <span className="ui-fig text-[11.5px] font-semibold text-accent">
                            {formatDelta(aVal, bVal, 0, unit)}
                          </span>
                        )}
                      </div>
                      <div className="ui-fig mt-1 flex items-baseline justify-between gap-2">
                        <span className="text-[16px] font-semibold text-ink">{takeB ? fmt(bVal) : "—"}</span>
                        <span className="text-[11.5px] text-muted">{takeA ? `A: ${fmt(aVal)}` : ""}</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-raised">
                          <div
                            className="h-full rounded-full bg-lpc transition-[width] duration-500 ease-(--ease-out)"
                            style={{ width: `${pctA}%` }}
                          />
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-raised">
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-(--ease-out)"
                            style={{ width: `${pctB}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Focused View Switcher Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-1">
            <div role="tablist" aria-label="Comparison view" className="flex gap-6">
              {(
                [
                  ["morph3d", "3D Morph & Trajectory"],
                  ["spectra", "Spectrum & Poles"],
                  ["notes", "Waveform & Notes"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={compareTab === id}
                  onClick={() => setCompareTab(id)}
                  className="ui-tab min-h-10 text-[13.5px] font-medium"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* TAB 1: Interactive 3D A <-> B Morph Stage & Vowel Trajectory */}
          {compareTab === "morph3d" && (
            <div key="morph3d" className="stage-enter flex flex-col gap-3">
              <div className="grid grid-cols-12 gap-4">
                {/* Interactive 3D Stage */}
                <section className="ui-panel col-span-12 flex flex-col md:col-span-7">
                  <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-1.5">
                    <span className="text-[13px] font-medium text-ink">
                      <Prov kind="mapped">3D Acoustic Morph Stage</Prov>
                    </span>
                    <div className="flex items-center gap-2">
                      <InstrumentSelect
                        ariaLabel="3D stage geometry"
                        size="sm"
                        align="right"
                        value={compareShape}
                        options={SHAPE_OPTIONS}
                        onChange={setCompareShape}
                        className="w-[155px]"
                        menuWidthClass="w-[235px]"
                      />
                      {compareShape !== "tract" && (
                        <button
                          type="button"
                          onClick={excitePlate}
                          className="rounded-(--radius-sm) border border-line bg-raised px-2.5 py-1 text-[12px] font-medium text-ink transition-transform hover:border-accent active:scale-95"
                        >
                          Tap
                        </button>
                      )}
                    </div>
                  </header>

                  <PlateStage
                    interactive
                    showNodalLines
                    shapeModel={compareShape}
                    frame={stageTelemetryFor3D}
                    className="min-h-[320px] w-full flex-1"
                  />

                  {/* Animated A <-> B Crossfade Morph Controller */}
                  {slotBMode === "saved" && frameA && frameB ? (
                    <div className="flex flex-wrap items-center gap-3 border-t border-line bg-raised/40 px-3.5 py-2.5 text-[12px]">
                      <button
                        type="button"
                        aria-pressed={autoMorph}
                        onClick={() => setAutoMorph((p) => !p)}
                        className={`rounded-(--radius-sm) border px-2.5 py-1 font-semibold transition-colors ${autoMorph
                          ? "border-accent bg-accent text-accent-ink"
                          : "border-line bg-surface text-ink hover:border-accent"
                          }`}
                      >
                        {autoMorph ? "⟳ Auto-morphing A ↔ B" : "▶ Auto-morph"}
                      </button>
                      <span className="ui-fig font-semibold text-lpc">A</span>
                      <input
                        type="range"
                        aria-label="Morph between Reference A and Take B"
                        min={0}
                        max={1}
                        step={0.01}
                        value={morphMix}
                        onChange={(e) => {
                          setAutoMorph(false);
                          setMorphMix(Number(e.target.value));
                        }}
                        className="ui-slider flex-1"
                      />
                      <span className="ui-fig font-semibold text-accent">B</span>
                      <span className="ui-fig w-[5ch] text-right text-muted">{Math.round(morphMix * 100)}%</span>
                    </div>
                  ) : (
                    <p className="border-t border-line px-3.5 py-2 text-[12px] text-muted">
                      Drag to orbit in 3D · Scroll to zoom · Click plate to scatter sand grains.
                    </p>
                  )}
                </section>

                {/* Vowel Space Trajectory Chart */}
                <section className="ui-panel col-span-12 flex flex-col md:col-span-5">
                  <header className="flex min-h-11 items-center justify-between border-b border-line px-3.5 text-[13px]">
                    <span className="font-medium text-ink">
                      <Prov kind="derived">Vowel Trajectory (A → B)</Prov>
                    </span>
                    <span className="ui-fig text-[12px] text-muted">F1 × F2</span>
                  </header>
                  <Trace
                    kind="vowel"
                    inspect
                    compareBaseline
                    frame={slotBMode === "saved" ? (morphedFrame ?? frameB) : null}
                    baselineFrame={frameA}
                    targetVowel={activeTargetVowel}
                    label="Vowel chart comparing Reference Take A against Active Take B with live morphing position"
                    className="min-h-[320px] w-full flex-1"
                  />
                  <p className="border-t border-line px-3.5 py-2.5 text-[12px] text-muted">
                    Cyan ring marks Reference A; orange dot tracks {autoMorph && frameA && frameB ? "the live A ↔ B morph" : "Active B"}.
                  </p>
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: Spectrum & Z-Plane Poles + Timeline Scrubbers */}
          {compareTab === "spectra" && (
            <div key="spectra" className="stage-enter flex flex-col gap-3">
              {((takeA && takeA.durationSec > 0.2) || (slotBMode === "saved" && takeB && takeB.durationSec > 0.2)) && (
                <div className="ui-panel grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2">
                  {takeA && (
                    <div className="flex items-center gap-2.5 text-[12px]">
                      <span className="shrink-0 font-semibold text-lpc">Scrub A</span>
                      <input
                        type="range"
                        min={0.08}
                        max={takeA.durationSec}
                        step={0.02}
                        value={scrubASec ?? takeA.representativeFrame.timestampMs / 1000}
                        onChange={(e) => setScrubASec(Number(e.target.value))}
                        className="ui-slider flex-1"
                      />
                      <span className="ui-fig w-[6ch] text-right text-muted">
                        {(scrubASec ?? takeA.representativeFrame.timestampMs / 1000).toFixed(2)}s
                      </span>
                    </div>
                  )}
                  {slotBMode === "saved" && takeB && (
                    <div className="flex items-center gap-2.5 text-[12px]">
                      <span className="shrink-0 font-semibold text-accent">Scrub B</span>
                      <input
                        type="range"
                        min={0.08}
                        max={takeB.durationSec}
                        step={0.02}
                        value={scrubBSec ?? takeB.representativeFrame.timestampMs / 1000}
                        onChange={(e) => setScrubBSec(Number(e.target.value))}
                        className="ui-slider flex-1"
                      />
                      <span className="ui-fig w-[6ch] text-right text-muted">
                        {(scrubBSec ?? takeB.representativeFrame.timestampMs / 1000).toFixed(2)}s
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-12 gap-4">
                <section className="ui-panel col-span-12 flex flex-col md:col-span-7">
                  <header className="flex min-h-10 items-center justify-between border-b border-line px-3.5 text-[12.5px]">
                    <span className="font-medium text-ink">
                      <Prov kind="derived">Spectrum &amp; LPC Envelope Overlay</Prov>
                    </span>
                    <span className="ui-fig text-muted">Dashed A · Solid B</span>
                  </header>
                  <Trace
                    kind="spectrum"
                    inspect
                    compareBaseline
                    frame={frameB}
                    baselineFrame={frameA}
                    targetVowel={activeTargetVowel}
                    label="Overlaid Fourier spectra and LPC envelopes of Reference Take A and Active Take B"
                    className="h-[300px] w-full"
                  />
                </section>

                <section className="ui-panel col-span-12 flex flex-col md:col-span-5">
                  <header className="flex min-h-10 items-center justify-between border-b border-line px-3.5 text-[12.5px]">
                    <span className="font-medium text-ink">
                      <Prov kind="derived">Z-Plane Pole Shift</Prov>
                    </span>
                    <span className="ui-fig text-muted">Rings A · × B</span>
                  </header>
                  <Trace
                    kind="zplane"
                    inspect
                    compareBaseline
                    frame={frameB}
                    baselineFrame={frameA}
                    targetVowel={activeTargetVowel}
                    label="Z-plane unit circle comparing pole radii and frequencies between Take A and Take B"
                    className="h-[300px] w-full"
                  />
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: Windowed Waveform & Side-by-Side Notes */}
          {compareTab === "notes" && (
            <div key="notes" className="stage-enter flex flex-col gap-4">
              <section className="ui-panel flex flex-col">
                <header className="flex min-h-10 items-center justify-between border-b border-line px-3.5 text-[12.5px]">
                  <span className="font-medium text-ink">
                    <Prov kind="measured">Windowed Frame Waveform</Prov>
                  </span>
                  <span className="ui-fig text-muted">x[n] · w[n]</span>
                </header>
                <Trace
                  kind="scope"
                  inspect
                  compareBaseline
                  frame={frameB}
                  baselineFrame={frameA}
                  targetVowel={activeTargetVowel}
                  label="Time-domain windowed waveform scope comparing Take A and Take B"
                  className="h-[220px] w-full"
                />
              </section>

              <section className="ui-panel p-4">
                <h2 className="text-[13.5px] font-semibold text-ink">Side-by-side observation notes</h2>
                <div className="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="rounded-(--radius-sm) border border-line bg-raised/40 p-3.5">
                    <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                      <span className="font-semibold text-lpc">REFERENCE A</span>
                      <span className="truncate text-muted">{takeA ? takeA.title : "None pinned"}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                      {takeA?.notes?.trim() ? takeA.notes : "No written notes for Reference A yet."}
                    </p>
                  </div>

                  <div className="rounded-(--radius-sm) border border-line bg-raised/40 p-3.5">
                    <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                      <span className="font-semibold text-accent">ACTIVE B</span>
                      <span className="truncate text-muted">
                        {slotBMode === "saved"
                          ? (takeB?.title ?? "None loaded")
                          : slotBMode === "mic"
                            ? "Live microphone"
                            : "Built-in synth"}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                      {slotBMode === "saved"
                        ? takeB?.notes?.trim()
                          ? takeB.notes
                          : "No written notes for Take B yet."
                        : "Speak or play a live note and click Record above to save it with annotations."}
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
