"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Marks its children's `.reveal` parts as arrived, once, when the block scrolls into view.
 * Without script nothing is hidden: the hidden state only exists under `html.js`.
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
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        for (const part of parts) part.classList.add("is-in");
        io.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}
