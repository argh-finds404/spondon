"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prov } from "@/components/instrument/controls";
import { Trace } from "@/components/instrument/Trace";
import { analyzeTakeAtTime, ingestAudioFileOrBuffer, telemetryFromSavedTake } from "@/lib/dsp/file-ingest";
import { synthesizeVoice } from "@/lib/dsp/synth";
import { findVowel, nearestVowel, VOWEL_TARGETS, vowelGlyph } from "@/lib/dsp/vowel-targets";
import { decodeWav } from "@/lib/dsp/wav";
import {
  deleteTake,
  exportTakeBundleJson,
  importTakeBundleJson,
  listTakes,
  saveTake,
  updateTakeNotes,
  type SavedTake,
  type TakeSourceType,
} from "@/lib/storage/takes-vault";
import { labRuntime, useLabStore } from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";

type SlotBMode = "saved" | "mic" | "synth";
type SourceFilter = "all" | TakeSourceType;

const REC_DURATIONS = [3, 5, 10, 15] as const;

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

/**
 * Live 10 Hz DOM-ref comparison delta strip used when Slot B is Live Microphone or Built-in Synth,
 * ensuring zero React re-renders per audio frame while tracking changes against Pinned Reference A.
 */
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
  const f3Ref = useRef<HTMLSpanElement>(null);
  const barkRef = useRef<HTMLSpanElement>(null);
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
      setCell(f3Ref.current, b.f3, refA?.f3, " Hz");
      setCell(barkRef.current, b.bark, refA?.bark, " Bark", 2);
      setCell(scoreRef.current, b.score, refA?.score, " / 100");
      if (vowelRef.current) {
        if (t.voiced && t.formants.f1 > 0 && t.formants.f2 > 0) {
          const detected = nearestVowel(t.formants.f1, t.formants.f2);
          vowelRef.current.textContent = `${vowelGlyph(detected)} /${detected.symbol}/`;
        } else {
          const tgt = findVowel(targetVowelId);
          vowelRef.current.textContent = `Waiting (${vowelGlyph(tgt)} /${tgt.symbol}/)`;
        }
      }
    });
  }, [refA, targetVowelId]);

  return (
    <div data-ui className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4 lg:grid-cols-7">
      {[
        { label: "Live F0", ref: f0Ref },
        { label: "Live F1", ref: f1Ref },
        { label: "Live F2", ref: f2Ref },
        { label: "Live F3", ref: f3Ref },
        { label: "Bark", ref: barkRef },
        { label: "Match", ref: scoreRef },
        { label: "Detected", ref: vowelRef },
      ].map((item) => (
        <div key={item.label} className="bg-surface px-3 py-2">
          <div className="ui-label text-[11px]">{item.label}</div>
          <span ref={item.ref} className="ui-fig mt-0.5 block text-[13px] font-medium text-ink">
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
  const [expanded, setExpanded] = useState(isA || isB);
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
      className={`ui-panel flex flex-col transition-colors ${
        isA && isB
          ? "border-accent"
          : isA
            ? "border-lpc"
            : isB
              ? "border-ink"
              : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-line bg-raised/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-surface px-1.5 py-0.5 font-semibold tracking-wide text-muted uppercase">
              {take.sourceType}
            </span>
            {isA && (
              <span className="rounded bg-lpc px-1.5 py-0.5 font-semibold text-bg">REF A (GHOST)</span>
            )}
            {isB && (
              <span className="rounded bg-accent px-1.5 py-0.5 font-semibold text-accent-ink">ACTIVE B</span>
            )}
            <span className="ui-fig text-muted">{take.durationSec.toFixed(1)}s</span>
            <span className="text-muted">· {formatTimeStamp(take.createdAt)}</span>
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
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="mt-1.5 w-full rounded-(--radius-sm) border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-semibold text-ink transition-colors hover:border-line focus:border-accent focus:bg-surface focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span lang={vowelObj.banglaSymbol ? "bn" : undefined} className="bn text-[22px] leading-none text-ink">
            {vowelGlyph(vowelObj)}
          </span>
          <span className="ui-fig mt-0.5 text-[11px] text-muted">/{vowelObj.symbol}/</span>
        </div>
      </div>

      {/* Measured summary row */}
      <dl className="grid grid-cols-4 divide-x divide-line border-b border-line bg-surface text-[12px]">
        <div className="px-2.5 py-1.5">
          <dt className="ui-label text-[10px]">F0</dt>
          <dd className="ui-fig text-ink">{take.summary.f0Hz > 0 ? `${Math.round(take.summary.f0Hz)} Hz` : "—"}</dd>
        </div>
        <div className="px-2.5 py-1.5">
          <dt className="ui-label text-[10px]">F1</dt>
          <dd className="ui-fig text-ink">{take.summary.f1Hz > 0 ? `${take.summary.f1Hz} Hz` : "—"}</dd>
        </div>
        <div className="px-2.5 py-1.5">
          <dt className="ui-label text-[10px]">F2</dt>
          <dd className="ui-fig text-ink">{take.summary.f2Hz > 0 ? `${take.summary.f2Hz} Hz` : "—"}</dd>
        </div>
        <div className="px-2.5 py-1.5">
          <dt className="ui-label text-[10px]">Match</dt>
          <dd className="ui-fig text-ink">{Math.round(take.summary.convergenceScore)}%</dd>
        </div>
      </dl>

      {/* Compare & Audio Actions */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={() => onPinA(take)}
          aria-pressed={isA}
          className={`rounded-(--radius-sm) border px-2.5 py-1 text-[12px] font-medium transition-colors ${
            isA
              ? "border-lpc bg-lpc text-bg font-semibold"
              : "border-line bg-raised text-ink hover:border-lpc"
          }`}
        >
          {isA ? "✓ Pinned A" : "Pin as A"}
        </button>
        <button
          type="button"
          onClick={() => onLoadB(take)}
          aria-pressed={isB}
          className={`rounded-(--radius-sm) border px-2.5 py-1 text-[12px] font-medium transition-colors ${
            isB
              ? "border-accent bg-accent text-accent-ink font-semibold"
              : "border-line bg-raised text-ink hover:border-accent"
          }`}
        >
          {isB ? "✓ Active B" : "Load as B"}
        </button>
        <button
          type="button"
          onClick={() => onPlayToggle(take)}
          className="rounded-(--radius-sm) border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink hover:border-ink"
        >
          {isPlaying ? "■ Stop" : "▶ Play"}
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto rounded-(--radius-sm) px-2 py-1 text-[12px] font-medium text-muted hover:text-ink"
        >
          {expanded ? "Hide notes" : notes.trim() ? "Notes ●" : "Add notes"}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-line bg-raised/35 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
            <label htmlFor={`note-${take.id}`}>Lab &amp; pronunciation notes</label>
            <span className="ui-fig text-lock">{dirty ? "Unsaved edits" : saveHint ?? "IndexedDB synced"}</span>
          </div>
          <textarea
            id={`note-${take.id}`}
            rows={3}
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
                onClick={() => downloadBlob(new Blob([new Uint8Array(take.wavBytes)], { type: "audio/wav" }), `${slugify(title)}.wav`)}
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
              <button
                type="button"
                onClick={() => {
                  void commitNotes();
                }}
                disabled={!dirty}
                className="rounded-(--radius-sm) border border-line bg-surface px-2 py-1 text-[11px] font-medium text-accent disabled:opacity-40"
              >
                Save note
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
      )}
    </article>
  );
}

/**
 * Dedicated local-first Takes Vault, Audio File Uploader, Notes & A/B Acoustic Comparison Studio.
 * Keeps 100% of audio, recordings, and notes in the visitor's own IndexedDB database.
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

  const [scrubASec, setScrubASec] = useState<number | null>(null);
  const [scrubBSec, setScrubBSec] = useState<number | null>(null);

  const [recDuration, setRecDuration] = useState<(typeof REC_DURATIONS)[number]>(5);
  const [targetVowelChoice, setTargetVowelChoice] = useState<string>("auto");
  const [synthVowelChoice, setSynthVowelChoice] = useState<string>("aa");
  const [filterSource, setFilterSource] = useState<SourceFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null);
  const [sequencePlaying, setSequencePlaying] = useState(false);

  const isRecordingClip = useLabStore((s) => s.isRecordingClip);
  const recordingProgress = useLabStore((s) => s.recordingProgress);

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

  // Drive recording VU bar via DOM ref without triggering React re-renders
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
      setErrorMsg(err instanceof Error ? err.message : "Could not decode uploaded audio file.");
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
    const ctrl = labRuntime.getController();
    ctrl?.stopRecordingClip();
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
        title: `Studio reference · ${vowelGlyph(v)} /${v.symbol}/`,
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
      const takeA = await ingestAudioFileOrBuffer({ pcm: pcmA, sampleRate: 48000 }, aa.id, {
        title: `Sample Reference A · ${vowelGlyph(aa)} /${aa.symbol}/`,
        notes: "Open low-back vowel baseline (high F1 ~750 Hz, low F2 ~1180 Hz).",
        sourceType: "synth",
      });
      const takeB = await ingestAudioFileOrBuffer({ pcm: pcmB, sampleRate: 48000 }, ii.id, {
        title: `Sample Take B · ${vowelGlyph(ii)} /${ii.symbol}/`,
        notes: "High-front vowel comparison (low F1 ~310 Hz, high F2 ~2320 Hz).",
        sourceType: "synth",
      });
      await saveTake(takeA);
      await saveTake(takeB);
      const items = await listTakes();
      setTakes(items);
      setTakeAId(takeA.id);
      setTakeBId(takeB.id);
      setSlotBMode("saved");
      setScrubASec(null);
      setScrubBSec(null);
      setStatusMsg("Created /aa/ vs /ii/ synthetic starter pair in IndexedDB.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not create starter pair.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleDeleteTake = async (id: string) => {
    if (playingTakeId === id) stopPlayback();
    await deleteTake(id);
    const items = await listTakes();
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
    const updated = await updateTakeNotes(id, title, notes);
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
    if (scrubASec !== null) return analyzeTakeAtTime(takeA, scrubASec);
    return telemetryFromSavedTake(takeA);
  }, [takeA, scrubASec]);

  const frameB = useMemo<DSPFrameTelemetry | null>(() => {
    if (slotBMode !== "saved" || !takeB) return null;
    if (scrubBSec !== null) return analyzeTakeAtTime(takeB, scrubBSec);
    return telemetryFromSavedTake(takeB);
  }, [slotBMode, takeB, scrubBSec]);

  const activeTargetVowel =
    (slotBMode === "saved" ? takeB?.targetVowel ?? takeB?.summary.nearestVowel : null) ??
    takeA?.targetVowel ??
    takeA?.summary.nearestVowel ??
    "aa";

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

  return (
    <main id="content" className="wrap min-h-svh pt-(--nav-h) pb-12 text-[14px] leading-[1.4]">
      {/* Page Header */}
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line py-5">
        <div className="max-w-[64ch]">
          <p className="ui-label flex items-center gap-2 text-[12px]">
            <Prov kind="measured">Local IndexedDB vault · zero server uploads</Prov>
          </p>
          <h1 className="mt-1.5 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-ink">
            Takes, notes &amp; A/B compare
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Record voice notes, drop in any audio file, annotate observations, and overlay Reference A against Take B
            or your live microphone without cluttering the live lab.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/lab" className="btn btn-quiet btn-sm">
            Open live lab
          </Link>
        </div>
      </header>

      {/* Capture & Ingest Toolbar */}
      <section
        aria-label="Capture or import audio takes"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) {
            void handleUploadFiles(e.dataTransfer.files);
          }
        }}
        className={`ui-panel mt-4 p-3.5 transition-colors ${
          dragOver ? "border-accent bg-raised" : "border-line bg-surface"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Mic Recorder Group */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div role="group" aria-label="Max recording duration" className="seg">
              {REC_DURATIONS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  disabled={isRecordingClip}
                  aria-pressed={recDuration === sec}
                  onClick={() => setRecDuration(sec)}
                >
                  {sec}s
                </button>
              ))}
            </div>

            {!isRecordingClip ? (
              <button
                type="button"
                onClick={() => void handleStartRecording()}
                disabled={Boolean(busyMessage)}
                className="btn btn-sm"
              >
                ● Record mic ({recDuration}s)
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopRecordingEarly}
                className="btn btn-sm animate-pulse"
              >
                ■ Stop &amp; save ({(recordingProgress * recDuration).toFixed(1)}s)
              </button>
            )}
          </div>

          {/* File Upload, Target Selection & Portable Bundle Import */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <span>Target:</span>
              <select
                value={targetVowelChoice}
                onChange={(e) => setTargetVowelChoice(e.target.value)}
                className="h-9 rounded-(--radius-sm) border border-line bg-raised px-2.5 text-[13px] text-ink"
              >
                <option value="auto">Auto-detect vowel</option>
                {VOWEL_TARGETS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {vowelGlyph(v)} /{v.symbol}/ ({v.label})
                  </option>
                ))}
              </select>
            </label>

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
              ↑ Upload audio file
            </button>

            <div className="flex items-center gap-1">
              <select
                aria-label="Synthetic reference vowel"
                value={synthVowelChoice}
                onChange={(e) => setSynthVowelChoice(e.target.value)}
                className="h-9 rounded-(--radius-sm) border border-line bg-raised px-2 text-[13px] text-ink"
              >
                {VOWEL_TARGETS.map((v) => (
                  <option key={v.id} value={v.id}>
                    Synth {vowelGlyph(v)} /{v.symbol}/
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={Boolean(busyMessage)}
                onClick={() => void handleSaveSynthReference(synthVowelChoice)}
                className="btn btn-quiet btn-sm"
              >
                + Save synth
              </button>
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
              className="ui-tab min-h-9 px-2 text-[13px] font-medium"
            >
              ⇄ Import .spondon.json
            </button>
          </div>
        </div>

        {/* Live recording meter */}
        {isRecordingClip && (
          <div className="mt-3 flex items-center gap-3 border-t border-line pt-2.5 text-[12px]">
            <span className="font-semibold text-accent">RECORDING</span>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-(--radius-sm) border border-line bg-raised">
              <div ref={liveVuRef} className="h-full w-[4%] bg-accent transition-[width] duration-75" />
            </div>
            <span className="ui-fig text-muted">{Math.round(recordingProgress * 100)}%</span>
          </div>
        )}

        {(busyMessage || statusMsg || errorMsg || dragOver) && (
          <div className="mt-2.5 border-t border-line pt-2 text-[12px]">
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
      </section>

      {/* Main Split Studio */}
      <div className="mt-4 grid grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN: Saved Takes & Notes Library */}
        <section aria-label="Saved takes and notes" className="col-span-12 flex flex-col gap-3 lg:col-span-5">
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
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter notes or title…"
                className="h-9 min-w-[140px] flex-1 rounded-(--radius-sm) border border-line bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {loading ? (
            <div className="ui-panel p-6 text-center text-muted">Loading local IndexedDB vault…</div>
          ) : filteredTakes.length === 0 ? (
            <div className="ui-panel flex flex-col items-start gap-3 p-5">
              <h2 className="text-[16px] font-semibold text-ink">
                {takes.length === 0 ? "Your vault is empty" : "No matching takes"}
              </h2>
              <p className="text-[13px] text-muted">
                {takes.length === 0
                  ? "Record a microphone clip above, upload any .wav / .mp3 / .m4a file, or generate a synthetic sample pair to start comparing acoustic shifts and pronunciation notes."
                  : "Clear the search box or switch source filter."}
              </p>
              {takes.length === 0 && (
                <button
                  type="button"
                  onClick={() => void handleCreateStarterPair()}
                  disabled={Boolean(busyMessage)}
                  className="btn btn-sm"
                >
                  Generate /aa/ vs /ii/ starter pair
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
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

        {/* RIGHT COLUMN: A vs B Acoustic Comparison Stage */}
        <section aria-label="A versus B acoustic comparison" className="col-span-12 flex flex-col gap-3 lg:col-span-7">
          {/* Slot Control Bar */}
          <div className="ui-panel p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-lpc" aria-hidden />
                  <strong className="text-ink">Reference A (Ghost):</strong>
                  <span className="text-muted">{takeA ? takeA.title : "None pinned"}</span>
                  {takeA && (
                    <button
                      type="button"
                      onClick={() => {
                        setTakeAId(null);
                        setScrubASec(null);
                      }}
                      className="ml-1 text-muted hover:text-accent"
                    >
                      [Clear]
                    </button>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="Active B source" className="seg">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotBMode === "saved"}
                    onClick={() => void handleSwitchSlotBMode("saved")}
                  >
                    Saved Take B
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotBMode === "mic"}
                    data-hot={slotBMode === "mic"}
                    onClick={() => void handleSwitchSlotBMode("mic")}
                  >
                    Live Mic (B)
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={slotBMode === "synth"}
                    onClick={() => void handleSwitchSlotBMode("synth")}
                  >
                    Live Synth (B)
                  </button>
                </div>

                {takeA && takeB && slotBMode === "saved" && (
                  <button
                    type="button"
                    onClick={() => void handlePlaySequence()}
                    className="btn btn-quiet btn-sm"
                  >
                    {sequencePlaying ? "■ Stop A → B" : "▶ Hear A → B"}
                  </button>
                )}
              </div>
            </div>

            {/* Optional timeline scrubbers when inspecting saved takes */}
            {((takeA && takeA.durationSec > 0.2) || (slotBMode === "saved" && takeB && takeB.durationSec > 0.2)) && (
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-2.5 sm:grid-cols-2">
                {takeA && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="shrink-0 font-medium text-lpc">Time A</span>
                    <input
                      type="range"
                      min={0.08}
                      max={takeA.durationSec}
                      step={0.02}
                      value={scrubASec ?? takeA.representativeFrame.timestampMs / 1000}
                      onChange={(e) => setScrubASec(Number(e.target.value))}
                      className="ui-slider flex-1"
                    />
                    <span className="ui-fig w-[9ch] text-right text-muted">
                      {(scrubASec ?? takeA.representativeFrame.timestampMs / 1000).toFixed(2)}s
                    </span>
                    {scrubASec !== null && (
                      <button
                        type="button"
                        onClick={() => setScrubASec(null)}
                        className="text-[11px] text-lpc hover:underline"
                      >
                        Peak
                      </button>
                    )}
                  </div>
                )}
                {slotBMode === "saved" && takeB && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="shrink-0 font-medium text-accent">Time B</span>
                    <input
                      type="range"
                      min={0.08}
                      max={takeB.durationSec}
                      step={0.02}
                      value={scrubBSec ?? takeB.representativeFrame.timestampMs / 1000}
                      onChange={(e) => setScrubBSec(Number(e.target.value))}
                      className="ui-slider flex-1"
                    />
                    <span className="ui-fig w-[9ch] text-right text-muted">
                      {(scrubBSec ?? takeB.representativeFrame.timestampMs / 1000).toFixed(2)}s
                    </span>
                    {scrubBSec !== null && (
                      <button
                        type="button"
                        onClick={() => setScrubBSec(null)}
                        className="text-[11px] text-accent hover:underline"
                      >
                        Peak
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Numeric A vs B Delta Scorecard */}
          <div className="ui-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-raised px-3 py-2 text-[12px]">
              <span className="font-semibold text-ink">
                <Prov kind="derived">Measured acoustic diff (A vs B)</Prov>
              </span>
              <span className="ui-fig text-muted">
                {slotBMode === "saved"
                  ? `${takeA ? takeA.title : "No Ref A"}  vs.  ${takeB ? takeB.title : "No Take B"}`
                  : `${takeA ? takeA.title : "No Ref A"}  vs.  Live ${slotBMode === "mic" ? "Microphone" : "Synth"}`}
              </span>
            </div>

            {slotBMode !== "saved" ? (
              <LiveSlotBDeltaStrip refA={metricsA} targetVowelId={activeTargetVowel} />
            ) : (
              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4 lg:grid-cols-7">
                {(
                  [
                    ["F0", metricsA?.f0Hz ?? 0, metricsB?.f0Hz ?? 0, 0, "Hz"],
                    ["F1", metricsA?.f1 ?? 0, metricsB?.f1 ?? 0, 0, "Hz"],
                    ["F2", metricsA?.f2 ?? 0, metricsB?.f2 ?? 0, 0, "Hz"],
                    ["F3", metricsA?.f3 ?? 0, metricsB?.f3 ?? 0, 0, "Hz"],
                    ["Bark dist.", metricsA?.bark ?? 0, metricsB?.bark ?? 0, 2, ""],
                    ["Jitter", metricsA?.jitter ?? 0, metricsB?.jitter ?? 0, 2, "%"],
                    ["Match", metricsA?.score ?? 0, metricsB?.score ?? 0, 0, "%"],
                  ] as const
                ).map(([label, aVal, bVal, dec, unit]) => {
                  const fmt = (v: number) =>
                    v > 0 ? `${dec > 0 ? v.toFixed(dec) : Math.round(v)}${unit ? ` ${unit}` : ""}` : "—";
                  const showDelta = aVal > 0 && bVal > 0 && takeA && takeB;
                  return (
                    <div key={label} className="bg-surface px-3 py-2">
                      <div className="ui-label text-[11px]">{label}</div>
                      <div className="ui-fig mt-0.5 text-[13px] font-semibold text-ink">
                        {takeB ? fmt(bVal) : "—"}
                      </div>
                      <div className="ui-fig mt-0.5 text-[11px] text-muted">
                        {takeA ? `A: ${fmt(aVal)}` : "No Ref A"}
                      </div>
                      {showDelta && (
                        <div className="ui-fig mt-0.5 text-[11px] font-medium text-accent">
                          Δ {formatDelta(aVal, bVal, dec, unit)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2x2 Overlaid Acoustic Plots */}
          <div className="grid grid-cols-12 gap-3">
            <section className="ui-panel col-span-12 flex flex-col md:col-span-6">
              <header className="flex min-h-9 items-center justify-between border-b border-line px-3 text-[12px]">
                <span className="font-medium text-ink">
                  <Prov kind="derived">Vowel trajectory (A → B)</Prov>
                </span>
                <span className="ui-fig text-muted">F1 × F2 Bark space</span>
              </header>
              <Trace
                kind="vowel"
                inspect
                compareBaseline
                frame={frameB}
                baselineFrame={frameA}
                targetVowel={activeTargetVowel}
                label="Vowel chart comparing Reference Take A against Active Take B with directional vector arrow"
                className="h-[250px] w-full"
              />
            </section>

            <section className="ui-panel col-span-12 flex flex-col md:col-span-6">
              <header className="flex min-h-9 items-center justify-between border-b border-line px-3 text-[12px]">
                <span className="font-medium text-ink">
                  <Prov kind="derived">Spectrum &amp; LPC overlay</Prov>
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
                className="h-[250px] w-full"
              />
            </section>

            <section className="ui-panel col-span-12 flex flex-col md:col-span-6">
              <header className="flex min-h-9 items-center justify-between border-b border-line px-3 text-[12px]">
                <span className="font-medium text-ink">
                  <Prov kind="derived">Z-plane pole shift</Prov>
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
                className="h-[230px] w-full"
              />
            </section>

            <section className="ui-panel col-span-12 flex flex-col md:col-span-6">
              <header className="flex min-h-9 items-center justify-between border-b border-line px-3 text-[12px]">
                <span className="font-medium text-ink">
                  <Prov kind="measured">Windowed frame waveform</Prov>
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
                className="h-[230px] w-full"
              />
            </section>
          </div>

          {/* Side-by-side Notes Comparison */}
          {(takeA || (slotBMode === "saved" && takeB)) && (
            <section className="ui-panel p-3.5">
              <h2 className="text-[13px] font-semibold text-ink">Side-by-side observation notes</h2>
              <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-(--radius-sm) border border-line bg-raised/40 p-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-lpc">REFERENCE A</span>
                    <span className="truncate text-muted">{takeA ? takeA.title : "None pinned"}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] text-ink">
                    {takeA?.notes?.trim() ? takeA.notes : "No written notes for Reference A yet."}
                  </p>
                </div>

                <div className="rounded-(--radius-sm) border border-line bg-raised/40 p-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-accent">ACTIVE B</span>
                    <span className="truncate text-muted">
                      {slotBMode === "saved"
                        ? (takeB?.title ?? "None loaded")
                        : slotBMode === "mic"
                          ? "Live microphone"
                          : "Built-in synth"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] text-ink">
                    {slotBMode === "saved"
                      ? (takeB?.notes?.trim() ? takeB.notes : "No written notes for Active B yet.")
                      : "Live audio comparing in real time against Reference A."}
                  </p>
                </div>
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
