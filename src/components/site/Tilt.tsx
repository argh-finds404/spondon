"use client";

import { useRef, type ReactNode } from "react";

/** Leans its content toward the pointer, a few degrees, in real 3D. Touch and reduced motion get it flat. */
export function Tilt({ max = 6, className, children }: { max?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`tilt ${className ?? ""}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType === "touch") return;
        const box = el.getBoundingClientRect();
        el.dataset.live = "true";
        el.style.setProperty("--rx", (((e.clientX - box.left) / box.width - 0.5) * 2 * max).toFixed(2));
        el.style.setProperty("--ry", ((0.5 - (e.clientY - box.top) / box.height) * 2 * max).toFixed(2));
      }}
      onPointerLeave={() => {
        const el = ref.current;
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
