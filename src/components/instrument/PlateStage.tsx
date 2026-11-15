"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Plate3DProps } from "./Plate3D";
import { Trace } from "./Trace";

const LABEL = "Chladni figure for the vowel now being analysed, drawn in sand";

// three.js is only fetched once a plate is about to be seen.
const Plate3D = dynamic(() => import("./Plate3D"), {
  ssr: false,
  loading: () => <Trace kind="figure" bare label={LABEL} className="absolute inset-[9%]" />,
});

let webgl: boolean | null = null;
function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const canvas = document.createElement("canvas");
      webgl = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/**
 * The plate in 3D while it is on screen; unmounted (and its GL context released) when it is not.
 * Without WebGL the same figure is drawn as a dot matrix on a 2D canvas.
 */
export function PlateStage({ className, ...plate }: Plate3DProps & { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"idle" | "3d" | "2d">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setMode(entry.isIntersecting ? (hasWebGL() ? "3d" : "2d") : "idle"),
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} role="img" aria-label={LABEL} className={`relative overflow-hidden ${className ?? ""}`}>
      {mode === "3d" && (
        <div className="absolute inset-0">
          <Plate3D grains={typeof window !== "undefined" && window.innerWidth < 640 ? 9000 : 16000} {...plate} />
        </div>
      )}
      {mode === "2d" && <Trace kind="figure" bare label={LABEL} className="absolute inset-[9%]" />}
    </div>
  );
}
