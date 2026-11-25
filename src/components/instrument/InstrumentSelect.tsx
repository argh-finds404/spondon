"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional short Bangla or IPA symbol badge shown on the left (never duplicated). */
  badge?: string;
  banglaBadge?: boolean;
  /** Optional concise secondary hint shown on the right inside the menu. */
  hint?: string;
}

interface InstrumentSelectProps<T extends string = string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "left" | "right";
  className?: string;
  menuWidthClass?: string;
}

/**
 * Precision animated custom dropdown replacing native OS <select> menus across SPONDON.
 * Renders its floating menu in a body portal so `.ui-panel { overflow: clip }` never clips it,
 * with full keyboard navigation (ArrowUp, ArrowDown, Home, End, Enter, Escape) and spring-eased motion.
 */
export function InstrumentSelect<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  size = "md",
  align = "left",
  className = "",
  menuWidthClass = "min-w-[240px]",
}: InstrumentSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    right: number;
    minWidth: number;
    maxHeight: number;
    openUp: boolean;
  }>({
    top: 0,
    left: 0,
    right: 0,
    minWidth: 180,
    maxHeight: 320,
    openUp: false,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  const updateCoords = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = openUp ? spaceAbove : spaceBelow;
    setCoords({
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      left: rect.left,
      right: window.innerWidth - rect.right,
      minWidth: rect.width,
      maxHeight: Math.max(140, Math.min(320, Math.floor(availableHeight))),
      openUp,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
  }, [open, updateCoords]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onScrollOrResize = () => updateCoords();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updateCoords]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!open) {
      const idx = options.findIndex((o) => o.value === value);
      setFocusIdx(idx >= 0 ? idx : 0);
      updateCoords();
    }
    setOpen((prev) => !prev);
  };

  const commit = (opt: SelectOption<T>) => {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const idx = options.findIndex((o) => o.value === value);
        setFocusIdx(idx >= 0 ? idx : 0);
        updateCoords();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIdx(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const target = options[focusIdx];
      if (target) commit(target);
    }
  };

  const heightCls = size === "sm" ? "min-h-8 px-2.5 py-1 text-[12.5px]" : "min-h-10 px-3 py-1.5 text-[13.5px]";

  const menuNode =
    open && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            data-ui
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              ...(coords.openUp
                ? { bottom: `${coords.bottom ?? 0}px`, transformOrigin: "bottom center" }
                : { top: `${coords.top ?? 0}px`, transformOrigin: "top center" }),
              minWidth: `${coords.minWidth}px`,
              maxHeight: `${coords.maxHeight}px`,
              ...(align === "right" ? { right: `${Math.max(8, coords.right)}px` } : { left: `${Math.max(8, coords.left)}px` }),
            }}
            className={`menu-pop z-[120] overflow-y-auto rounded-(--radius) border border-line bg-surface p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.58)] ${menuWidthClass}`}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isFocused = idx === focusIdx;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setFocusIdx(idx)}
                  onClick={() => commit(opt)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-(--radius-sm) px-2.5 py-2 text-[13px] transition-[background-color,color,transform] duration-150 ${
                    isSelected
                      ? "bg-accent/14 text-ink font-semibold"
                      : isFocused
                        ? "bg-raised text-ink translate-x-0.5"
                        : "text-ink/90 hover:bg-raised"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {opt.badge ? (
                      <span
                        lang={opt.banglaBadge ? "bn" : undefined}
                        className={`inline-flex h-6 min-w-7 shrink-0 items-center justify-center rounded border px-1.5 text-[12px] ${
                          isSelected
                            ? "border-accent bg-accent text-accent-ink font-semibold"
                            : "border-line bg-bg text-ink"
                        } ${opt.banglaBadge ? "bn text-[15px] leading-none" : "ui-fig"}`}
                      >
                        {opt.badge}
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                          isSelected ? "bg-accent" : "bg-transparent"
                        }`}
                      />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {opt.hint && <span className="text-[11.5px] font-normal text-muted">{opt.hint}</span>}
                    {isSelected && (
                      <span aria-hidden className="text-[12px] font-bold text-accent">
                        ✓
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} data-ui className={`relative inline-block ${className}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={toggleOpen}
        className={`group flex w-full items-center justify-between gap-2.5 rounded-(--radius-sm) border bg-raised font-medium text-ink transition-[border-color,background-color,box-shadow] duration-150 hover:border-control hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-accent ring-1 ring-accent/40" : "border-line"
        } ${heightCls}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.badge && (
            <span
              lang={selected.banglaBadge ? "bn" : undefined}
              className={`inline-flex min-w-6 shrink-0 items-center justify-center rounded bg-surface px-1.5 py-0.5 text-[12px] font-semibold text-accent ${
                selected.banglaBadge ? "bn text-[14px] leading-none" : "ui-fig"
              }`}
            >
              {selected.badge}
            </span>
          )}
          <span className="truncate">{selected?.label ?? ""}</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={`shrink-0 text-muted transition-transform duration-200 ease-(--ease-out) group-hover:text-ink ${
            open ? "rotate-180 text-accent" : ""
          }`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menuNode}
    </div>
  );
}
