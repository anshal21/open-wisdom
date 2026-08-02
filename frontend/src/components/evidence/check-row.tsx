"use client";

import * as React from "react";
import { Check as CheckGlyph, Circle, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Check, CheckStatus } from "@/lib/api/types";
import { CHECK_LABEL, checkLabel, isSkipped } from "@/lib/confidence";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { formatCount } from "@/lib/format";

function StatusGlyph({ status }: { status: CheckStatus }) {
  switch (status) {
    case "pass":
      return <CheckGlyph size={14} className="text-verified" strokeWidth={2.4} />;
    case "warn":
      return <TriangleAlert size={14} className="text-qualified" strokeWidth={2} />;
    case "fail":
      return <X size={14} className="text-contested" strokeWidth={2.4} />;
    default:
      return <Circle size={13} className="text-tertiary" strokeWidth={1.6} />;
  }
}

export function CheckRow({
  check,
  index = 0,
  stagger = false,
  defaultOpen = false,
}: {
  check: Check;
  index?: number;
  stagger?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const skipped = isSkipped(check.status);
  const detail = check.detail;
  const hasTier3 =
    Boolean(detail?.sql || detail?.sql_path_a || detail?.why) ||
    typeof detail?.rows_in === "number";

  return (
    <div
      className={cn("border-b border-border-subtle last:border-0", stagger && "ds-fade")}
      style={stagger ? { animationDelay: `${Math.min(index, 5) * 40}ms` } : undefined}
    >
      <button
        type="button"
        onClick={() => hasTier3 && setOpen((v) => !v)}
        aria-expanded={hasTier3 ? open : undefined}
        disabled={!hasTier3}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors duration-100",
          hasTier3 && "hover:bg-overlay-hover",
        )}
      >
        <span className="mt-px shrink-0">
          <StatusGlyph status={check.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-ui font-medium",
              skipped ? "text-tertiary" : "text-primary",
            )}
          >
            {checkLabel(check)}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-ui-sm",
              skipped ? "text-disabled" : "text-secondary",
            )}
          >
            {skipped ? check.skip_reason || "Not run." : check.finding}
          </span>
        </span>
        {hasTier3 ? (
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cn(
              "mt-1 shrink-0 text-tertiary transition-transform duration-100",
              open && "rotate-90",
            )}
          >
            <path
              d="m4.5 3 3 3-3 3"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      {open && detail ? (
        <div className="ds-fade space-y-2.5 px-3 pb-3">
          {detail.why ? (
            <p className="text-ui-sm text-tertiary">{detail.why}</p>
          ) : null}
          {typeof detail.rows_in === "number" ? (
            <p className="text-ui-sm tabular text-secondary">
              {formatCount(detail.rows_in)} rows in ·{" "}
              {formatCount(detail.rows_out ?? detail.rows_in)} rows out
            </p>
          ) : null}
          {detail.sql_path_a || detail.sql_path_b ? (
            <SqlViewer
              maxHeight={200}
              paths={[
                ...(detail.sql_path_a ? [{ label: "Path A", sql: detail.sql_path_a }] : []),
                ...(detail.sql_path_b ? [{ label: "Path B", sql: detail.sql_path_b }] : []),
              ]}
            />
          ) : detail.sql ? (
            <SqlViewer maxHeight={200} paths={[{ label: "SQL", sql: detail.sql }]} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The checklist shown before results land — knowing what will be checked is the trust move. */
export function PendingCheckRow({ id }: { id: keyof typeof CHECK_LABEL }) {
  return (
    <div className="flex items-start gap-2 border-b border-border-subtle px-3 py-2.5 last:border-0">
      <span className="mt-px shrink-0">
        <Circle size={13} className="text-disabled" strokeWidth={1.6} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium text-tertiary">
          {CHECK_LABEL[id]}
        </span>
        <span className="mt-0.5 block text-ui-sm text-disabled">Waiting to run</span>
      </span>
    </div>
  );
}
