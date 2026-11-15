"use client";

import { useEffect, useRef } from "react";

/** A silent loop that only plays while it is on screen, and stays on its poster under reduced motion. */
export function LoopClip({
  src,
  poster,
  label,
  width,
  height,
  className,
}: {
  src: string;
  poster: string;
  label: string;
  width: number;
  height: number;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    });
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      poster={poster}
      width={width}
      height={height}
      aria-label={label}
      className={className}
    >
      <source src={src} type="video/webm" />
    </video>
  );
}
