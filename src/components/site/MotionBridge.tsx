"use client";

import { useEffect } from "react";
import { labRuntime } from "@/store/lab-store";

/**
 * Under prefers-reduced-motion the instrument still measures every frame but shows only
 * about three a second: traces and figures step instead of flowing.
 */
export function MotionBridge() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => labRuntime.setDivider(query.matches ? 20 : 1);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return null;
}
