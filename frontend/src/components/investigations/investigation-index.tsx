"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RotateCw, Search } from "lucide-react";
import type { InvestigationSummary, User } from "@/lib/api/types";
import { ApiFailure, getInvestigations, getUsers } from "@/lib/api/client";
import { formatAbsolute, formatRelative, isoTitle } from "@/lib/format";
import { CONFIDENCE, HUE_CLASS } from "@/lib/confidence";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/table";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { cn } from "@/lib/cn";
import { StateSwitcher, type DemoState } from "./state-switcher";
import { VERDICT_META, stoppedShort } from "./model";

/**
 * `/investigations` — the index. screens.md §8.
 * Question · metric · verdict kind · where it stopped · who · when.
 */
export function InvestigationIndex() {
  const router = useRouter();
  const [demo, setDemo] = React.useState<DemoState>("live");
  const [rows, setRows] = React.useState<InvestigationSummary[] | null>(null);
  const [users, setUsers] = React.useState<User[]>([]);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const [list, people] = await Promise.all([getInvestigations(), getUsers()]);
        if (!alive) return;
        setRows(list);
        setUsers(people);
        setFailure(null);
      } catch (e) {
        if (!alive) return;
        setFailure((e as ApiFailure).message ?? "The list could not be loaded.");
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [reload]);

  const loading = demo === "loading" || (!rows && !failure);
  const data = demo === "empty" ? [] : (rows ?? []);
  const showFailure = demo === "error" || (Boolean(failure) && demo === "live");

  const columns: Column<InvestigationSummary>[] = [
    {
      key: "question",
      header: "Question",
      render: (r) => <span className="text-primary">{r.question}</span>,
    },
    {
      key: "metric",
      header: "Metric",
      width: "150px",
      render: (r) => <span className="text-secondary">{r.metric}</span>,
    },
    {
      key: "verdict",
      header: "Verdict",
      width: "190px",
      render: (r) => {
        const meta = VERDICT_META[r.verdict_kind];
        const hue = HUE_CLASS[CONFIDENCE[meta.state].hue];
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("shrink-0", hue.fg)}>
              <ConfidenceGlyph state={meta.state} size={12} />
            </span>
            <span className="text-secondary">{meta.label}</span>
          </span>
        );
      },
    },
    {
      key: "stopped",
      header: "Where it stopped",
      width: "180px",
      render: (r) =>
        r.stopped_at ? (
          <span className="inline-flex items-center gap-1.5 text-qualified">
            <span aria-hidden="true" className="text-[9px] leading-none">
              ■
            </span>
            {stoppedShort(r.stopped_at)}
          </span>
        ) : (
          <span className="text-tertiary">{stoppedShort(null)}</span>
        ),
    },
    {
      key: "who",
      header: "Who",
      width: "150px",
      render: (r) => {
        const u = users.find((x) => x.id === r.created_by);
        return (
          <span className="inline-flex items-center gap-1.5 text-secondary">
            <Avatar initials={u?.initials ?? "—"} />
            {u?.name ?? r.created_by}
          </span>
        );
      },
    },
    {
      key: "when",
      header: "When",
      width: "130px",
      render: (r) => (
        <time
          dateTime={isoTitle(r.created_at)}
          title={formatAbsolute(r.created_at)}
          className="text-tertiary"
        >
          {formatRelative(r.created_at)}
        </time>
      ),
    },
  ];

  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Investigations" }]}
        actions={
          <StateSwitcher
            value={demo}
            onChange={setDemo}
            options={["live", "loading", "empty", "error"]}
          />
        }
      />
      <SurfaceBody wide>
        {showFailure ? (
          <Card className="mx-auto max-w-[560px]">
            <h2 className="text-subtitle text-primary">The investigations did not load</h2>
            <p className="mt-1.5 text-ui-sm text-secondary">
              {failure ?? "The source did not answer in time."}
            </p>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setDemo("live");
                  setRows(null);
                  setFailure(null);
                  setReload((n) => n + 1);
                }}
              >
                <RotateCw size={14} />
                Retry
              </Button>
            </div>
          </Card>
        ) : (
          <DataTable
            columns={columns}
            rows={data}
            loading={loading}
            skeletonRows={6}
            getKey={(r) => r.id}
            selectedKey={selected}
            onRowFocus={(r) => setSelected(r.id)}
            onRowActivate={(r) => router.push(`/investigations/${r.id}`)}
            empty={
              <EmptyState
                icon={<Search size={20} />}
                headline="Start from a metric that moved"
                body="An investigation begins from an answer whose figure changed. Open the ledger, find the answer, and start the rule-out ladder from it."
                action={
                  <Link href="/ledger">
                    <Button variant="primary" size="md">
                      Open the ledger
                    </Button>
                  </Link>
                }
                secondary={
                  <Link href="/ask">
                    <Button variant="outline" size="md">
                      Ask a question
                    </Button>
                  </Link>
                }
              />
            }
          />
        )}
      </SurfaceBody>
    </>
  );
}
