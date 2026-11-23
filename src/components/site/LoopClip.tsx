"use client";

import { useEffect, useRef } from "react";

/** A silent loop that only plays while it is on screen, and stays on its poster under reduced motion. */
export function LoopClip({
  src,
  poster,
  label,
  width,
  height,
  playbackRate = 1,
  paused = false,
  className,
}: {
  src: string;
  poster: string;
  label: string;
  width: number;
  height: number;
  playbackRate?: number;
  paused?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const inViewRef = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
    } else if (inViewRef.current) {
      void video.play().catch(() => undefined);
    }
  }, [paused]);

  useEffect(() => {
    const video = ref.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.isIntersecting;
        if (entry.isIntersecting && !paused) void video.play().catch(() => undefined);
        else video.pause();
      },
      { rootMargin: "320px 0px" },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [paused]);

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="metadata"
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
