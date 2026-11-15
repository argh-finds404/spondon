"use client";

import { useEffect, useRef } from "react";
import { labRuntime, useLabStore } from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";
import { createDrawState, DRAW, pickVowel, type TraceKind } from "./draw";

interface TraceProps {
  kind: TraceKind;
  /** What the picture shows, for people who cannot see it. */
  label: string;
  className?: string;
  /** No axes or tick labels. */
  bare?: boolean;
  /** Show a readout under the pointer. */
  inspect?: boolean;
  /** Overlay the original frozen baseline telemetry when frozen parameters are modified. */
  compareBaseline?: boolean;
  /** Vowel chart only: called with the target under a click. */
  onPick?: (vowelId: string) => void;
}

/**
 * One live canvas of the instrument. It draws from the shared telemetry object on the
 * engine's own animation frame, only while it is on screen, and never touches React state.
 */
export function Trace({ kind, label, className, bare = false, inspect = false, compareBaseline = false, onPick }: TraceProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HTMLOutputElement>(null);
  const stateRef = useRef(createDrawState());
  const kindRef = useRef(kind);
  const compareRef = useRef(compareBaseline);
  const targetId = useLabStore((s) => s.targetId);
  const frozen = useLabStore((s) => s.frozen);
  const recomputeCount = useLabStore((s) => s.recomputeCount);

  useEffect(() => {
    kindRef.current = kind;
    compareRef.current = compareBaseline;
    stateRef.current.bare = bare;
    stateRef.current.targetId = targetId;
    stateRef.current.baseline =
      compareBaseline && frozen && recomputeCount > 0 ? labRuntime.getBaselineTelemetry() : null;
  }, [kind, bare, targetId, compareBaseline, frozen, recomputeCount]);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!box || !canvas || !ctx) return;
    const s = stateRef.current;
    s.trail = labRuntime.trail;
    let dpr = 1;
    let shownHover = "";

    const family = getComputedStyle(canvas).fontFamily;
    s.font = `11px ${family}`;
    s.fontStrong = `600 11px ${family}`;
    s.fontGlyph = `500 16px ${family}`;
    // Canvas text does not make the browser fetch a web font; ask for the Bangla glyphs once.
    void document.fonts?.load(s.fontGlyph, "আ");

    const draw = (t: DSPFrameTelemetry) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.w, s.h);
      DRAW[kindRef.current](ctx, s, t);
      const out = hoverRef.current;
      if (out && s.hover !== shownHover) {
        shownHover = s.hover;
        out.textContent = shownHover;
      }
    };

    const resize = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      s.w = Math.max(40, Math.floor(rect.width));
      s.h = Math.max(24, Math.floor(rect.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(s.w * dpr);
      canvas.height = Math.round(s.h * dpr);
      draw(labRuntime.getActiveTelemetry());
    });
    resize.observe(box);

    let unsubscribe: (() => void) | null = null;
    const visibility = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !unsubscribe) unsubscribe = labRuntime.subscribe(draw);
      else if (!entry.isIntersecting && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    });
    visibility.observe(box);

    return () => {
      resize.disconnect();
      visibility.disconnect();
      unsubscribe?.();
    };
  }, []);

  const track = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    stateRef.current.px = e.clientX - rect.left;
    stateRef.current.py = e.clientY - rect.top;
  };
  const untrack = () => {
    stateRef.current.px = -1;
    stateRef.current.py = -1;
  };

  return (
    <div ref={boxRef} className={`relative ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`absolute inset-0 h-full w-full ${onPick ? "cursor-pointer" : inspect ? "cursor-crosshair" : ""}`}
        onPointerMove={inspect ? track : undefined}
        onPointerLeave={inspect ? untrack : undefined}
        onClick={
          onPick
            ? (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const id = pickVowel(stateRef.current, e.clientX - rect.left, e.clientY - rect.top);
                if (id) onPick(id);
              }
            : undefined
        }
      />
      {inspect && (
        <output
          ref={hoverRef}
          className="ui-fig pointer-events-none absolute right-2 top-1 bg-surface px-1 text-[11px] text-ink empty:hidden"
        />
      )}
    </div>
  );
}
