"use client";

import { useEffect, useRef, useState } from "react";

/** Plays one synthetic vowel from /api/synth: a 1.2 s file, the same voice the lab analyses. */
export function HearButton({ vowelId, label, className }: { vowelId: string; label: string; className?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");

  useEffect(() => () => audio.current?.pause(), []);

  return (
    <button
      type="button"
      className={className ?? "btn btn-quiet"}
      aria-label={label}
      onClick={() => {
        audio.current?.pause();
        const el = new Audio(`/api/synth?vowel=${vowelId}&f0=140&duration=1.2&rate=24000`);
        audio.current = el;
        el.onended = () => setState("idle");
        el.onerror = () => setState("failed");
        setState("playing");
        el.play().catch(() => setState("failed"));
      }}
    >
      {state === "playing" ? "Playing" : state === "failed" ? "Could not play" : "Hear it"}
    </button>
  );
}
