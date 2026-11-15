"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Mark, Wordmark } from "@/components/brand/Logo";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";
import { useLabStore } from "@/store/lab-store";

const LINKS = [
  { href: "/lab", label: "Lab" },
  { href: "/vowels", label: "Vowels" },
  { href: "/method", label: "Method" },
  { href: "/developers", label: "API" },
  { href: "/archive", label: "Archive" },
] as const;

export const SOURCE_LABEL = {
  silent: "Synthetic voice",
  synth: "Synthetic voice, playing",
  mic: "Microphone",
  stream: "Tab / YouTube stream",
} as const;

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
  const inLab = pathname === "/lab";

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-(--nav-h) bg-surface">
      <nav aria-label="Main" className="wrap flex h-full items-center gap-5 lg:gap-8">
        <Link href="/" aria-label="SPONDON, home" className="flex items-center gap-2.5 text-ink">
          <Mark size={24} />
          <Wordmark className="text-[15px]" />
          <span lang="bn" className="bn hidden text-[15px] text-muted xl:inline">
            স্পন্দন
          </span>
        </Link>

        <ul className="hidden h-full items-stretch gap-6 md:flex">
          {LINKS.map((link) => (
            <li key={link.href} className="flex">
              <Link
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className="ui-tab h-full text-[14px] font-medium"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex h-full items-center gap-3 lg:gap-5">
          <div data-ui className="flex h-full items-center gap-3">
            <span className="hidden items-center gap-2 lg:flex">
              <span className={`mark ${sourceMode === "mic" || sourceMode === "stream" ? "bg-accent!" : ""}`} />
              <span className="ui-label">{SOURCE_LABEL[sourceMode]}</span>
            </span>
            <Trace kind="mini" bare label="Waveform of the signal now being analysed" className="hidden h-6 w-24 sm:block" />
            <span className="ui-fig whitespace-nowrap text-[12px] text-ink">
              <Readout field="f0" className="inline-block min-w-[5ch] text-right" /> Hz
            </span>
            <span lang="bn" className="bn hidden w-7 text-center text-[16px] text-ink sm:inline-block">
              <Readout field="vowel" />
            </span>
            <button
              type="button"
              aria-pressed={frozen}
              onClick={toggleFreeze}
              className="ui-tab hidden h-full text-[13px] font-medium sm:inline-flex"
            >
              Freeze
            </button>
          </div>
          {!inLab && (
            <Link href="/lab" className="btn hidden min-h-9! sm:inline-flex">
              Open the lab
            </Link>
          )}
          <button
            type="button"
            className="flex h-11 items-center px-1 text-[14px] font-medium md:hidden"
            aria-haspopup="dialog"
            onClick={() => sheet.current?.showModal()}
          >
            Menu
          </button>
        </div>
      </nav>

      <dialog ref={sheet} className="sheet" aria-label="Menu">
        <div className="wrap flex h-full flex-col pb-8">
          <div className="flex h-(--nav-h) items-center justify-between">
            <span className="flex items-center gap-2.5">
              <Mark size={24} cut="var(--bg)" />
              <Wordmark className="text-[15px]" />
            </span>
            <button
              type="button"
              className="flex h-11 items-center px-1 text-[14px] font-medium"
              onClick={() => sheet.current?.close()}
            >
              Close
            </button>
          </div>
          <ul className="mt-8 flex flex-col gap-1">
            {[{ href: "/", label: "Home" }, ...LINKS, { href: "/privacy", label: "Privacy" }].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  onClick={() => sheet.current?.close()}
                  className="block py-2 text-[34px] leading-tight font-semibold tracking-[-0.02em] text-muted aria-[current=page]:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-4">
            <p data-ui className="flex items-center gap-2 text-muted">
              <span className="mark" />
              {SOURCE_LABEL[sourceMode]}, analysed in this tab
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
