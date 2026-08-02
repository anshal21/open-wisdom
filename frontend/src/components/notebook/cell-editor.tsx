"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { CellKind } from "@/lib/api/types";
import { KIND_PLACEHOLDER } from "./cell-model";

const LINE_H = 20;
const MIN_LINES = 2;
const MAX_LINES = 20;

/**
 * §7.3 — the cell editor. Mono for `sql` and `python`, auto-height between
 * 2 and 20 lines, and it never grows the page: past 20 lines it scrolls.
 */
export function CellEditor({
  value,
  kind,
  onChange,
  onFocus,
  onKeyDown,
  registerRef,
  readOnly = false,
  className,
}: {
  value: string;
  kind: CellKind;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  registerRef?: (el: HTMLTextAreaElement | null) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const mono = kind === "sql" || kind === "python";

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lines = Math.min(
      MAX_LINES,
      Math.max(MIN_LINES, Math.ceil(el.scrollHeight / LINE_H)),
    );
    el.style.height = `${lines * LINE_H + 16}px`;
    el.style.overflowY = el.scrollHeight > lines * LINE_H + 16 ? "auto" : "hidden";
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        registerRef?.(el);
      }}
      value={value}
      readOnly={readOnly}
      spellCheck={!mono}
      aria-label={`${kind} cell source`}
      placeholder={KIND_PLACEHOLDER[kind]}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      style={{ lineHeight: `${LINE_H}px` }}
      className={cn(
        "w-full resize-none border-0 bg-transparent px-3.5 py-2 outline-none placeholder:text-tertiary",
        mono
          ? "bg-surface-inset font-mono text-mono text-primary"
          : "text-body text-primary",
        className,
      )}
    />
  );
}
