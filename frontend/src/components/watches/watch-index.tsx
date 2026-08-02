"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Radar, RotateCw, TriangleAlert } from "lucide-react";
import type { Definition, Watch } from "@/lib/api/types";
import {
  ApiFailure,
  createWatch,
  getDefinitions,
  getWatch,
  getWatches,
} from "@/lib/api/client";
import { formatAbsolute, formatRelative, isoTitle } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { StateSwitcher, type DemoState } from "@/components/investigations/state-switcher";
import { WatchStatusTag, describeCondition } from "./model";
import { NotificationsButton } from "./notifications";
import { WatchFormDialog } from "./watch-form-dialog";

const POLL_MS = 12_000;

/** Live status polling, stated plainly. A subtle indicator, never a spinner. */
function LiveIndicator({ at, busy }: { at: string | null; busy: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-ui-sm text-tertiary">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full bg-verified ${busy ? "ds-pulse-accent" : ""}`}
      />
      {at ? `Checked ${formatRelative(at)}` : "Checking"}
    </span>
  );
}

function Recipients({ list }: { list?: string[] }) {
  if (!list || list.length === 0) return <span className="text-disabled">—</span>;
  const shown = list.slice(0, 3);
  return (
    <span className="inline-flex items-center gap-1" title={list.join(", ")}>
      {shown.map((r) => (
        <Avatar key={r} initials={r.slice(0, 1).toUpperCase()} />
      ))}
      {list.length > shown.length ? (
        <span className="text-ui-sm tabular text-tertiary">
          +{list.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

export function WatchIndex() {
  const router = useRouter();
  const { toast } = useToast();

  const [demo, setDemo] = React.useState<DemoState>("live");
  const [watches, setWatches] = React.useState<Watch[] | null>(null);
  const [definitions, setDefinitions] = React.useState<Definition[]>([]);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);

  const [reload, setReload] = React.useState(0);

  /**
   * Initial read plus the streaming state: live status polling. No spinner —
   * a pulsing dot and a "checked <when>" stamp, so the surface reads current.
   */
  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      setBusy(true);
      try {
        const list = await getWatches();
        if (!alive) return;
        setWatches(list);
        setFailure(null);
        setCheckedAt(new Date().toISOString());

        // Firing watches get a targeted re-read. A failure badges that row and
        // leaves every other row alone.
        const firing = list.filter((w) => w.status === "firing");
        const reads = await Promise.allSettled(firing.map((w) => getWatch(w.id)));
        if (!alive) return;
        const next: Record<string, string> = {};
        reads.forEach((r, i) => {
          if (r.status === "rejected")
            next[firing[i].id] = "Last read failed — the source did not answer.";
        });
        setErrors(next);
      } catch (e) {
        if (!alive) return;
        setFailure((e as ApiFailure).message ?? "The watches could not be loaded.");
      } finally {
        if (alive) setBusy(false);
      }
    };

    void run();
    void getDefinitions()
      .then(setDefinitions)
      .catch(() => setDefinitions([]));

    const t = window.setInterval(() => void run(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [reload]);

  const loading = demo === "loading" || (!watches && !failure);
  const base = React.useMemo(
    () => (demo === "empty" ? [] : (watches ?? [])),
    [demo, watches],
  );
  const showFailure = Boolean(failure) && demo !== "empty" && demo !== "loading";

  // Per-watch error badge — a failed row never takes the table down with it.
  const rowErrors = React.useMemo(() => {
    if (demo !== "error" || base.length === 0) return errors;
    return { ...errors, [base[0].id]: "Last read failed — the source did not answer." };
  }, [demo, base, errors]);

  const columns: Column<Watch>[] = [
    {
      key: "metric",
      header: "Metric",
      render: (w) => (
        <span className="inline-flex items-center gap-2">
          <span className="text-primary">{w.name}</span>
          {rowErrors[w.id] ? (
            <span
              title={rowErrors[w.id]}
              className="inline-flex h-5 items-center gap-1 rounded-xs border border-contested-border bg-contested-bg px-1.5 text-label text-contested uppercase"
            >
              <TriangleAlert size={10} strokeWidth={2.2} />
              Read failed
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "condition",
      header: "Condition",
      width: "260px",
      render: (w) => <span className="text-secondary">{describeCondition(w)}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (w) => <WatchStatusTag status={w.status} />,
    },
    {
      key: "last_fired",
      header: "Last fired",
      width: "150px",
      render: (w) =>
        w.last_fired_at ? (
          <time
            dateTime={isoTitle(w.last_fired_at)}
            title={formatAbsolute(w.last_fired_at)}
            className="text-tertiary tabular"
          >
            {formatRelative(w.last_fired_at)}
          </time>
        ) : (
          <span className="text-disabled">—</span>
        ),
    },
    {
      key: "recipients",
      header: "Recipients",
      width: "130px",
      render: (w) => <Recipients list={w.recipients} />,
    },
  ];

  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Watches" }]}
        actions={
          <>
            <LiveIndicator at={checkedAt} busy={busy} />
            <NotificationsButton watches={base} />
            <StateSwitcher
              value={demo}
              onChange={setDemo}
              options={["live", "loading", "empty", "error"]}
            />
            <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} />
              New watch
            </Button>
          </>
        }
      />
      <SurfaceBody wide>
        {showFailure && demo === "live" && !watches ? (
          <Card className="mx-auto max-w-[560px]">
            <h2 className="text-subtitle text-primary">The watches did not load</h2>
            <p className="mt-1.5 text-ui-sm text-secondary">{failure}</p>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setWatches(null);
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
            rows={base}
            loading={loading}
            skeletonRows={6}
            getKey={(w) => w.id}
            selectedKey={selected}
            onRowFocus={(w) => setSelected(w.id)}
            onRowActivate={(w) => router.push(`/watches/${w.id}`)}
            empty={
              <EmptyState
                icon={<Radar size={20} />}
                headline="Nothing is being watched"
                body="A watch turns a ratified definition into a standing question, and only notifies you once its pre-alert checks agree the move is real."
                action={
                  <Button variant="primary" size="md" onClick={() => setFormOpen(true)}>
                    <Plus size={14} />
                    New watch
                  </Button>
                }
              />
            }
          />
        )}
      </SurfaceBody>

      <WatchFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        mode="create"
        definitions={definitions}
        watches={watches ?? []}
        onSubmit={(created) => {
          // The dialog builds the watch locally; the server is what makes it
          // exist. Persist first, then claim it.
          void createWatch({
            definition_id: created.definition_id,
            schedule: created.schedule,
            condition: created.condition,
          })
            .then((saved) => {
              setWatches((list) => [{ ...created, ...saved }, ...(list ?? [])]);
              toast({
                kind: "success",
                message: `Watch created — ${created.name}.`,
                action: {
                  label: "Open",
                  onClick: () => router.push(`/watches/${saved.id ?? created.id}`),
                },
              });
            })
            .catch(() =>
              toast({
                kind: "error",
                message: "The watch could not be created. Nothing was saved.",
              }),
            );
        }}
      />
    </>
  );
}
