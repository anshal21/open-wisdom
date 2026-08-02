"use client";

import * as React from "react";
import { ArrowUp, Database } from "lucide-react";
import { cn } from "@/lib/cn";
import { MOD } from "@/lib/keyboard";
import { Skeleton } from "@/components/ui/primitives";

/**
 * The single most important input in the product. design-system.md §9.3.
 * Docked bottom of the answer column with a surface-canvas scrim above it —
 * the only gradient in the system, and it is a scrim, not a decoration.
 */
export function AskComposer({
  value,
  onChange,
  onSubmit,
  onRecall,
  placeholder = "Ask a follow-up…",
  suggestions,
  suggestionsLoading = false,
  sourceName,
  disabled = false,
  disabledReason,
  inputRef,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onRecall?: () => string | undefined;
  placeholder?: string;
  suggestions?: string[];
  suggestionsLoading?: boolean;
  sourceName?: string;
  disabled?: boolean;
  disabledReason?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const localRef = React.useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  const [rows, setRows] = React.useState(1);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 20;
    const lines = Math.min(5, Math.max(1, Math.round((el.scrollHeight - 20) / lineHeight)));
    setRows(lines);
    el.style.height = `${Math.min(el.scrollHeight, 20 * 5 + 20)}px`;
  }, [ref]);

  React.useEffect(resize, [value, resize]);

  const submit = () => {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
    // Optimistic: the field clears before anything comes back.
    onChange("");
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <div className={cn("relative", className)}>
      <div aria-hidden="true" className="composer-scrim pointer-events-none h-8" />
      <div className="bg-surface-canvas pb-4">
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border bg-surface-1 px-3 py-2 transition-colors duration-100",
            disabled
              ? "border-border-default opacity-60"
              : "border-border-strong focus-within:border-border-accent",
          )}
        >
          <button
            type="button"
            aria-label={sourceName ? `Source: ${sourceName}. Switch source` : "Switch source"}
            title={sourceName}
            className="mb-1 shrink-0 rounded-sm p-1 text-tertiary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary"
          >
            <Database size={16} />
          </button>
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              } else if (e.key === "Enter" && !e.shiftKey && rows === 1) {
                e.preventDefault();
                submit();
              } else if (
                e.key === "ArrowUp" &&
                value === "" &&
                onRecall
              ) {
                const prev = onRecall();
                if (prev) {
                  e.preventDefault();
                  onChange(prev);
                }
              } else if (e.key === "Escape") {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className="min-h-5 flex-1 resize-none bg-transparent py-1 text-body text-primary outline-none placeholder:text-tertiary"
          />
          <span className="mb-1.5 shrink-0 text-ui-sm text-tertiary">{MOD}↵</span>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || disabled}
            aria-label="Ask"
            className={cn(
              "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100",
              value.trim() && !disabled
                ? "bg-accent-solid text-white hover:bg-accent-solid-hover"
                : "cursor-not-allowed bg-surface-2 text-disabled",
            )}
          >
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        </div>

        {disabled && disabledReason ? (
          <p className="mt-2 px-1 text-ui-sm text-qualified">{disabledReason}</p>
        ) : null}

        {suggestionsLoading ? (
          <div className="mt-2 flex h-6 items-center gap-2">
            {[132, 108, 156].map((w) => (
              <Skeleton key={w} className="h-6" style={{ width: w }} />
            ))}
          </div>
        ) : suggestions && suggestions.length > 0 ? (
          <div className="mt-2 flex h-6 items-center gap-2 overflow-hidden">
            {suggestions.slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onChange(s);
                  window.requestAnimationFrame(() => ref.current?.focus());
                }}
                className="h-6 shrink-0 truncate rounded-sm border border-border-subtle bg-surface-2 px-2 text-ui-sm text-secondary transition-colors duration-100 hover:border-border-hover hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
