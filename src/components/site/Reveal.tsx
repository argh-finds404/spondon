"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Marks its children's `.reveal` parts as arrived, once, when the block's top comes into view.
 * Without script nothing is hidden: the hidden state only exists under `html.js`.
 *
 * It checks on every scroll rather than with an IntersectionObserver: an observer only reports a
 * change of visibility, so a block that a fast fling or an anchor jump carries straight past the
 * screen would never be reported, and would stay hidden.
 */
export function Reveal({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parts = el.matches(".reveal") ? [el] : Array.from(el.querySelectorAll<HTMLElement>(".reveal"));
    let raf = 0;
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    const check = () => {
      raf = 0;
      const box = el.getBoundingClientRect();
      if (box.top > window.innerHeight * 0.88) return;
      // A block already scrolled past appears at once; only a block arriving on screen animates in.
      const passed = box.bottom <= 0;
      for (const part of parts) {
        if (passed) part.style.transition = "none";
        part.classList.add("is-in");
      }
      stop();
    };
    function onScroll() {
      if (!raf) raf = requestAnimationFrame(check);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return stop;
  }, []);

  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}
