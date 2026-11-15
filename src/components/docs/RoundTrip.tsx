"use client";

import { useEffect, useState } from "react";
import { VOWEL_TARGETS } from "@/lib/dsp/vowel-targets";

interface Summary {
  voicedFraction: number;
  f0Hz: number;
  f1Hz: number;
  f2Hz: number;
  f3Hz: number;
  jitterPercent: number;
  shimmerDb: number;
  nearestVowel: string | null;
  target?: { id: string; distanceBark: number; convergenceScore: number };
}

type Run =
  | { state: "idle" }
  | { state: "running" }
  | { state: "failed"; message: string }
  | { state: "done"; summary: Summary; frames: number; bytes: number; synthMs: number; analyzeMs: number; url: string };

const PITCHES = [100, 140, 180, 220, 260];

/**
 * The API, used: ask /api/synth for a vowel, post the file straight to /api/analyze,
 * and show what came back. Both calls go to this site and nothing else.
 */
export function RoundTrip() {
  const [vowel, setVowel] = useState("ii");
  const [f0, setF0] = useState(180);
  const [run, setRun] = useState<Run>({ state: "idle" });
  const url = run.state === "done" ? run.url : null;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const go = async () => {
    setRun({ state: "running" });
    try {
      const t0 = performance.now();
      const wav = await fetch(`/api/synth?vowel=${vowel}&f0=${f0}&duration=1&rate=16000`);
      if (!wav.ok) throw new Error((await wav.json()).error);
      const blob = await wav.blob();
      const t1 = performance.now();
      const res = await fetch(`/api/analyze?target=${vowel}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: blob,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setRun({
        state: "done",
        summary: body.summary,
        frames: body.frames.length,
        bytes: blob.size,
        synthMs: t1 - t0,
        analyzeMs: performance.now() - t1,
        url: URL.createObjectURL(blob),
      });
    } catch (error) {
      setRun({ state: "failed", message: error instanceof Error ? error.message : "The request failed." });
    }
  };

  const nearest = run.state === "done" ? VOWEL_TARGETS.find((v) => v.id === run.summary.nearestVowel) : undefined;
  const rows: [string, string][] =
    run.state === "done"
      ? [
          ["Sent", `${run.bytes.toLocaleString("en-US")} bytes of WAV`],
          ["Frames back", `${run.frames}, one every 10 ms`],
          ["Pitch", `${run.summary.f0Hz} Hz`],
          ["F1, F2, F3", `${run.summary.f1Hz}, ${run.summary.f2Hz}, ${run.summary.f3Hz} Hz`],
          ["Nearest vowel", nearest ? `${nearest.banglaSymbol ?? ""} /${nearest.symbol}/`.trim() : "none"],
          ["From target", run.summary.target ? `${run.summary.target.distanceBark} Bark` : "none"],
          ["Time", `${Math.round(run.synthMs)} ms to synthesise, ${Math.round(run.analyzeMs)} ms to analyse`],
        ]
      : [];

  return (
    <div data-ui className="ui-panel">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line p-3">
        <label className="block">
          <span className="ui-label block">Vowel</span>
          <select
            value={vowel}
            onChange={(e) => setVowel(e.target.value)}
            className="bn mt-1 h-9 min-w-[9rem] rounded-(--radius) border border-control bg-raised px-2 text-[14px] text-ink"
          >
            {VOWEL_TARGETS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.banglaSymbol ? `${v.banglaSymbol}  /${v.symbol}/` : `/${v.symbol}/`}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="ui-label block">Pitch</span>
          <select
            value={f0}
            onChange={(e) => setF0(Number(e.target.value))}
            className="ui-fig mt-1 h-9 rounded-(--radius) border border-control bg-raised px-2 text-[13px] text-ink"
          >
            {PITCHES.map((p) => (
              <option key={p} value={p}>
                {p} Hz
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn min-h-9!" disabled={run.state === "running"} onClick={() => void go()}>
          {run.state === "running" ? "Running" : "Synthesise, then analyse"}
        </button>
      </div>

      <div className="min-h-[236px] p-3" aria-live="polite">
        {run.state === "idle" && (
          <p className="text-muted">
            Run it: the page asks <code>/api/synth</code> for one second of the vowel, posts that file to{" "}
            <code>/api/analyze</code>, and shows what the analyser found.
          </p>
        )}
        {run.state === "running" && <p className="text-muted">Synthesising and analysing.</p>}
        {run.state === "failed" && <p role="alert" className="text-ink">{run.message}</p>}
        {run.state === "done" && (
          <>
            <dl>
              {rows.map(([label, value]) => (
                <div key={label} className="flex min-h-7 items-center justify-between gap-6">
                  <dt className="ui-label">{label}</dt>
                  <dd className="ui-fig text-right text-[13px] text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <audio controls src={run.url} className="mt-3 h-9 w-full" aria-label="The synthesised vowel" />
          </>
        )}
      </div>
    </div>
  );
}
