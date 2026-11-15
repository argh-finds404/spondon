"use client";

import { useEffect, useRef } from "react";
import { chladniModes } from "@/lib/chladni";
import { findVowel } from "@/lib/dsp/vowel-targets";
import { THEME_EVENT } from "@/lib/theme";
import { INK, paintDotFigure } from "./draw";

/** The still figure of one reference vowel, or of any pair of mode numbers. Painted once per size. */
export function FigureGlyph({
  vowelId,
  modes,
  tone = "ink",
  className,
}: {
  vowelId?: string;
  modes?: { m: number; n: number };
  /** "ink" draws in the page's ink colour; "field" draws black, for the orange field. */
  tone?: "ink" | "field";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vowel = findVowel(vowelId);
  const { m, n } = modes ?? chladniModes(vowel.targetF1, vowel.targetF2);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      // "field" sits on the orange field, where the dots are always black.
      paintDotFigure(ctx, rect.width, rect.height, m, n, tone === "ink" ? INK.ink : "#0a0a0b", null);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    window.addEventListener(THEME_EVENT, paint);
    return () => {
      observer.disconnect();
      window.removeEventListener(THEME_EVENT, paint);
    };
  }, [m, n, tone]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={
        vowelId
          ? `Chladni figure mapped from the reference formants of ${vowel.label.toLowerCase()}`
          : "Chladni figure"
      }
      className={className}
    />
  );
}
