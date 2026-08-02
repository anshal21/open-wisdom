"use client";

import * as React from "react";
import type { UsageStats } from "@/lib/api/types";
import { ApiFailure, getUsage } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { formatCount, formatPercent } from "@/lib/format";
import { Sparkline } from "@/components/charts/answer-chart";
import { Avatar } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/table";
import type { DemoState } from "./demo";
import { canOpen, type SpecRole } from "./roles";
import {
  Group,
  PermissionEmpty,
  SectionError,
  SectionShell,
  SectionTableSkeleton,
} from "./section-frame";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2023-01` → `Jan 2023`. Periods arrive as strings; nothing is assumed. */
function formatPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function Tile({
  label,
  value,
  detail,
  sparkline,
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  sparkline?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-1 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-label text-tertiary uppercase">{label}</span>
        {sparkline}
      </div>
      {/* Numbers never animate — this paints once, at its final value. */}
      <p className="mt-1.5 text-title-lg tabular text-primary">{value}</p>
      <p className="mt-1 text-ui-sm text-secondary">{detail}</p>
    </div>
  );
}

export function UsageSection({
  role,
  demo,
}: {
  role: SpecRole;
  demo: DemoState;
}) {
  const [usage, setUsage] = React.useState<UsageStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // Reset inside the async body, not in the effect itself: a
      // synchronous set here commits a render purely to blank the
      // screen, then commits again the moment data arrives.
      setUsage(null);
      setError(null);
      try {
        const u = await getUsage();
        if (!alive) return;
        setUsage(u);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure ? err.message : "Usage could not be read.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads]);

  const columns: Column<UsageStats["per_person"][number]>[] =
    React.useMemo(() => {
      const total = usage?.per_person.reduce((n, p) => n + p.questions, 0) ?? 0;
      return [
        {
          key: "person",
          header: "Person",
          render: (p) => (
            <span className="flex items-center gap-2">
              <Avatar initials={p.initials} size={20} />
              <span className="truncate text-primary">{p.name}</span>
            </span>
          ),
        },
        {
          key: "questions",
          header: "Questions asked",
          numeric: true,
          width: "148px",
          render: (p) => (
            <span className="text-secondary">{formatCount(p.questions)}</span>
          ),
        },
        {
          key: "ratified",
          header: "Definitions ratified",
          numeric: true,
          width: "168px",
          render: (p) =>
            p.ratified > 0 ? (
              <span className="text-secondary">{formatCount(p.ratified)}</span>
            ) : (
              <span className="text-disabled" title="This role cannot ratify">
                —
              </span>
            ),
        },
        {
          key: "share",
          header: "Share of questions",
          numeric: true,
          width: "160px",
          render: (p) => <ShareCell questions={p.questions} total={total} />,
        },
      ];
    }, [usage]);

  if (!canOpen("usage", role))
    return <PermissionEmpty section="usage" role={role} />;
  if (demo === "error" || error)
    return (
      <SectionError
        section="usage"
        message={
          demo === "error"
            ? "The usage figures could not be read."
            : (error as string)
        }
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  if (demo === "loading" || !usage) return <SectionTableSkeleton rows={5} />;

  const history = usage.history;
  const first = history[0];
  const last = history[history.length - 1];
  const questionsDeltaPct =
    first && last && first.questions
      ? ((last.questions - first.questions) / first.questions) * 100
      : null;
  const coveragePoints =
    first && last ? last.coverage_pct - first.coverage_pct : null;

  return (
    <SectionShell section="usage">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Questions asked"
          value={formatCount(usage.questions_asked)}
          sparkline={
            <Sparkline
              values={history.map((h) => h.questions)}
              width={72}
              height={22}
            />
          }
          detail={
            questionsDeltaPct !== null && first && last ? (
              <>
                {formatCount(last.questions)} in {formatPeriod(last.period)} ·{" "}
                <span
                  className={cn(
                    questionsDeltaPct >= 0 ? "text-verified" : "text-secondary",
                  )}
                >
                  {questionsDeltaPct >= 0 ? "▲" : "▼"}{" "}
                  {formatPercent(Math.abs(questionsDeltaPct))} vs{" "}
                  {formatPeriod(first.period)}
                </span>
              </>
            ) : (
              "Across the recorded period"
            )
          }
        />
        <Tile
          label="Answers verified"
          value={formatCount(usage.answers_verified)}
          detail={
            <>
              of {formatCount(usage.questions_asked)} asked ·{" "}
              {formatPercent(
                (usage.answers_verified / usage.questions_asked) * 100,
              )}{" "}
              cross-derived and clean
            </>
          }
        />
        <Tile
          label="Fork rate"
          value={formatPercent(usage.fork_rate_pct)}
          detail="of questions were refused because more than one defensible reading existed"
        />
        <Tile
          label="Coverage"
          value={formatPercent(usage.coverage_pct)}
          sparkline={
            <Sparkline
              values={history.map((h) => h.coverage_pct)}
              width={72}
              height={22}
            />
          }
          detail={
            coveragePoints !== null && first ? (
              <>
                answered from a ratified definition ·{" "}
                <span
                  className={
                    coveragePoints >= 0 ? "text-verified" : "text-secondary"
                  }
                >
                  {coveragePoints >= 0 ? "▲" : "▼"}{" "}
                  {Math.abs(coveragePoints).toFixed(1)} points vs{" "}
                  {formatPeriod(first.period)}
                </span>
              </>
            ) : (
              "answered from a ratified definition"
            )
          }
        />
      </div>

      <Group title="Over time" className="mt-4">
        <div className="overflow-hidden rounded-lg border border-border-default">
          <table className="w-full border-collapse text-ui">
            <thead className="bg-surface-2">
              <tr className="h-9 border-b border-border-default">
                <th
                  scope="col"
                  className="px-3 text-left text-label text-tertiary uppercase"
                >
                  Period
                </th>
                <th
                  scope="col"
                  className="px-3 text-right text-label text-tertiary uppercase"
                >
                  Questions
                </th>
                <th
                  scope="col"
                  className="px-3 text-right text-label text-tertiary uppercase"
                >
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.period}
                  className="h-8 border-b border-border-subtle last:border-0"
                >
                  <td className="px-3 text-secondary">
                    {formatPeriod(h.period)}
                  </td>
                  <td className="px-3 text-right tabular text-secondary">
                    {formatCount(h.questions)}
                  </td>
                  <td className="px-3 text-right tabular text-secondary">
                    {formatPercent(h.coverage_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>

      <Group title="Per person" className="mt-4">
        <DataTable
          columns={columns}
          rows={usage.per_person}
          getKey={(p) => p.user_id}
          density="comfortable"
          empty={
            <p className="px-3 py-6 text-ui-sm text-tertiary">
              Nobody has asked a question yet. The first one will appear here
              the moment it is answered.
            </p>
          }
        />
        <p className="mt-3 max-w-[74ch] text-ui-sm text-tertiary">
          Ratification is a permission, so a zero in that column is usually a
          role, not a behaviour.
        </p>
      </Group>
    </SectionShell>
  );
}

function ShareCell({ questions, total }: { questions: number; total: number }) {
  const pct = total > 0 ? (questions / total) * 100 : 0;
  return (
    <span className="flex items-center justify-end gap-2">
      <span
        className="h-1 w-16 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${formatPercent(pct)} of questions asked`}
      >
        <span
          className="block h-full rounded-full bg-[var(--viz-1)]"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-10 text-right tabular text-secondary">
        {formatPercent(pct)}
      </span>
    </span>
  );
}
