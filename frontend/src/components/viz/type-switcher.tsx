"use client";

/**
 * The chart-type switcher. One radiogroup with a roving tabindex — arrow keys
 * move between forms, Tab moves past the whole control, which is what a group
 * of mutually exclusive choices is supposed to do.
 *
 * Illegal forms stay VISIBLE and disabled, carrying the form's own reason for
 * declining ("a share of a whole cannot include negative values"), because
 * hiding them makes the switcher's contents change shape under the user.
 *
 * Iterates the registry — adding a form adds a button here for free.
 */

import * as React from "react";
import { cn } from "@/lib/cn";
import { listMetas, type VizTable, type VizType } from "@/lib/viz/registry";
import { legalityReason, type ResolvedSpec } from "@/lib/viz/resolve";
import { rendererFor } from "./plugins";

export function TypeSwitcher({
  table,
  spec,
  onPick,
  className,
}: {
  table: VizTable;
  spec: ResolvedSpec;
  onPick: (t: VizType) => void;
  className?: string;
}) {
  const enc = { xIdx: spec.xIdx, yIdxs: spec.yIdxs, seriesIdx: spec.seriesIdx };

  const forms = React.useMemo(
    () =>
      listMetas()
        // A form with no renderer would switch to a blank plot.
        .filter((m) => rendererFor(m.id) && !m.frameless)
        .map((m) => ({
          id: m.id,
          label: m.label,
          icon: rendererFor(m.id)!.icon,
          reason: legalityReason(m.id, table, enc),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, spec.xIdx, spec.yIdxs, spec.seriesIdx],
  );

  const legal = forms.filter((f) => !f.reason);
  const activeIdx = Math.max(
    0,
    legal.findIndex((f) => f.id === spec.type),
  );

  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (dir: 1 | -1) => {
    if (!legal.length) return;
    const next = legal[(activeIdx + dir + legal.length) % legal.length];
    onPick(next.id);
    // Focus follows selection, which is the radiogroup convention.
    window.requestAnimationFrame(() => refs.current[next.id]?.focus());
  };

  return (
    <div
      role="radiogroup"
      aria-label="Chart type"
      className={cn("flex items-center gap-0.5", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {forms.map((f, i) => {
        const Icon = f.icon;
        const active = spec.type === f.id;
        const disabled = Boolean(f.reason);
        // The table is the floor, not a peer — a divider says so.
        const divider = f.id === "table" && i > 0;
        return (
          <React.Fragment key={f.id}>
            {divider ? (
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border-subtle" />
            ) : null}
            <button
              ref={(el) => {
                refs.current[f.id] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={f.label}
              aria-disabled={disabled}
              disabled={disabled}
              title={disabled ? `${f.label} — ${f.reason}` : f.label}
              tabIndex={active ? 0 : -1}
              onClick={() => onPick(f.id)}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors duration-100",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--c-border-accent)]",
                active
                  ? "bg-overlay-selected text-accent"
                  : disabled
                    ? "cursor-not-allowed text-disabled opacity-50"
                    : "text-tertiary hover:bg-overlay-hover hover:text-primary",
              )}
            >
              <Icon size={13} />
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
