"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  BORDER_CLASS,
  CONFIDENCE,
  HUE_CLASS,
  type ConfidenceState,
} from "@/lib/confidence";
import { ConfidenceGlyph } from "./glyphs";

export type SealSize = "inline" | "standard" | "banner";

export interface ConfidenceSealProps {
  state: ConfidenceState;
  size?: SealSize;
  /** Checks that ran. Skipped checks never count. */
  passed?: number;
  total?: number;
  /**
   * For `qualified`, this is the caveat itself, verbatim — not the word
   * "Qualified". The state name is carried by the glyph and colour. §3.5
   */
  headline?: string;
  onOpenEvidence?: () => void;
  /** Ledger rows never collapse the label. Tables and tiles may. */
  labelHidden?: boolean;
  className?: string;
  /** Named slow check, shown when verification is running long. §1.3 */
  slowCheck?: string;
}

/**
 * The single component through which all seven confidence states render.
 * It renders no percentage. Ever. design-system.md §3.3.
 */
export function ConfidenceSeal({
  state,
  size = "standard",
  passed,
  total,
  headline,
  onOpenEvidence,
  labelHidden = false,
  className,
  slowCheck,
}: ConfidenceSealProps) {
  const meta = CONFIDENCE[state];
  const hue = HUE_CLASS[meta.hue];
  const border = BORDER_CLASS[meta.border];

  const counts =
    typeof passed === "number" && typeof total === "number" && total > 0
      ? state === "checking"
        ? `${passed}/${total} checks`
        : `${passed} of ${total} checks`
      : null;

  const accessibleName = [
    meta.label,
    counts,
    headline,
    slowCheck ? `slow check running: ${slowCheck}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (size === "banner") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={accessibleName}
        className={cn(
          "flex min-h-11 w-full items-start gap-2.5 rounded-md border px-3.5 py-2.5",
          hue.bg,
          hue.border,
          border,
          className,
        )}
      >
        <span className={cn("mt-px shrink-0", hue.fg)}>
          <ConfidenceGlyph state={state} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-subtitle", hue.fg)}>
            {headline ?? meta.label}
            {counts ? (
              <span className="ml-1.5 font-normal text-tertiary">· {counts}</span>
            ) : null}
          </p>
          {headline ? (
            <p className="mt-0.5 text-ui-sm text-tertiary">
              {meta.label}
              {slowCheck ? ` · slow check running: ${slowCheck}` : ""}
            </p>
          ) : null}
        </div>
        {onOpenEvidence ? (
          <button
            type="button"
            onClick={onOpenEvidence}
            className={cn(
              "-mr-1 flex h-6 shrink-0 items-center gap-0.5 rounded-sm px-1.5 text-ui-sm font-medium transition-colors duration-100 hover:bg-overlay-hover",
              hue.fg,
            )}
          >
            Review evidence
            <ChevronRight size={13} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    );
  }

  const inline = size === "inline";
  const Tag = onOpenEvidence ? "button" : "span";

  return (
    <Tag
      {...(onOpenEvidence
        ? { type: "button" as const, onClick: onOpenEvidence }
        : {})}
      aria-label={accessibleName}
      title={labelHidden ? accessibleName : undefined}
      className={cn(
        "inline-flex shrink-0 items-center border align-middle whitespace-nowrap",
        inline
          ? "h-5 gap-1 rounded-xs px-1.5"
          : "h-[26px] gap-1.5 rounded-sm px-2",
        hue.bg,
        hue.border,
        border,
        hue.fg,
        onOpenEvidence && "transition-colors duration-100 hover:border-border-hover",
        className,
      )}
    >
      <ConfidenceGlyph state={state} size={inline ? 12 : 14} />
      {labelHidden ? (
        <span className="sr-only">{meta.label}</span>
      ) : (
        <span
          className={cn(
            inline
              ? "text-label uppercase"
              : "text-ui-sm font-semibold tracking-normal",
          )}
        >
          {meta.label}
        </span>
      )}
      {!inline && counts ? (
        <span className="text-ui-sm text-tertiary tabular">· {counts}</span>
      ) : null}
      {!inline && slowCheck ? (
        <span className="text-ui-sm text-tertiary">· {slowCheck}</span>
      ) : null}
    </Tag>
  );
}
