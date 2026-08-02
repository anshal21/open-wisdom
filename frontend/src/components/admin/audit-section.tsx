"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import type { AuditEntry, User } from "@/lib/api/types";
import { ApiFailure, getAudit, getUsers } from "@/lib/api/client";
import {
  formatAbsolute,
  formatCount,
  formatDuration,
  isoTitle,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Avatar, Input } from "@/components/ui/primitives";
import { SqlBlock } from "@/components/ui/sql-viewer";
import { DataTable, type Column } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { DemoState } from "./demo";
import { canOpen, type SpecRole } from "./roles";
import {
  PermissionEmpty,
  SectionError,
  SectionShell,
  SectionTableSkeleton,
} from "./section-frame";

/* ---------------------------------------------------------------------------
   CSV — a real client-side Blob download, RFC4180 quoting
--------------------------------------------------------------------------- */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function download(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
   Section
--------------------------------------------------------------------------- */

export function AuditSection({
  role,
  demo,
}: {
  role: SpecRole;
  demo: DemoState;
}) {
  const { toast } = useToast();
  const [entries, setEntries] = React.useState<AuditEntry[] | null>(null);
  const [users, setUsers] = React.useState<User[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // Reset inside the async body, not in the effect itself: a
      // synchronous set here commits a render purely to blank the
      // screen, then commits again the moment data arrives.
      setEntries(null);
      setError(null);
      try {
        const [list, people] = await Promise.all([getAudit(), getUsers()]);
        if (!alive) return;
        setEntries(list);
        setUsers(people);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The audit record did not load.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads]);

  const nameOf = React.useCallback(
    (id: string) => users.find((u) => u.id === id)?.name ?? id,
    [users],
  );
  const initialsOf = React.useCallback(
    (id: string) => users.find((u) => u.id === id)?.initials ?? "··",
    [users],
  );

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!entries) return [];
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        nameOf(e.principal).toLowerCase().includes(needle) ||
        e.source_name.toLowerCase().includes(needle) ||
        e.statement.toLowerCase().includes(needle),
    );
  }, [entries, q, nameOf]);

  const columns: Column<AuditEntry>[] = React.useMemo(
    () => [
      {
        key: "at",
        header: "Timestamp",
        width: "168px",
        render: (e) => (
          // A record that says "2 months ago" is not a record. §10.2
          <time
            dateTime={e.at}
            title={isoTitle(e.at)}
            className="tabular text-secondary"
          >
            {formatAbsolute(e.at)}
          </time>
        ),
      },
      {
        key: "principal",
        header: "Principal",
        width: "180px",
        render: (e) => (
          <span className="flex items-center gap-1.5">
            <Avatar initials={initialsOf(e.principal)} size={18} />
            <span className="truncate text-primary">{nameOf(e.principal)}</span>
          </span>
        ),
      },
      {
        key: "source",
        header: "Source",
        width: "168px",
        render: (e) => (
          <span className="truncate text-secondary">{e.source_name}</span>
        ),
      },
      {
        key: "rows",
        header: "Rows",
        numeric: true,
        width: "88px",
        render: (e) => (
          <span className="text-secondary">{formatCount(e.row_count)}</span>
        ),
      },
      {
        key: "elapsed",
        header: "Elapsed",
        numeric: true,
        width: "88px",
        render: (e) => (
          <span className="text-tertiary">{formatDuration(e.elapsed_ms)}</span>
        ),
      },
      {
        key: "answer",
        header: "Answer",
        width: "108px",
        render: (e) =>
          e.answer_id ? (
            <Link
              href={`/a/${e.answer_id}`}
              className="text-accent transition-colors duration-100 hover:underline"
            >
              Open
            </Link>
          ) : (
            <span
              className="text-disabled"
              title="This query ran outside an answer"
            >
              —
            </span>
          ),
      },
    ],
    [initialsOf, nameOf],
  );

  if (!canOpen("audit", role))
    return <PermissionEmpty section="audit" role={role} />;
  if (demo === "error" || error)
    return (
      <SectionError
        section="audit"
        message={
          demo === "error"
            ? "The audit store did not answer. Queries continue to be recorded; this is a read failure."
            : (error as string)
        }
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  if (demo === "loading" || !entries) return <SectionTableSkeleton rows={8} />;

  const exportCsv = () => {
    const header = [
      "timestamp",
      "principal",
      "principal_id",
      "source",
      "row_count",
      "elapsed_ms",
      "answer_id",
      "statement",
    ];
    const body = filtered.map((e) => [
      new Date(e.at).toISOString(),
      nameOf(e.principal),
      e.principal,
      e.source_name,
      e.row_count,
      e.elapsed_ms,
      e.answer_id ?? "",
      e.statement,
    ]);
    download(
      `audit-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([header, ...body]),
    );
    toast({
      kind: "success",
      message: `Exported ${filtered.length} audit records`,
    });
  };

  const active = filtered.find((e) => e.id === selected) ?? null;

  return (
    <SectionShell
      section="audit"
      actions={
        <Button size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={13} strokeWidth={2.25} />
          Export CSV
        </Button>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="relative w-[280px]">
          <Search
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by person, source or statement"
            aria-label="Filter the audit record"
            className="pl-7"
          />
        </div>
        <span className="text-ui-sm tabular text-tertiary">
          {formatCount(filtered.length)} of {formatCount(entries.length)}{" "}
          records
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(e) => e.id}
        selectedKey={selected}
        onRowActivate={(e) =>
          setSelected((cur) => (cur === e.id ? null : e.id))
        }
        density="compact"
        empty={
          <p className="px-3 py-6 text-ui-sm text-tertiary">
            No record matches that filter. The audit keeps every query this
            workspace has issued, including the ones that returned nothing.
          </p>
        }
      />

      {active ? (
        <div className="ds-fade mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-inset">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-default bg-surface-2 px-3 py-2">
            <span className="text-label text-tertiary uppercase">
              Statement
            </span>
            <span className="text-ui-sm tabular text-tertiary">
              {formatCount(active.row_count)} rows ·{" "}
              {formatDuration(active.elapsed_ms)} · {active.source_name}
            </span>
            <span className="flex-1" />
            <span className="text-ui-sm tabular text-tertiary">
              {formatAbsolute(active.at)}
            </span>
          </div>
          <SqlBlock sql={active.statement} maxHeight={240} />
        </div>
      ) : (
        <p className="mt-3 text-ui-sm text-tertiary">
          Select a record to read the statement the warehouse actually received.
        </p>
      )}
    </SectionShell>
  );
}
