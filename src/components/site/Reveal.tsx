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
    let done = false;
    let raf = 0;

    const finish = (passed: boolean) => {
      if (done) return;
      done = true;
      for (const part of parts) {
        if (passed) part.style.transition = "none";
        part.classList.add("is-in");
      }
      stop();
    };

    const check = () => {
      raf = 0;
      if (done) return;
      const box = el.getBoundingClientRect();
      if (box.top > window.innerHeight * 0.9) return;
      finish(box.bottom <= 0);
    };

    const onScroll = () => {
      if (!done && !raf) raf = requestAnimationFrame(check);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry || done) return;
        if (entry.isIntersecting || entry.boundingClientRect.top <= window.innerHeight * 0.9) {
          finish(entry.boundingClientRect.bottom <= 0);
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );

    function stop() {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    }

    io.observe(el);
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
