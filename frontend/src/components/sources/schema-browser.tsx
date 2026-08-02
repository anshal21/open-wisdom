"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Search } from "lucide-react";
import type { Cell, CatalogColumn, CatalogTable } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { EMPTY, formatCount, formatPercent } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, SectionLabel, Skeleton } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/table";
import { CardinalityBadge, RoleBadge } from "./schema-badges";

/* ---------------------------------------------------------------------------
   Pane 1 — table list, 240px, searchable
--------------------------------------------------------------------------- */

export function TableList({
  tables,
  selected,
  onSelect,
}: {
  tables: CatalogTable[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tables, q]);

  const move = (from: number, delta: number) => {
    const next = Math.max(0, Math.min(filtered.length - 1, from + delta));
    listRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tables"
          aria-label="Search tables"
          className="pl-7"
        />
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-label="Tables"
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-default bg-surface-1 p-1"
      >
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-ui-sm text-tertiary">
            No table matches <span className="font-mono text-mono-sm">{q}</span>.
          </p>
        ) : (
          filtered.map((t, i) => {
            const active = t.name === selected;
            return (
              <button
                key={t.name}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(t.name)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(i, 1);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(i, -1);
                  } else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(t.name);
                  }
                }}
                className={cn(
                  "relative flex h-8 w-full items-center justify-between gap-2 rounded-sm px-2 text-left transition-colors duration-100",
                  active
                    ? "bg-overlay-selected text-accent before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--c-accent-solid)] before:content-['']"
                    : "text-secondary hover:bg-overlay-hover hover:text-primary",
                )}
              >
                <span className="min-w-0 truncate font-mono text-mono-sm">{t.name}</span>
                <span className="shrink-0 text-ui-sm tabular text-tertiary">
                  {formatCount(t.row_count)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Pane 2 — table detail
--------------------------------------------------------------------------- */

const COLUMNS: Column<CatalogColumn>[] = [
  {
    key: "name",
    header: "Column",
    render: (c) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-mono-sm text-primary">{c.name}</span>
        <span className="shrink-0 font-mono text-mono-sm text-tertiary">{c.type}</span>
      </span>
    ),
  },
  {
    key: "role",
    header: "Role",
    width: "104px",
    render: (c) => <RoleBadge role={c.role} />,
  },
  {
    key: "null_rate",
    header: "Null",
    numeric: true,
    width: "72px",
    render: (c) => (
      <span className={c.null_rate >= 0.05 ? "text-qualified" : "text-secondary"}>
        {formatPercent(c.null_rate * 100)}
      </span>
    ),
  },
  {
    key: "distinct",
    header: "Distinct",
    numeric: true,
    width: "92px",
    render: (c) => <span className="text-secondary">{formatCount(c.distinct_count)}</span>,
  },
];

export function TableDetail({ table }: { table: CatalogTable }) {
  const piiCount = table.columns.filter((c) => c.role === "pii").length;

  return (
    <div className="min-w-0">
      <div className="mb-3">
        <h2 className="font-mono text-title text-primary">{table.name}</h2>
        <p className="mt-1 text-ui-sm tabular text-tertiary">
          {formatCount(table.row_count)} rows · {table.columns.length} columns ·{" "}
          {table.relationships.length} relationships
          {piiCount > 0 ? ` · ${piiCount} personal-data columns` : ""}
        </p>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={table.columns}
        getKey={(c) => c.name}
        density="compact"
      />

      <SectionLabel className="mt-5 mb-2" count={table.relationships.length}>
        Relationships
      </SectionLabel>
      {table.relationships.length === 0 ? (
        <p className="rounded-lg border border-border-default bg-surface-1 px-3 py-3 text-ui-sm text-tertiary">
          No relationship was inferred from this table&apos;s keys. Joins are still
          possible; they will be proposed at question time and checked for row loss.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border-default bg-surface-1">
          {table.relationships.map((r) => (
            <li
              key={`${r.from_column}-${r.to_table}-${r.to_column}`}
              className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle px-3 py-1.5 last:border-0"
            >
              <span className="font-mono text-mono-sm text-primary">{r.from_column}</span>
              <ArrowRight size={12} aria-hidden="true" className="text-tertiary" />
              <span className="font-mono text-mono-sm text-secondary">
                {r.to_table}.{r.to_column}
              </span>
              <span className="flex-1" />
              <CardinalityBadge cardinality={r.cardinality} />
            </li>
          ))}
        </ul>
      )}
      {table.relationships.some((r) => r.cardinality === "N:N") ? (
        <p className="mt-2 max-w-[64ch] text-ui-sm text-qualified">
          A many-to-many relationship multiplies rows when joined. Answers that cross
          it are checked for double counting before they are shown.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Pane 3 — sample rows, masked for personal data
--------------------------------------------------------------------------- */

const MASK = "••••••••";

function renderCell(value: Cell) {
  if (value === null || value === undefined)
    return <span className="text-disabled">{EMPTY}</span>;
  if (typeof value === "boolean")
    return <span className="text-secondary">{value ? "true" : "false"}</span>;
  if (typeof value === "number")
    return <span className="tabular text-secondary">{value.toLocaleString("en-US")}</span>;
  return (
    <span className="inline-block max-w-[220px] truncate align-bottom text-secondary">
      {value}
    </span>
  );
}

export function SampleRows({
  table,
  canUnmask,
  reason,
}: {
  table: CatalogTable;
  canUnmask: boolean;
  /** Why the current person cannot unmask, when they cannot. */
  reason: string;
}) {
  // The unmask is SCOPED TO A TABLE by construction rather than reset by an
  // effect. Re-masking on table change was previously a side effect that had
  // to fire correctly; here it cannot fail to happen, because revealing PII
  // for one table simply says nothing about another. For a control that
  // uncovers personal data, structural beats remembered.
  const [unmaskedTable, setUnmaskedTable] = React.useState<string | null>(null);
  const unmasked = unmaskedTable === table.name;
  const setUnmasked = (on: boolean) => setUnmaskedTable(on ? table.name : null);
  const masked = !unmasked;
  const piiColumns = table.columns.filter((c) => c.role === "pii");

  const columns: Column<Cell[]>[] = table.columns.map((c, i) => ({
    key: c.name,
    header: (
      <span className="inline-flex items-center gap-1">
        {c.name}
        {c.role === "pii" ? <span className="text-tertiary normal-case">(pii)</span> : null}
      </span>
    ),
    numeric: c.role === "measure",
    render: (row: Cell[]) =>
      c.role === "pii" && masked ? (
        <span className="font-mono text-mono-sm text-disabled" title="Masked personal data">
          {MASK}
        </span>
      ) : (
        renderCell(row[i])
      ),
  }));

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel count={table.sample_rows.length}>Sample rows</SectionLabel>
        {piiColumns.length > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={!canUnmask}
            title={canUnmask ? undefined : reason}
            onClick={() => setUnmasked(!unmasked)}
          >
            {masked ? <Eye size={13} /> : <EyeOff size={13} />}
            {masked ? "Show unmasked" : "Mask again"}
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={table.sample_rows}
        getKey={(_, i) => String(i)}
        density="compact"
        empty={
          <p className="px-3 py-4 text-ui-sm text-tertiary">
            No rows were sampled from this table at the last introspection.
          </p>
        }
      />

      {piiColumns.length > 0 ? (
        <p className="mt-2 max-w-[64ch] text-ui-sm text-tertiary">
          {piiColumns.length} column{piiColumns.length === 1 ? "" : "s"} detected as
          personal data{masked ? " and masked here" : " and shown unmasked"}. These are
          excluded from answers by default —{" "}
          <Link
            href="/settings/access#pii"
            className="text-accent transition-colors duration-100 hover:underline"
          >
            PII exposure policy
          </Link>
          {canUnmask ? "" : ` · ${reason}`}.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Loading — geometry matches the loaded panes exactly
--------------------------------------------------------------------------- */

export function TableListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-full rounded-sm" />
      <div className="rounded-lg border border-border-default bg-surface-1 p-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex h-8 items-center justify-between px-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableDetailSkeleton() {
  return (
    <div className="min-w-0">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-1.5 h-3 w-64" />
      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        <div className="h-9 border-b border-border-default bg-surface-2" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex h-8 items-center gap-3 border-b border-border-subtle px-3 last:border-0">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-5 h-3 w-28" />
      <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex h-9 items-center gap-3 border-b border-border-subtle px-3 last:border-0">
            <Skeleton className="h-3 w-56" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SampleRowsSkeleton() {
  return (
    <div className="min-w-0">
      <Skeleton className="h-3 w-24" />
      <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        <div className="h-9 border-b border-border-default bg-surface-2" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex h-8 items-center gap-3 border-b border-border-subtle px-3 last:border-0">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
