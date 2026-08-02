"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { CONFIDENCE, type ConfidenceState } from "@/lib/confidence";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { HUE_CLASS, BORDER_CLASS } from "@/lib/confidence";

/**
 * §6.1 — the dashboard-level roll-up. A per-state count, never an average,
 * never a percentage, never a single health score. Clicking a segment filters
 * the grid to those tiles.
 */
export function ConfidenceRollup({
  counts,
  active,
  onToggle,
  className,
}: {
  counts: Array<{ state: ConfidenceState; count: number }>;
  active: ConfidenceState | null;
  onToggle: (state: ConfidenceState) => void;
  className?: string;
}) {
  if (counts.length === 0) return null;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-1 gap-y-1", className)}
      role="group"
      aria-label="Tiles by confidence state"
    >
      {counts.map(({ state, count }, i) => {
        const meta = CONFIDENCE[state];
        const hue = HUE_CLASS[meta.hue];
        const selected = active === state;
        return (
          <React.Fragment key={state}>
            {i > 0 ? (
              <span aria-hidden="true" className="px-0.5 text-tertiary">
                ·
              </span>
            ) : null}
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(state)}
              title={
                selected
                  ? `Showing only ${meta.label.toLowerCase()} tiles — click to clear`
                  : `Show only ${meta.label.toLowerCase()} tiles`
              }
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-ui-sm transition-colors duration-100",
                selected
                  ? cn(hue.bg, hue.border, BORDER_CLASS[meta.border])
                  : "border-transparent hover:bg-overlay-hover",
              )}
            >
              <span className={hue.fg}>
                <ConfidenceGlyph state={state} size={12} />
              </span>
              <span className="tabular text-primary">{count}</span>
              <span className="text-tertiary">{meta.label.toLowerCase()}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
