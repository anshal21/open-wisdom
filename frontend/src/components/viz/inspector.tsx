"use client";

/**
 * The answer inspector — "what data am I seeing, from what process."
 *
 * The Grafana/Metabase-style panel inspect, adapted to this product's spine:
 * every number is an Answer with full provenance, so the inspector is a
 * drawer over that record. Three tabs:
 *
 *   Data       — the exact rows behind the visualization, exportable
 *   SQL        — the executed statement AND the independent derivation
 *   Provenance — definition + version, checks, cost, freshness, who/when,
 *                and the permalink to the full evidence page
 *
 * Nothing here is recomputed: it renders the stored Answer verbatim. If the
 * inspector disagreed with the chart, that would be a bug in the product's
 * whole thesis.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Answer } from "@/lib/api/types";
import { effectiveHint, formatAbsolute, formatCount, formatDuration, formatValue } from "@/lib/format";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { CheckRow } from "@/components/evidence/check-row";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { DataTable, type Column } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Tab = "data" | "sql" | "provenance";

export function AnswerInspector({
  answer,
  open,
  onClose,
}: {
  answer: Answer;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>("data");
  const { toast } = useToast();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Portal to <body>: the inspector is opened from inside dashboard tiles,
  // which the canvas positions with CSS transforms — and position:fixed
  // anchors to a transformed ancestor, not the viewport. Without the portal
  // the drawer renders clipped inside the tile it inspects.

  // The answer-level format hint describes the HEADLINE figure; applying
  // "percent" to a raw-measure column prints revenue as 2297175.1%. A column
  // wears the hint only when its values could plausibly be that hint.
  const hintFor = (i: number): typeof answer.format_hint =>
    effectiveHint(answer.format_hint, answer.rows.map((r) => r[i] as number | null));

  const columns: Column<(typeof answer.rows)[number]>[] = answer.columns.map((c, i) => ({
    key: c.name,
    header: c.label ?? c.name,
    numeric: c.type === "quantitative",
    render: (r) => (
      <span className={cn(c.type === "quantitative" && "tabular")}>
        {r[i] === null
          ? "—"
          : c.type === "quantitative" && typeof r[i] === "number"
            ? formatValue(r[i] as number, hintFor(i), { unit: answer.unit })
            : String(r[i])}
      </span>
    ),
  }));

  const csv = () => {
    const head = answer.columns.map((c) => c.name).join(",");
    const body = answer.rows
      .map((r) => r.map((v) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(","))
      .join("\n");
    const blob = new Blob([`${head}\n${body}`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${answer.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ kind: "success", message: `Exported ${formatCount(answer.rows.length)} rows` });
  };

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="Inspect answer">
      <button
        type="button"
        aria-label="Close inspector"
        onClick={onClose}
        className="absolute inset-0 bg-black/20"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-border-default bg-surface-1 shadow-lg">
        {/* Header: what this is + its standing */}
        <div className="flex items-start gap-3 border-b border-border-subtle p-4">
          <div className="min-w-0 flex-1">
            <p className="text-label uppercase text-tertiary">Inspect</p>
            <h2 className="mt-0.5 truncate text-subtitle text-primary">{answer.question}</h2>
          </div>
          <ConfidenceSeal
            state={
              answer.supersession
                ? "superseded"
                : (answer.report?.confidence ?? "refused")
            }
            size="standard"
            passed={answer.report?.passed}
            total={answer.report?.total}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-sm p-1 text-tertiary hover:bg-overlay-hover hover:text-primary"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs.
            role="tab" is load-bearing, not decoration: aria-selected is not a
            valid attribute on a plain button, so without it a screen reader
            announced three buttons with no indication of which one was open. */}
        <div
          role="tablist"
          className="flex items-center gap-1 border-b border-border-subtle px-4"
        >
          {(["data", "sql", "provenance"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`inspector-tab-${t}`}
              aria-controls="inspector-panel"
              onClick={() => setTab(t)}
              aria-selected={tab === t}
              className={cn(
                "border-b-2 px-2 py-2 text-ui capitalize transition-colors duration-100",
                tab === t
                  ? "border-border-accent text-primary"
                  : "border-transparent text-tertiary hover:text-primary",
              )}
            >
              {t === "sql" ? "SQL" : t}
            </button>
          ))}
          <span className="flex-1" />
          {tab === "data" ? (
            <Button size="xs" variant="ghost" onClick={csv}>
              Export CSV
            </Button>
          ) : null}
        </div>

        {/* Body */}
        <div
          role="tabpanel"
          id="inspector-panel"
          aria-labelledby={`inspector-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {tab === "data" ? (
            <>
              <p className="mb-2 text-ui-sm text-tertiary">
                {formatCount(answer.row_count)} rows — exactly what the chart renders, no
                resampling.
              </p>
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <DataTable columns={columns} rows={answer.rows} getKey={(_, i) => String(i)} density="compact" />
              </div>
            </>
          ) : null}

          {tab === "sql" ? (
            <SqlViewer
              paths={[
                { label: "Executed query", sql: answer.sql },
                ...(answer.sql_path_b
                  ? [{ label: "Independent derivation", sql: answer.sql_path_b }]
                  : []),
              ]}
              rowCount={answer.row_count}
              elapsedMs={answer.cost?.elapsed_ms}
            />
          ) : null}

          {tab === "provenance" ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui">
                <dt className="text-tertiary">Definition</dt>
                <dd className="text-primary">
                  {answer.definition_used
                    ? `${answer.definition_used.name} v${answer.definition_used.version ?? 1}`
                    : "none — ad-hoc interpretation"}
                </dd>
                <dt className="text-tertiary">Asked by</dt>
                <dd className="text-primary">{answer.created_by || "anonymous"}</dd>
                <dt className="text-tertiary">When</dt>
                <dd className="text-primary">{formatAbsolute(answer.created_at)}</dd>
                {answer.cost ? (
                  <>
                    <dt className="text-tertiary">Cost</dt>
                    <dd className="tabular text-primary">
                      {answer.cost.llm_calls} model calls · ${answer.cost.usd.toFixed(2)} ·{" "}
                      {formatDuration(answer.cost.elapsed_ms)}
                    </dd>
                  </>
                ) : null}
              </dl>
              {answer.report ? (
                <div>
                  <p className="mb-1.5 text-label uppercase text-tertiary">
                    Checks ({answer.report.passed} of {answer.report.total})
                  </p>
                  <div className="divide-y divide-border-subtle rounded-md border border-border-subtle">
                    {answer.report.checks.map((c) => (
                      <CheckRow key={c.id} check={c} />
                    ))}
                  </div>
                </div>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => window.open(`/a/${answer.id}`, "_blank")}>
                Open full evidence page
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
