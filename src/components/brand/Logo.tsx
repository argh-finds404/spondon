/**
 * The mark: a square plate, clamped at its centre, with one nodal line across it.
 * Sand gathers where a vibrating plate stays still; the line it draws here is an S,
 * and one period of a standing wave. The orange point is the clamp, the pulse (স্পন্দন).
 */
export function Mark({
  size = 24,
  cut = "var(--surface)",
  className,
}: {
  size?: number;
  /** The colour behind the mark, which the nodal line is cut out in. */
  cut?: string;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className={className}>
      <rect x="1" y="1" width="30" height="30" rx="1.5" fill="currentColor" />
      <path d="M16 0C3.5 7.5 3.5 12.5 16 16s12.5 8.5 0 16" fill="none" stroke={cut} strokeWidth="3.4" />
      <circle cx="16" cy="16" r="5.6" fill={cut} />
      <circle cx="16" cy="16" r="3.2" fill="#ff5500" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ fontWeight: 650, fontStretch: "114%", letterSpacing: "0.015em" }}>
      SPONDON
    </span>
  );
}
