"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Leans its content toward the pointer, a few degrees, in real 3D. Touch and reduced motion get it flat. */
export function Tilt({ max = 6, className, children }: { max?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const boxRef = useRef<DOMRect | null>(null);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return (
    <div
      ref={ref}
      className={`tilt ${className ?? ""}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        boxRef.current = ref.current?.getBoundingClientRect() ?? null;
      }}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType === "touch") return;
        const clientX = e.clientX;
        const clientY = e.clientY;
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const box = boxRef.current ?? el.getBoundingClientRect();
          boxRef.current = box;
          if (box.width <= 0 || box.height <= 0) return;
          el.dataset.live = "true";
          el.style.setProperty("--rx", (((clientX - box.left) / box.width - 0.5) * 2 * max).toFixed(2));
          el.style.setProperty("--ry", ((0.5 - (clientY - box.top) / box.height) * 2 * max).toFixed(2));
        });
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        boxRef.current = null;
        if (!el) return;
        el.dataset.live = "false";
        el.style.setProperty("--rx", "0");
        el.style.setProperty("--ry", "0");
      }}
    >
      {children}
    </div>
  );
}
