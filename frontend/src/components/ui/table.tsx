"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./primitives";

/**
 * The workhorse table. design-system.md §9.8.
 * Real <table> semantics, sticky header, keyboard-navigable rows.
 */

export type Density = "compact" | "comfortable";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Numeric columns are right-aligned and tabular. */
  numeric?: boolean;
  width?: string;
  sortable?: boolean;
  render: (row: T, index: number) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  onRowActivate,
  selectedKey,
  density = "compact",
  sort,
  onSortChange,
  empty,
  loading = false,
  skeletonRows = 8,
  className,
  onRowFocus,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string;
  onRowActivate?: (row: T, index: number) => void;
  selectedKey?: string | null;
  density?: Density;
  sort?: { key: string; dir: "asc" | "desc" } | null;
  onSortChange?: (key: string) => void;
  empty?: React.ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  className?: string;
  onRowFocus?: (row: T, index: number) => void;
}) {
  const rowH = density === "compact" ? "h-8" : "h-10";
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);

  const move = (from: number, delta: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, from + delta));
    const el = bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[tabindex]")[
      next
    ];
    el?.focus();
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border-default bg-surface-1",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-ui">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="h-9 border-b border-border-default">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ width: c.width }}
                    aria-sort={
                      active
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : c.sortable
                          ? "none"
                          : undefined
                    }
                    className={cn(
                      "px-3 text-label whitespace-nowrap text-tertiary uppercase",
                      c.numeric ? "text-right" : "text-left",
                      c.className,
                    )}
                  >
                    {c.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(c.key)}
                        className={cn(
                          "group inline-flex items-center gap-1 transition-colors duration-100 hover:text-primary",
                          active && "text-primary",
                        )}
                      >
                        {c.header}
                        <span
                          className={cn(
                            "transition-opacity duration-100",
                            active ? "opacity-100" : "opacity-0 group-hover:opacity-60",
                          )}
                        >
                          {active && sort.dir === "asc" ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={i} className={cn(rowH, "border-b border-border-subtle")}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-3">
                        <Skeleton
                          className={cn("h-3", c.numeric ? "ml-auto w-16" : "w-full max-w-[220px]")}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, i) => {
                  const key = getKey(row, i);
                  const selected = selectedKey === key;
                  return (
                    <tr
                      key={key}
                      tabIndex={0}
                      data-selected={selected || undefined}
                      onFocus={() => onRowFocus?.(row, i)}
                      onClick={() => onRowActivate?.(row, i)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          move(i, 1);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          move(i, -1);
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          onRowActivate?.(row, i);
                        }
                      }}
                      className={cn(
                        "group relative border-b border-border-subtle transition-colors duration-100 last:border-0",
                        rowH,
                        onRowActivate && "cursor-pointer",
                        selected
                          ? "bg-overlay-selected"
                          : "hover:bg-overlay-hover focus:bg-overlay-hover",
                        "outline-offset-[-2px]",
                      )}
                    >
                      {columns.map((c, ci) => (
                        <td
                          key={c.key}
                          className={cn(
                            "px-3 whitespace-nowrap",
                            c.numeric ? "text-right tabular" : "text-left",
                            ci === 0 && selected
                              ? "before:absolute before:top-0 before:left-0 before:h-full before:w-0.5 before:bg-[var(--c-accent-solid)] before:content-['']"
                              : undefined,
                            c.className,
                          )}
                        >
                          {c.render(row, i)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && empty ? <div>{empty}</div> : null}
    </div>
  );
}

/** Row actions: visible on hover AND on keyboard focus. A hover-only affordance is a bug. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 group-focus:opacity-100">
      {children}
    </span>
  );
}
