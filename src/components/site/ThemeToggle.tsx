"use client";

import { useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribeTheme } from "@/lib/theme";

/** Switches between the dark and the light bench. The choice is remembered in this browser only. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "dark" as const);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      suppressHydrationWarning
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      onClick={() => setTheme(next)}
      className={`grid h-10 w-10 flex-none place-items-center rounded-(--radius-sm) bg-raised text-ink transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.94] ${className ?? ""}`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        aria-hidden
        suppressHydrationWarning
        className="transition-transform duration-500 ease-(--ease-out)"
        style={{ transform: `rotate(${theme === "dark" ? 0 : 180}deg)` }}
      >
        {/* Half a disc: the lit half faces up in the dark theme and down in the light one. */}
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor" />
      </svg>
    </button>
  );
}
