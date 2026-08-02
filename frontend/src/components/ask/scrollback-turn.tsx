"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatValue } from "@/lib/format";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { turnState, turnTally, type Turn } from "@/state/ask";

/** Prior turns collapse to `Q + number + inline seal` on two lines. §1.4 */
export function ScrollbackTurn({
  turn,
  onExpand,
  onFocus,
  expanded,
  children,
}: {
  turn: Turn;
  onExpand: () => void;
  onFocus: () => void;
  expanded: boolean;
  children?: React.ReactNode;
}) {
  const state = turnState(turn);
  const { passed, total } = turnTally(turn);

  if (expanded) {
    return (
      <div className="group relative border-b border-border-subtle pb-8">
        {children}
        <button
          type="button"
          onClick={onExpand}
          className="mt-3 text-ui-sm text-tertiary transition-colors duration-100 hover:text-secondary"
        >
          Collapse
        </button>
      </div>
    );
  }

  return (
    <div className="group relative border-b border-border-subtle">
      <button
        type="button"
        onClick={() => {
          onFocus();
          onExpand();
        }}
        className={cn(
          "flex w-full flex-col gap-1 rounded-sm py-3 text-left transition-colors duration-100 hover:bg-overlay-hover",
        )}
      >
        <span className="truncate text-ui text-secondary">{turn.question}</span>
        <span className="flex items-center gap-2.5">
          <span className="text-subtitle tabular text-primary">
            {turn.result
              ? formatValue(turn.result.value, turn.result.format_hint, {
                  unit: turn.result.unit,
                })
              : "—"}
          </span>
          {state ? (
            <ConfidenceSeal state={state} size="inline" passed={passed} total={total} />
          ) : null}
        </span>
      </button>
    </div>
  );
}

