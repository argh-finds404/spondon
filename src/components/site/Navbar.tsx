"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Mark, Wordmark } from "@/components/brand/Logo";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { useLabStore } from "@/store/lab-store";

const LINKS = [
  { href: "/lab", label: "Lab" },
  { href: "/vowels", label: "Vowels" },
  { href: "/classroom", label: "Classroom" },
  { href: "/guide", label: "Guide" },
  { href: "/method", label: "Method" },
  { href: "/developers", label: "API" },
] as const;

const MORE = [
  { href: "/archive", label: "Archive" },
  { href: "/privacy", label: "Privacy" },
] as const;

export const SOURCE_LABEL = {
  silent: "Synthetic voice",
  synth: "Synthetic voice, playing",
  mic: "Microphone",
  stream: "Tab audio",
} as const;

/** What is feeding the analyser right now, in words. */
export function useSourceLabel(): string {
  const sourceMode = useLabStore((s) => s.sourceMode);
  const signal = useLabStore((s) => s.synth.wave !== "voice");
  if (signal && sourceMode === "silent") return "Test signal";
  if (signal && sourceMode === "synth") return "Test signal, playing";
  return SOURCE_LABEL[sourceMode];
}

/**
 * The bar is the instrument's own status strip: whatever page you are on, it shows the signal
 * that is running (its source, its waveform, its pitch, the vowel it is nearest) and lets you hold it.
 */
export function Navbar() {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const sourceMode = useLabStore((s) => s.sourceMode);
  const frozen = useLabStore((s) => s.frozen);
  const toggleFreeze = useLabStore((s) => s.toggleFreeze);
  const label = useSourceLabel();
  const live = sourceMode === "mic" || sourceMode === "stream";
  const inLab = pathname === "/lab";

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-(--nav-h) bg-surface transition-colors duration-300">
      <nav aria-label="Main" className="wrap flex h-full items-center gap-5 xl:gap-8">
        <Link href="/" aria-label="SPONDON, home" className="group flex items-center gap-3 text-ink">
          <Mark size={32} className="transition-transform duration-500 ease-(--ease-out) group-hover:rotate-90" />
          <Wordmark className="text-[18px]" />
          <span lang="bn" className="bn hidden text-[17px] text-muted 2xl:inline">
            স্পন্দন
          </span>
        </Link>

        <ul className="hidden h-full items-stretch gap-5 lg:flex xl:gap-6">
          {LINKS.map((link) => (
            <li key={link.href} className="flex">
              <Link
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className="ui-tab h-full text-[15px] font-medium"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex h-full items-center gap-3 xl:gap-4">
          <div data-ui className="flex h-full items-center gap-3">
            <span className="hidden items-center gap-2 text-ink 2xl:flex">
              <span className={`mark ${live ? `text-accent ${frozen ? "" : "animate-pulse"}` : ""}`} />
              <span className="ui-label whitespace-nowrap">{label}</span>
            </span>
            <Trace kind="mini" bare label="Waveform of the signal now being analysed" className="hidden h-7 w-24 xl:block" />
            <span className="ui-fig text-[13px] whitespace-nowrap text-ink">
              <Readout field="f0" className="inline-block min-w-[5ch] text-right" /> Hz
            </span>
            <span lang="bn" className="bn hidden w-7 text-center text-[17px] text-ink sm:inline-block">
              <Readout field="vowel" />
            </span>
            <button
              type="button"
              aria-pressed={frozen}
              onClick={toggleFreeze}
              className="ui-tab hidden h-full text-[14px] font-medium md:inline-flex"
            >
              Freeze
            </button>
          </div>
          <ThemeToggle />
          {!inLab && (
            <Link href="/lab" className="btn btn-sm hidden sm:inline-flex">
              Open the lab
            </Link>
          )}
          <button
            type="button"
            className="flex h-11 items-center px-1 text-[15px] font-medium lg:hidden"
            aria-haspopup="dialog"
            onClick={() => sheet.current?.showModal()}
          >
            Menu
          </button>
        </div>
      </nav>

      <dialog ref={sheet} className="sheet" aria-label="Menu">
        <div className="wrap flex h-full flex-col overflow-y-auto pb-8">
          <div className="flex h-(--nav-h) flex-none items-center justify-between">
            <span className="flex items-center gap-3">
              <Mark size={32} cut="var(--bg)" />
              <Wordmark className="text-[18px]" />
            </span>
            <button
              type="button"
              className="flex h-11 items-center px-1 text-[15px] font-medium"
              onClick={() => sheet.current?.close()}
            >
              Close
            </button>
          </div>
          <ul className="mt-6 flex flex-col">
            {[{ href: "/", label: "Home" }, ...LINKS, ...MORE].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  onClick={() => sheet.current?.close()}
                  className="block py-1.5 text-[34px] leading-tight font-semibold tracking-[-0.02em] text-muted transition-colors hover:text-ink aria-[current=page]:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-4 pt-8">
            <p data-ui className="flex items-center gap-2 text-muted">
              <span className="mark" />
              {label}, analysed in this tab
            </p>
            <Link href="/lab" onClick={() => sheet.current?.close()} className="btn w-full">
              Open the lab
            </Link>
          </div>
        </div>
      </dialog>
    </header>
  );
}
