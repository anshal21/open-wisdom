"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Answer, CheckStatus, FormatHint } from "@/lib/api/types";
import { CONFIDENCE, type ConfidenceState } from "@/lib/confidence";
import {
  EMPTY,
  formatAbsolute,
  formatCount,
  formatDelta,
  formatValue,
  isoTitle,
  deltaDirection,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Disclosure, Skeleton } from "@/components/ui/primitives";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import type { LedgerGroup } from "./model";
import { rowState } from "./model";

/**
 * §9.15 diff, applied to the divergence flag of §5.2 — the same question
 * answered two ways. Two-column at ≥1280px, stacked below. Changed figures take
 * a `qualified` tint and a delta annotation inked by direction; unchanged rows
 * collapse. This is the surface no competitor has: it makes disagreement
 * legible instead of letting the newer number quietly win.
 */

interface DiffSide {
  label: string;
  sublabel?: string;
  value: number | null;
  state: ConfidenceState;
  at?: string;
  sql?: string;
}

interface DiffLine {
  label: string;
  a: string;
  b: string;
  changed: boolean;
  deltaPct?: number | null;
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "Passed",
  warn: "Caveat raised",
  fail: "Failed",
  skipped: "Not run",
  not_applicable: "Not applicable",
};

function fmt(
  value: number | null,
  formatHint: FormatHint,
  unit: string,
  showsNumber = true,
): string {
  if (!showsNumber || value === null) return EMPTY;
  return formatValue(value, formatHint, { unit });
}

interface DiffModel {
  sides: [DiffSide, DiffSide] | null;
  lines: DiffLine[];
  summary?: string;
  why?: string;
  paths: Array<{ label: string; sql: string }>;
}

export function buildDiff(
  group: LedgerGroup,
  answer: Answer | null,
): DiffModel {
  const lead = group.lead;
  const unit = lead.unit;
  const hint = lead.format_hint;
  const lines: DiffLine[] = [];
  const paths: Array<{ label: string; sql: string }> = [];

  const cross = answer?.report?.checks.find((c) => c.id === "cross_derivation");
  const detail = cross?.detail;

  let sides: [DiffSide, DiffSide] | null = null;
  let summary: string | undefined;
  let why: string | undefined;

  if (
    typeof detail?.value_path_a === "number" &&
    typeof detail?.value_path_b === "number"
  ) {
    // Two derivations of the same question that disagreed.
    const sqlA = detail.sql_path_a ?? answer?.sql;
    const sqlB = detail.sql_path_b ?? answer?.sql_path_b;
    sides = [
      {
        label: "Derivation A",
        sublabel: "First path",
        value: detail.value_path_a,
        state: group.state,
        at: lead.created_at,
        sql: sqlA,
      },
      {
        label: "Derivation B",
        sublabel: "Independent path",
        value: detail.value_path_b,
        state: group.state,
        at: lead.created_at,
        sql: sqlB,
      },
    ];
    summary = cross?.finding;
    why = typeof detail.why === "string" ? detail.why : undefined;
    if (sqlA) paths.push({ label: "Path A", sql: sqlA });
    if (sqlB) paths.push({ label: "Path B", sql: sqlB });
  } else if (answer?.runs && answer.runs.length >= 2) {
    const runs = [...answer.runs].sort((x, y) => y.run - x.run);
    const current = runs[0];
    const prior = runs.find((r) => r.value !== current.value) ?? runs[1];
    sides = [
      {
        label: `Run ${prior.run}`,
        value: prior.value,
        state: prior.confidence,
        at: prior.created_at,
      },
      {
        label: `Run ${current.run}`,
        sublabel: "Current",
        value: current.value,
        state: current.confidence,
        at: current.created_at,
      },
    ];
  } else if (group.members.length >= 2) {
    const newest = group.members[0];
    const older = group.members[group.members.length - 1];
    sides = [
      {
        label: formatAbsolute(older.created_at, false),
        value: older.value,
        state: rowState(older),
        at: older.created_at,
      },
      {
        label: formatAbsolute(newest.created_at, false),
        sublabel: "Current",
        value: newest.value,
        state: rowState(newest),
        at: newest.created_at,
      },
    ];
  }

  if (sides) {
    const [a, b] = sides;
    const deltaPct =
      a.value !== null && b.value !== null && a.value !== 0
        ? ((b.value - a.value) / Math.abs(a.value)) * 100
        : null;

    lines.push({
      label: "Answer",
      a: fmt(a.value, hint, unit, true),
      b: fmt(b.value, hint, unit, true),
      changed: a.value !== b.value,
      deltaPct,
    });
    lines.push({
      label: "Confidence",
      a: CONFIDENCE[a.state].label,
      b: CONFIDENCE[b.state].label,
      changed: a.state !== b.state,
    });
    if (a.at && b.at) {
      lines.push({
        label: "Recorded",
        a: formatAbsolute(a.at),
        b: formatAbsolute(b.at),
        changed: a.at !== b.at,
      });
    }
  }

  if (answer) {
    for (const check of answer.report?.checks ?? []) {
      lines.push({
        label: check.label,
        a: STATUS_LABEL[check.status],
        b: STATUS_LABEL[check.status],
        changed: false,
      });
    }
    if (answer.definition_used) {
      lines.push({
        label: "Definition used",
        a: `${answer.definition_used.name} v${answer.definition_used.version}`,
        b: `${answer.definition_used.name} v${answer.definition_used.version}`,
        changed: false,
      });
    }
    if (typeof answer.scanned_rows === "number") {
      lines.push({
        label: "Rows scanned",
        a: formatCount(answer.scanned_rows),
        b: formatCount(answer.scanned_rows),
        changed: false,
      });
    }
  }

  return { sides, lines, summary, why, paths };
}

export function DiffDialog({
  group,
  answer,
  loading,
  error,
  onRetry,
  onClose,
  onOpen,
}: {
  group: LedgerGroup | null;
  answer: Answer | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  onOpen: (group: LedgerGroup) => void;
}) {
  const model = React.useMemo(
    () => (group ? buildDiff(group, answer) : null),
    [group, answer],
  );

  if (!group || !model) return null;

  const changed = model.lines.filter((l) => l.changed);
  const unchanged = model.lines.filter((l) => !l.changed);
  const sides = model.sides;

  return (
    <Dialog
      open
      onClose={onClose}
      width="wide"
      title="Answered 2 ways"
      description={group.lead.question}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" variant="primary" onClick={() => onOpen(group)}>
            <ArrowUpRight size={13} aria-hidden="true" />
            Open answer
          </Button>
        </>
      }
    >
      <ConfidenceSeal
        size="banner"
        state="contested"
        headline={
          model.summary ??
          "Two runs of an equivalent question produced different numbers."
        }
      />

      {model.why ? (
        <p className="mt-3 text-ui text-secondary">{model.why}</p>
      ) : null}

      {loading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-[92px] w-full rounded-lg" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-start gap-3 rounded-md border border-contested-border bg-contested-bg px-3 py-2.5">
          <p className="flex-1 text-ui text-contested">{error}</p>
          <Button size="xs" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {sides ? (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {sides.map((side, i) => {
            const deltaLine =
              i === 1 ? changed.find((l) => l.label === "Answer") : null;
            const dir = deltaLine
              ? deltaDirection(deltaLine.deltaPct ?? null)
              : "flat";
            return (
              <div
                key={side.label}
                className="rounded-lg border border-border-default bg-surface-1 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label text-tertiary uppercase">
                    {side.label}
                  </span>
                  {side.sublabel ? (
                    <span className="text-ui-sm text-tertiary">
                      {side.sublabel}
                    </span>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-title-lg tabular",
                    side.value !== null ? "text-primary" : "text-disabled",
                  )}
                >
                  {fmt(
                    side.value,
                    group.lead.format_hint,
                    group.lead.unit,
                    true,
                  )}
                </p>
                {deltaLine && deltaLine.deltaPct !== null ? (
                  <p
                    className={cn(
                      "mt-1 text-ui-sm tabular",
                      dir === "up"
                        ? "text-verified"
                        : dir === "down"
                          ? "text-contested"
                          : "text-tertiary",
                    )}
                  >
                    {formatDelta(deltaLine.deltaPct ?? null, sides[0].label)}
                  </p>
                ) : null}
                <div className="mt-2.5 flex items-center gap-2">
                  <ConfidenceSeal state={side.state} size="inline" />
                  {side.at ? (
                    <time
                      dateTime={side.at}
                      title={isoTitle(side.at)}
                      className="text-ui-sm tabular text-tertiary"
                    >
                      {formatAbsolute(side.at)}
                    </time>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {changed.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-lg border border-border-default">
          <div className="flex h-8 items-center border-b border-border-default bg-surface-2 px-3 text-label text-tertiary uppercase">
            What changed
          </div>
          {changed.map((line) => (
            <DiffRow key={line.label} line={line} sides={model.sides} />
          ))}
        </div>
      ) : null}

      {unchanged.length > 0 ? (
        <Disclosure
          className="mt-3"
          summary={`Show ${unchanged.length} unchanged row${unchanged.length === 1 ? "" : "s"}`}
        >
          <div className="mt-1.5 overflow-hidden rounded-lg border border-border-default">
            {unchanged.map((line) => (
              <DiffRow key={line.label} line={line} sides={model.sides} muted />
            ))}
          </div>
        </Disclosure>
      ) : null}

      {model.paths.length > 0 ? (
        <div className="mt-5">
          <p className="mb-1.5 text-label text-tertiary uppercase">
            Derivation
          </p>
          <SqlViewer paths={model.paths} maxHeight={220} />
        </div>
      ) : null}
    </Dialog>
  );
}

function DiffRow({
  line,
  sides,
  muted = false,
}: {
  line: DiffLine;
  sides: [DiffSide, DiffSide] | null;
  muted?: boolean;
}) {
  const dir = deltaDirection(line.deltaPct ?? null);
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2 last:border-0",
        "xl:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] xl:items-baseline",
      )}
    >
      <span
        className={cn("text-ui", muted ? "text-tertiary" : "text-secondary")}
      >
        {line.label}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-ui-sm text-tertiary xl:hidden">
          {sides?.[0].label ?? "Before"}
        </span>
        <span
          className={cn("tabular", muted ? "text-tertiary" : "text-primary")}
        >
          {line.a}
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-ui-sm text-tertiary xl:hidden">
          {sides?.[1].label ?? "After"}
        </span>
        <span
          className={cn(
            "tabular",
            muted ? "text-tertiary" : "text-primary",
            line.changed && "rounded-xs bg-qualified-bg px-1.5",
          )}
        >
          {line.b}
        </span>
        {line.changed &&
        line.deltaPct !== null &&
        line.deltaPct !== undefined ? (
          <span
            className={cn(
              "text-ui-sm tabular",
              dir === "up"
                ? "text-verified"
                : dir === "down"
                  ? "text-contested"
                  : "text-tertiary",
            )}
          >
            {formatDelta(line.deltaPct, sides?.[0].label ?? "the earlier run")}
          </span>
        ) : null}
      </span>
    </div>
  );
}
