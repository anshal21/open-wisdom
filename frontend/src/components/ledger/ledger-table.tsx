"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { FormatHint } from "@/lib/api/types";
import { CONFIDENCE } from "@/lib/confidence";
import { EMPTY, formatAbsolute, formatValue, isoTitle } from "@/lib/format";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { IconButton } from "@/components/ui/button";
import { Avatar, Skeleton } from "@/components/ui/primitives";
import type { LedgerGroup, RunEntry, SortKey, SortState } from "./model";

/* ---------------------------------------------------------------------------
   Column geometry. §5.1 fixes the columns; §9.8 fixes the confidence column at
   96px, immediately after the primary identifier.
--------------------------------------------------------------------------- */

const COL = {
  select: 32,
  answer: 116,
  confidence: 96,
  who: 44,
  when: 152,
  actions: 52,
};

export interface LedgerTableProps {
  groups: LedgerGroup[];
  loading: boolean;
  density: "compact" | "comfortable";
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (key: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  expanded: ReadonlySet<string>;
  onToggleExpand: (group: LedgerGroup) => void;
  runsFor: (group: LedgerGroup) => RunEntry[];
  focusedKey: string | null;
  onFocusRow: (group: LedgerGroup) => void;
  onOpen: (group: LedgerGroup) => void;
  onPreview: (group: LedgerGroup) => void;
  onRerun: (group: LedgerGroup) => void;
  onOpenDiff: (group: LedgerGroup) => void;
  /** Answer ids currently re-running. */
  running: ReadonlySet<string>;
  /** Answer ids whose figure changed in the last 800ms. */
  flashing: ReadonlySet<string>;
  /** Answer id → failure message. Rendered as a per-row badge. §14 */
  errors: ReadonlyMap<string, string>;
  initialsOf: (userId: string) => string;
  nameOf: (userId: string) => string;
  empty: React.ReactNode;
}

export function LedgerTable(props: LedgerTableProps) {
  const {
    groups,
    loading,
    density,
    sort,
    onSortChange,
    selected,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    expanded,
    onToggleExpand,
    runsFor,
    focusedKey,
    onFocusRow,
    onOpen,
    onPreview,
    onRerun,
    onOpenDiff,
    running,
    flashing,
    errors,
    initialsOf,
    nameOf,
    empty,
  } = props;

  const rowH = density === "compact" ? "h-8" : "h-10";
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const headCheckRef = React.useRef<HTMLInputElement>(null);

  const allSelected = groups.length > 0 && selected.size === groups.length;
  const someSelected = selected.size > 0 && !allSelected;

  React.useEffect(() => {
    if (headCheckRef.current) headCheckRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const move = (from: number, delta: number) => {
    const rows =
      bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-nav]");
    if (!rows?.length) return;
    const next = Math.max(0, Math.min(rows.length - 1, from + delta));
    rows[next]?.focus();
  };

  const indexOfRow = (el: HTMLTableRowElement) => {
    const rows = Array.from(
      bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-nav]") ??
        [],
    );
    return rows.indexOf(el);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface-1">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-ui">
          <colgroup>
            <col style={{ width: COL.select }} />
            <col />
            <col style={{ width: COL.answer }} />
            <col style={{ width: COL.confidence }} />
            <col style={{ width: COL.who }} />
            <col style={{ width: COL.when }} />
            <col style={{ width: COL.actions }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="h-9 border-b border-border-default">
              <th scope="col" className="px-3">
                <input
                  ref={headCheckRef}
                  type="checkbox"
                  aria-label={
                    allSelected ? "Clear selection" : "Select all answers"
                  }
                  checked={allSelected}
                  disabled={groups.length === 0}
                  onChange={() =>
                    allSelected ? onClearSelection() : onSelectAll()
                  }
                  className="h-3.5 w-3.5 align-middle accent-[var(--c-accent-solid)]"
                />
              </th>
              <SortableHeader
                label="Question"
                sortKey="question"
                sort={sort}
                onSortChange={onSortChange}
              />
              <SortableHeader
                label="Answer"
                sortKey="answer"
                sort={sort}
                onSortChange={onSortChange}
                numeric
              />
              <th
                scope="col"
                className="px-3 text-left text-label whitespace-nowrap text-tertiary uppercase"
              >
                Confidence
              </th>
              <th
                scope="col"
                className="px-3 text-left text-label whitespace-nowrap text-tertiary uppercase"
              >
                Who
              </th>
              <SortableHeader
                label="When"
                sortKey="when"
                sort={sort}
                onSortChange={onSortChange}
              />
              <th scope="col" className="px-3">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>

          <tbody ref={bodyRef}>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr
                    key={i}
                    className={cn(rowH, "border-b border-border-subtle")}
                  >
                    <td className="px-3">
                      <Skeleton className="h-3.5 w-3.5 rounded-xs" />
                    </td>
                    <td className="px-3">
                      <Skeleton
                        className="h-3"
                        style={{ width: `${52 + ((i * 37) % 38)}%` }}
                      />
                    </td>
                    <td className="px-3">
                      <Skeleton className="ml-auto h-3 w-16" />
                    </td>
                    <td className="px-3">
                      <Skeleton className="h-5 w-[84px] rounded-xs" />
                    </td>
                    <td className="px-3">
                      <Skeleton className="h-4 w-4 rounded-full" />
                    </td>
                    <td className="px-3">
                      <Skeleton className="h-3 w-24" />
                    </td>
                    <td className="px-3" />
                  </tr>
                ))
              : groups.map((group) => {
                  const lead = group.lead;
                  const isSelected = selected.has(group.key);
                  const isExpanded = expanded.has(group.key);
                  const meta = CONFIDENCE[group.state];
                  const error = errors.get(lead.id);
                  const busy = running.has(lead.id);
                  const runs = isExpanded ? runsFor(group) : [];

                  return (
                    <React.Fragment key={group.key}>
                      <tr
                        data-nav=""
                        tabIndex={0}
                        aria-selected={isSelected}
                        aria-expanded={
                          group.runCount > 1 ? isExpanded : undefined
                        }
                        onFocus={() => onFocusRow(group)}
                        onClick={() => onOpen(group)}
                        onKeyDown={(e) => {
                          const el = e.currentTarget;
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            move(indexOfRow(el), 1);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            move(indexOfRow(el), -1);
                          } else if (e.key === "ArrowRight") {
                            if (group.runCount > 1 && !isExpanded) {
                              e.preventDefault();
                              onToggleExpand(group);
                            }
                          } else if (e.key === "ArrowLeft") {
                            if (isExpanded) {
                              e.preventDefault();
                              onToggleExpand(group);
                            }
                          } else if (e.key === "Enter") {
                            e.preventDefault();
                            onOpen(group);
                          } else if (e.key === " ") {
                            e.preventDefault();
                            onPreview(group);
                          } else if (
                            e.key.toLowerCase() === "x" &&
                            !e.metaKey
                          ) {
                            e.preventDefault();
                            onToggleSelect(group.key);
                          } else if (
                            e.key.toLowerCase() === "r" &&
                            !e.metaKey
                          ) {
                            e.preventDefault();
                            onRerun(group);
                          } else if (
                            e.key.toLowerCase() === "a" &&
                            (e.metaKey || e.ctrlKey)
                          ) {
                            e.preventDefault();
                            onSelectAll();
                          } else if (e.key === "Escape" && selected.size > 0) {
                            e.preventDefault();
                            onClearSelection();
                          }
                        }}
                        className={cn(
                          "group relative cursor-pointer border-b border-border-subtle transition-colors duration-100 outline-offset-[-2px] last:border-0",
                          rowH,
                          isSelected
                            ? "bg-overlay-selected"
                            : "hover:bg-overlay-hover focus:bg-overlay-hover",
                          focusedKey === group.key &&
                            !isSelected &&
                            "bg-overlay-hover",
                        )}
                      >
                        <td
                          className={cn(
                            "px-3",
                            isSelected &&
                              "before:absolute before:top-0 before:left-0 before:h-full before:w-0.5 before:bg-accent-solid before:content-['']",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={`Select: ${lead.question}`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleSelect(group.key)}
                            className="h-3.5 w-3.5 align-middle accent-[var(--c-accent-solid)]"
                          />
                        </td>

                        <td className="max-w-0 px-3 whitespace-nowrap">
                          <span className="@container flex items-center gap-1.5">
                            {group.runCount > 1 ? (
                              <button
                                type="button"
                                aria-label={
                                  isExpanded
                                    ? "Collapse runs"
                                    : `Show ${group.runCount} runs`
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleExpand(group);
                                }}
                                className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-xs text-tertiary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary"
                              >
                                {isExpanded ? (
                                  <ChevronDown size={13} />
                                ) : (
                                  <ChevronRight size={13} />
                                )}
                              </button>
                            ) : (
                              <span
                                className="w-4 shrink-0"
                                aria-hidden="true"
                              />
                            )}

                            <span
                              title={lead.question}
                              className="min-w-0 flex-1 truncate text-primary"
                            >
                              {lead.question}
                            </span>

                            {group.runCount > 1 ? (
                              <span
                                title={`${group.runCount} runs of an equivalent question`}
                                className="inline-flex h-4 shrink-0 items-center rounded-xs border border-border-default bg-surface-2 px-1 text-label tabular text-tertiary"
                              >
                                × {group.runCount}
                              </span>
                            ) : null}

                            {group.diverged ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenDiff(group);
                                }}
                                title="Answered 2 ways — two runs produced different numbers. Compare them."
                                aria-label="Answered 2 ways. Compare the runs."
                                className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-contested-border bg-contested-bg px-1.5 text-label text-contested uppercase transition-colors duration-100 hover:border-border-hover"
                              >
                                <TriangleAlert size={11} aria-hidden="true" />
                                <span className="hidden @[360px]:inline">
                                  answered 2 ways
                                </span>
                              </button>
                            ) : null}

                            {error ? (
                              <span
                                title={error}
                                className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-contested-border bg-contested-bg px-1.5 text-label text-contested uppercase"
                              >
                                Re-run failed
                              </span>
                            ) : null}
                          </span>
                        </td>

                        <td className="px-3 text-right">
                          <FigureCell
                            value={lead.value}
                            rowCount={lead.row_count}
                            unit={lead.unit}
                            formatHint={lead.format_hint}
                            showsNumber={meta.showsNumber}
                            busy={busy}
                            flash={flashing.has(lead.id)}
                          />
                        </td>

                        <td className="px-3">
                          <ConfidenceSeal
                            state={group.state}
                            size="inline"
                            passed={lead.passed}
                            total={lead.total}
                          />
                        </td>

                        <td className="px-3">
                          <span title={nameOf(lead.created_by)}>
                            <Avatar initials={initialsOf(lead.created_by)} />
                          </span>
                        </td>

                        <td className="px-3 whitespace-nowrap">
                          <time
                            dateTime={lead.created_at}
                            title={isoTitle(lead.created_at)}
                            className="tabular text-tertiary"
                          >
                            {formatAbsolute(lead.created_at)}
                          </time>
                        </td>

                        <td className="px-3">
                          <span className="flex items-center justify-end gap-0.5 opacity-100 transition-opacity duration-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:group-focus:opacity-100">
                            <IconButton
                              label="Preview"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPreview(group);
                              }}
                            >
                              <Eye size={13} />
                            </IconButton>
                            <IconButton
                              label="Re-run"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRerun(group);
                              }}
                            >
                              <RotateCw
                                size={13}
                                className={cn(busy && "ds-spin")}
                              />
                            </IconButton>
                          </span>
                        </td>
                      </tr>

                      {isExpanded
                        ? runs.map((run, ri) => (
                            <RunRow
                              key={run.id}
                              run={run}
                              rowH={rowH}
                              last={ri === runs.length - 1}
                              initialsOf={initialsOf}
                              nameOf={nameOf}
                            />
                          ))
                        : null}

                      {isExpanded && runs.length === 0 ? (
                        <tr
                          className={cn(rowH, "border-b border-border-subtle")}
                        >
                          <td />
                          <td
                            colSpan={6}
                            className="px-3 text-ui-sm text-tertiary"
                          >
                            Loading runs…
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && groups.length === 0 ? <div>{empty}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Pieces
--------------------------------------------------------------------------- */

function SortableHeader({
  label,
  sortKey,
  sort,
  onSortChange,
  numeric = false,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn(
        "px-3 text-label whitespace-nowrap text-tertiary uppercase",
        numeric ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={cn(
          "group inline-flex items-center gap-1 text-label uppercase transition-colors duration-100 hover:text-primary",
          active && "text-primary",
        )}
      >
        {label}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={cn(
            "transition-all duration-100",
            active
              ? cn("opacity-100", sort.dir === "asc" && "rotate-180")
              : "opacity-0 group-hover:opacity-60",
          )}
        />
      </button>
    </th>
  );
}

function FigureCell({
  value,
  rowCount,
  unit,
  formatHint,
  showsNumber,
  busy,
  flash,
}: {
  value: number | null;
  rowCount?: number;
  unit: string;
  formatHint: FormatHint;
  showsNumber: boolean;
  busy?: boolean;
  flash?: boolean;
}) {
  const empty = !showsNumber || value === null;
  // A breakdown has no single figure, but "26 groups" says what the answer IS
  // where a dash says nothing.
  if (empty && showsNumber && (rowCount ?? 0) > 1) {
    return (
      <span className="inline-block rounded-xs px-1 tabular text-secondary">
        {rowCount} groups
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-block rounded-xs px-1 tabular",
        empty ? "text-disabled" : "text-primary",
        busy && "text-tertiary",
        flash && "ds-tint-settle",
      )}
    >
      {empty ? EMPTY : formatValue(value, formatHint, { unit })}
    </span>
  );
}

function RunRow({
  run,
  rowH,
  last,
  initialsOf,
  nameOf,
}: {
  run: RunEntry;
  rowH: string;
  last: boolean;
  initialsOf: (id: string) => string;
  nameOf: (id: string) => string;
}) {
  const meta = CONFIDENCE[run.state];
  return (
    <tr
      className={cn(
        "ds-fade border-b border-border-subtle bg-surface-2",
        rowH,
        last && "border-b border-border-default",
      )}
    >
      <td />
      <td className="max-w-0 px-3 whitespace-nowrap">
        <span className="flex items-center gap-2 pl-5">
          {run.runLabel ? (
            <span className="shrink-0 text-ui-sm tabular text-tertiary">
              {run.runLabel}
            </span>
          ) : null}
          <span title={run.question} className="truncate text-secondary">
            {run.question}
          </span>
          {run.current ? (
            <span className="shrink-0 text-label text-tertiary uppercase">
              current
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-3 text-right">
        <span
          className={cn(
            "tabular",
            meta.showsNumber && run.value !== null
              ? "text-secondary"
              : "text-disabled",
          )}
        >
          {meta.showsNumber && run.value !== null
            ? formatValue(run.value, run.format_hint, { unit: run.unit })
            : EMPTY}
        </span>
      </td>
      <td className="px-3">
        <ConfidenceSeal state={run.state} size="inline" />
      </td>
      <td className="px-3">
        {run.createdBy ? (
          <span title={nameOf(run.createdBy)}>
            <Avatar initials={initialsOf(run.createdBy)} />
          </span>
        ) : null}
      </td>
      <td className="px-3 whitespace-nowrap">
        <time
          dateTime={run.at}
          title={isoTitle(run.at)}
          className="tabular text-tertiary"
        >
          {formatAbsolute(run.at)}
        </time>
      </td>
      <td />
    </tr>
  );
}
