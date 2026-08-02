"use client";

import * as React from "react";
import type { SourceKind, SourceStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { monogramFor } from "./engines";

/**
 * Connection state is carried by a glyph *shape* and a word, never by colour
 * alone (design-system.md §11.16). Filled dot / triangle / hollow ring survive
 * greyscale and a screenshot.
 */

const DOT = (
  <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
    <circle cx="4.5" cy="4.5" r="3.5" fill="currentColor" />
  </svg>
);

const TRIANGLE = (
  <svg width={10} height={9} viewBox="0 0 10 9" aria-hidden="true">
    <path d="M5 0.6 9.6 8.4H0.4L5 0.6Z" fill="currentColor" />
  </svg>
);

const RING = (
  <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
    <circle cx="4.5" cy="4.5" r="3.2" fill="none" stroke="currentColor" strokeWidth={1.4} />
  </svg>
);

const CROSS = (
  <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
    <path
      d="M1.4 1.4 7.6 7.6M7.6 1.4 1.4 7.6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  </svg>
);

const DASH = (
  <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
    <path d="M1.4 4.5H7.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
  </svg>
);

const STATE: Record<
  SourceStatus,
  { word: string; glyph: React.ReactNode; fg: string }
> = {
  connected: { word: "connected", glyph: DOT, fg: "text-verified" },
  degraded: { word: "degraded", glyph: TRIANGLE, fg: "text-qualified" },
  disconnected: { word: "disconnected", glyph: RING, fg: "text-tertiary" },
  // A source exists but has never been introspected. Distinct from
  // `disconnected`, which means we tried and it was not there.
  pending: { word: "not introspected", glyph: DASH, fg: "text-tertiary" },
  // A connection attempt failed. This one has to be visually loud: it is the
  // state a mistyped path lands in, and the remedy is to delete the source and
  // connect again.
  error: { word: "failed", glyph: CROSS, fg: "text-contested" },
};

export function ConnectionState({
  status,
  className,
}: {
  status: SourceStatus;
  className?: string;
}) {
  // A status the server invents that this build has never heard of renders as
  // itself rather than crashing on `s.fg`. SourceKind and SourceStatus are open
  // types now, and an unknown value must degrade, not throw.
  const s = STATE[status] ?? { word: status, glyph: RING, fg: "text-tertiary" };
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-ui-sm", s.fg, className)}
    >
      <span aria-hidden="true" className="flex items-center">
        {s.glyph}
      </span>
      {s.word}
    </span>
  );
}

/** A mark for the engine — a monogram, not a borrowed logo. */
export function EngineTile({
  kind,
  monogram,
  size = 28,
  className,
}: {
  kind?: SourceKind;
  monogram?: string;
  size?: number;
  className?: string;
}) {
  const text = monogram ?? (kind ? monogramFor(kind) : "??");
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm border border-border-subtle bg-surface-2 font-mono text-mono-sm font-medium text-tertiary",
        className,
      )}
    >
      {text}
    </span>
  );
}
