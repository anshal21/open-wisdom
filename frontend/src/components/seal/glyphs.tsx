import { CircleDashed, EqualNot, GitFork, History } from "lucide-react";
import type { ConfidenceState } from "@/lib/confidence";
import { cn } from "@/lib/cn";

interface GlyphProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * `verified` and `qualified` use **filled** glyphs; every other state is
 * hollow or dashed. The fill weight is a second, colour-independent channel:
 * a filled shield and a hollow dashed circle are still distinguishable in a
 * black-and-white screenshot. design-system.md §3.1.
 */

export function ShieldCheckFilled({ size = 14, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M8 1.1 13.7 3.35V8.1c0 3.35-2.4 5.7-5.7 6.85C4.7 13.8 2.3 11.45 2.3 8.1V3.35L8 1.1Zm3.62 4.9-1.15-1.14-3.31 3.31-1.63-1.62L4.38 7.7l2.78 2.77 4.46-4.46Z"
      />
    </svg>
  );
}

export function TriangleAlertFilled({ size = 14, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M8.83 1.62a.96.96 0 0 0-1.66 0L.6 13.02a.96.96 0 0 0 .83 1.44h13.14a.96.96 0 0 0 .83-1.44L8.83 1.62ZM8.8 5.6H7.2v4.35h1.6V5.6Zm-.8 5.35a.98.98 0 1 0 0 1.96.98.98 0 0 0 0-1.96Z"
      />
    </svg>
  );
}

/** Transient. A 900ms linear arc; static under reduced motion. §3.5 */
export function CheckingArc({ size = 14, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("ds-spin", className)}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={1.75}
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ConfidenceGlyph({
  state,
  size = 14,
  className,
}: GlyphProps & { state: ConfidenceState }) {
  switch (state) {
    case "checking":
      return <CheckingArc size={size} className={className} />;
    case "verified":
      return <ShieldCheckFilled size={size} className={className} />;
    case "qualified":
      return <TriangleAlertFilled size={size} className={className} />;
    case "unverified":
      return <CircleDashed size={size} className={className} strokeWidth={1.75} />;
    case "refused":
      return <GitFork size={size} className={className} strokeWidth={1.75} />;
    case "contested":
      return <EqualNot size={size} className={className} strokeWidth={2} />;
    case "superseded":
      return <History size={size} className={className} strokeWidth={1.75} />;
  }
}

/** Slack has no lucide glyph; this is the mark, drawn once. */
export function SlackGlyph({ size = 14, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M3.36 9.9a1.42 1.42 0 1 1-1.42-1.42h1.42V9.9Zm.71 0a1.42 1.42 0 0 1 2.84 0v3.55a1.42 1.42 0 1 1-2.84 0V9.9ZM5.49 4.2a1.42 1.42 0 1 1 1.42-1.42V4.2H5.49Zm0 .72a1.42 1.42 0 0 1 0 2.84H1.94a1.42 1.42 0 1 1 0-2.84h3.55ZM11.19 6.34a1.42 1.42 0 1 1 1.42 1.42h-1.42V6.34Zm-.71 0a1.42 1.42 0 0 1-2.84 0V2.78a1.42 1.42 0 1 1 2.84 0v3.56ZM9.06 12.04a1.42 1.42 0 1 1-1.42 1.42v-1.42h1.42Zm0-.71a1.42 1.42 0 0 1 0-2.84h3.55a1.42 1.42 0 0 1 0 2.84H9.06Z" />
    </svg>
  );
}
