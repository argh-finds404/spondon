"use client";

import { useEffect, useRef } from "react";
import { subscribeTheme } from "@/lib/theme";
import { labRuntime, useLabStore } from "@/store/lab-store";
import type { DSPFrameTelemetry } from "@/types/dsp";
import { createDrawState, DRAW, pickFormantPole, pickVowel, pointerToPole, type TraceKind } from "./draw";

interface TraceProps {
  kind: TraceKind;
  /** What the picture shows, for people who cannot see it. */
  label: string;
  className?: string;
  /** No axes or tick labels. */
  bare?: boolean;
  /** Show a readout under the pointer. */
  inspect?: boolean;
  /** Overlay the original frozen or experiment baseline telemetry when parameters are modified. */
  compareBaseline?: boolean;
  /** Optional explicit telemetry frame to render instead of the live labRuntime stream (e.g. a saved take). */
  frame?: DSPFrameTelemetry | null;
  /** Optional explicit baseline telemetry frame to overlay when compareBaseline is true. */
  baselineFrame?: DSPFrameTelemetry | null;
  /** Optional vowel target override for static comparison views. */
  targetVowel?: string;
  /** Z-plane only: allow dragging F1 and F2 poles directly inside the unit circle. */
  draggablePoles?: boolean;
  /** Z-plane only: which formant pole is selected for keyboard nudging (1 or 2). */
  selectedPoleFormant?: 1 | 2;
  /** Z-plane only: called when the user selects or grabs F1 or F2. */
  onPoleSelect?: (formant: 1 | 2) => void;
  /** Vowel chart only: called with the target under a click. */
  onPick?: (vowelId: string) => void;
}

/**
 * One live canvas of the instrument. It draws from the shared telemetry object on the
 * engine's own animation frame, only while it is on screen, and never touches React state.
 */
export function Trace({
  kind,
  label,
  className,
  bare = false,
  inspect = false,
  compareBaseline = false,
  frame = null,
  baselineFrame = null,
  targetVowel,
  draggablePoles = false,
  selectedPoleFormant = 1,
  onPoleSelect,
  onPick,
}: TraceProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HTMLOutputElement>(null);
  const stateRef = useRef(createDrawState());
  const kindRef = useRef(kind);
  const compareRef = useRef(compareBaseline);
  const frameRef = useRef<DSPFrameTelemetry | null>(frame);
  const baselineFrameRef = useRef<DSPFrameTelemetry | null>(baselineFrame);
  const drawFnRef = useRef<((t: DSPFrameTelemetry) => void) | null>(null);
  const draggingPoleRef = useRef<1 | 2 | null>(null);
  const targetId = useLabStore((s) => s.targetId);
  const frozen = useLabStore((s) => s.frozen);
  const recomputeCount = useLabStore((s) => s.recomputeCount);
  const baselineVersion = useLabStore((s) => s.baselineVersion);

  useEffect(() => {
    kindRef.current = kind;
    compareRef.current = compareBaseline;
    frameRef.current = frame;
    baselineFrameRef.current = baselineFrame;
    stateRef.current.bare = bare;
    stateRef.current.targetId = targetVowel ?? targetId;
    stateRef.current.trail = frame ? null : labRuntime.trail;
    stateRef.current.draggablePoles = draggablePoles;
    stateRef.current.selectedPoleFormant = selectedPoleFormant;
    const expBase = baselineFrame ?? labRuntime.getExperimentBaseline()?.telemetry ?? null;
    stateRef.current.baseline = compareBaseline
      ? expBase ?? (frozen && recomputeCount > 0 ? labRuntime.getBaselineTelemetry() : null)
      : null;
    drawFnRef.current?.(frame ?? labRuntime.getActiveTelemetry());
  }, [
    kind,
    bare,
    targetId,
    targetVowel,
    compareBaseline,
    frame,
    baselineFrame,
    draggablePoles,
    selectedPoleFormant,
    frozen,
    recomputeCount,
    baselineVersion,
  ]);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!box || !canvas || !ctx) return;
    const s = stateRef.current;
    s.trail = frameRef.current ? null : labRuntime.trail;
    let dpr = 1;
    let shownHover = "";

    const family = getComputedStyle(canvas).fontFamily;
    s.font = `11px ${family}`;
    s.fontStrong = `600 11px ${family}`;
    s.fontGlyph = `500 16px ${family}`;
    // Canvas text does not make the browser fetch a web font; ask for the Bangla glyphs once.
    void document.fonts?.load(s.fontGlyph, "আ");

    const draw = (t: DSPFrameTelemetry) => {
      const targetFrame = frameRef.current ?? t;
      if (compareRef.current) {
        const expBase = baselineFrameRef.current ?? labRuntime.getExperimentBaseline()?.telemetry ?? null;
        const st = useLabStore.getState();
        s.baseline = expBase ?? (st.frozen && st.recomputeCount > 0 ? labRuntime.getBaselineTelemetry() : null);
      } else {
        s.baseline = null;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.w, s.h);
      DRAW[kindRef.current](ctx, s, targetFrame);
      const out = hoverRef.current;
      if (out && s.hover !== shownHover) {
        shownHover = s.hover;
        out.textContent = shownHover;
      }
    };
    drawFnRef.current = draw;

    const resize = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      const cw = box.clientWidth || Math.round(rect.width);
      const ch = box.clientHeight || Math.round(rect.height);
      s.w = Math.max(40, cw);
      s.h = Math.max(24, ch);
      dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
      canvas.width = Math.round(s.w * dpr);
      canvas.height = Math.round(s.h * dpr);
      draw(frameRef.current ?? labRuntime.getActiveTelemetry());
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
    const unsubTheme = subscribeTheme(() => draw(frameRef.current ?? labRuntime.getActiveTelemetry()));

    return () => {
      drawFnRef.current = null;
      unsubTheme();
      resize.disconnect();
      visibility.disconnect();
      unsubscribe?.();
    };
  }, []);

  const toLocal = (e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = rect.width > 0 ? stateRef.current.w / rect.width : 1;
    const scaleY = rect.height > 0 ? stateRef.current.h / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const track = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toLocal(e);
    stateRef.current.px = x;
    stateRef.current.py = y;
    if (draggablePoles && draggingPoleRef.current) {
      const { re, im } = pointerToPole(stateRef.current, x, y);
      labRuntime.setPoleOverride(draggingPoleRef.current, re, im);
    } else if (frameRef.current) {
      drawFnRef.current?.(frameRef.current);
    }
  };
  const untrack = () => {
    stateRef.current.px = -1;
    stateRef.current.py = -1;
    if (frameRef.current) drawFnRef.current?.(frameRef.current);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggablePoles) return;
    const { x, y } = toLocal(e);
    const picked =
      pickFormantPole(stateRef.current, x, y, labRuntime.getActiveTelemetry()) ?? stateRef.current.selectedPoleFormant;
    draggingPoleRef.current = picked;
    stateRef.current.selectedPoleFormant = picked;
    onPoleSelect?.(picked);
    if (!labRuntime.getExperimentBaseline()) {
      useLabStore.getState().captureExperimentBaseline("Natural Pole Baseline");
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore in synthetic test environments without pointer capture
    }
    const { re, im } = pointerToPole(stateRef.current, x, y);
    labRuntime.setPoleOverride(picked, re, im);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggablePoles || !draggingPoleRef.current) return;
    draggingPoleRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!draggablePoles) return;
    if (e.key === "1" || e.key === "2") {
      const f = e.key === "1" ? 1 : 2;
      stateRef.current.selectedPoleFormant = f;
      onPoleSelect?.(f);
      return;
    }
    const f = stateRef.current.selectedPoleFormant;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!labRuntime.getExperimentBaseline()) {
        useLabStore.getState().captureExperimentBaseline("Natural Pole Baseline");
      }
      if (e.key === "ArrowLeft") labRuntime.nudgePoleOverride(f, 0, -35);
      else if (e.key === "ArrowRight") labRuntime.nudgePoleOverride(f, 0, 35);
      else if (e.key === "ArrowUp") labRuntime.nudgePoleOverride(f, 0.012, 0);
      else if (e.key === "ArrowDown") labRuntime.nudgePoleOverride(f, -0.015, 0);
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        role={draggablePoles ? "application" : "img"}
        tabIndex={draggablePoles ? 0 : undefined}
        aria-label={label}
        className={`absolute inset-0 h-full w-full ${
          draggablePoles
            ? "cursor-grab touch-none focus:ring-1 focus:ring-accent focus:outline-none active:cursor-grabbing"
            : onPick
              ? "cursor-pointer"
              : inspect
                ? "cursor-crosshair"
                : ""
        }`}
        onPointerDown={draggablePoles ? handlePointerDown : undefined}
        onPointerMove={inspect || draggablePoles ? track : undefined}
        onPointerUp={draggablePoles ? handlePointerUp : undefined}
        onPointerCancel={draggablePoles ? handlePointerUp : undefined}
        onPointerLeave={inspect || draggablePoles ? untrack : undefined}
        onKeyDown={draggablePoles ? handleKeyDown : undefined}
        onClick={
          onPick
            ? (e) => {
                const { x, y } = toLocal(e);
                const id = pickVowel(stateRef.current, x, y);
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
