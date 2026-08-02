"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw, Search, TriangleAlert } from "lucide-react";
import type { Watch, WatchEvent } from "@/lib/api/types";
import {
  ApiFailure,
  getWatch,
  getWatchEvents,
  getWatches,
} from "@/lib/api/client";
import { deriveState, tally } from "@/lib/confidence";
import { formatAbsolute, formatRelative, isoTitle } from "@/lib/format";
import { TriangleAlertFilled } from "@/components/seal/glyphs";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useEvidence } from "@/state/evidence";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { StateSwitcher, type DemoState } from "@/components/investigations/state-switcher";
import { WatchStatusTag, describeCondition } from "./model";
import { NotificationsButton } from "./notifications";
import { WatchControls } from "./watch-controls";
import { BreachLine, WatchBandCard, WatchBandSkeleton } from "./watch-band-card";
import { PreAlertChecks, PreAlertSkeleton } from "./pre-alert-checks";
import { EventHistorySkeleton, WatchEventHistory } from "./event-history";

const POLL_MS = 12_000;

export function WatchDetail({ id }: { id: string }) {
  const setSubject = useEvidence((s) => s.setSubject);

  const [demo, setDemo] = React.useState<DemoState>("live");
  const [watch, setWatch] = React.useState<Watch | null>(null);
  const [events, setEvents] = React.useState<WatchEvent[]>([]);
  const [siblings, setSiblings] = React.useState<Watch[]>([]);
  const [failure, setFailure] = React.useState<{ code: string; message: string } | null>(
    null,
  );
  const [readError, setReadError] = React.useState<string | null>(null);
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);


  /**
   * The page keys this component on `id`, so a route change remounts it and
   * local state resets without an effect writing to it.
   */
  const [reload, setReload] = React.useState(0);
  /** True once a read has succeeded — after that a poll failure badges, never blanks. */
  const hasRead = React.useRef(false);

  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      setPolling(true);
      try {
        const [found, list] = await Promise.all([getWatch(id), getWatchEvents(id)]);
        if (!alive) return;
        hasRead.current = true;
        setWatch(found);
        setEvents(list);
        setReadError(null);
        setFailure(null);
        setCheckedAt(new Date().toISOString());
      } catch (e) {
        if (!alive) return;
        const f = e as ApiFailure;
        if (hasRead.current)
          setReadError("The last read failed — showing the previous reading.");
        else setFailure({ code: f.code ?? "unknown", message: f.message });
      } finally {
        if (alive) setPolling(false);
      }
    };

    void run();
    void getWatches()
      .then(setSiblings)
      .catch(() => setSiblings([]));

    const t = window.setInterval(() => void run(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [id, reload]);

  const checks = watch?.pre_alert_checks ?? [];
  const state = checks.length ? deriveState(checks) : "unverified";
  const counts = tally(checks);

  React.useEffect(() => {
    if (!watch) return;
    setSubject({
      id: watch.id,
      label: "this watch",
      title: watch.name,
      state,
      headline: checks.find((c) => c.status === "warn" || c.status === "fail")?.finding,
      checks,
      passed: counts.passed,
      total: counts.total,
      definitions: [{ id: watch.definition_id, name: watch.definition_name }],
    });
    // `checks`/`counts` are derived from `watch`; watching it is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch, setSubject, state]);

  const loading = demo === "loading" || (!watch && !failure);
  const investigationId = events.find((e) => e.investigation_id)?.investigation_id ?? null;
  const effectiveError = demo === "error" ? "The last read failed — showing the previous reading." : readError;

  const header = (
    <SurfaceHeader
      crumbs={[{ label: "Watches", href: "/watches" }, { label: watch?.name ?? "Watch" }]}
      actions={
        <>
          <span className="flex items-center gap-1.5 text-ui-sm text-tertiary">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full bg-verified ${polling ? "ds-pulse-accent" : ""}`}
            />
            {checkedAt ? `Checked ${formatRelative(checkedAt)}` : "Checking"}
          </span>
          <NotificationsButton watches={siblings} />
          <StateSwitcher
            value={demo}
            onChange={setDemo}
            options={["live", "loading", "error"]}
          />
        </>
      }
    />
  );

  if (failure && demo !== "loading") {
    return (
      <>
        {header}
        <SurfaceBody>
          <Card className="mx-auto max-w-[560px]">
            <h2 className="text-subtitle text-primary">
              {failure.code === "not_found"
                ? "This watch no longer exists"
                : "The watch did not load"}
            </h2>
            <p className="mt-1.5 text-ui-sm text-secondary">{failure.message}</p>
            <div className="mt-4 flex items-center gap-2">
              <Link href="/watches">
                <Button variant="secondary" size="md">
                  <ArrowLeft size={14} />
                  All watches
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setFailure(null);
                  setReload((n) => n + 1);
                }}
              >
                <RotateCw size={14} />
                Retry
              </Button>
            </div>
          </Card>
        </SurfaceBody>
      </>
    );
  }

  if (loading || !watch) {
    return (
      <>
        {header}
        <SurfaceBody>
          <div className="space-y-6">
            <div>
              <Skeleton className="h-6 w-72" />
              <Skeleton className="mt-2 h-3 w-48" />
            </div>
            <WatchBandSkeleton />
            <Skeleton className="h-11 w-full rounded-md" />
            <PreAlertSkeleton />
            <EventHistorySkeleton />
          </div>
        </SurfaceBody>
      </>
    );
  }

  const firing = watch.status === "firing";

  return (
    <>
      {header}
      <SurfaceBody>
        <div className="space-y-6 pb-8">
          {/* Header row: name, grain, and the firing stamp. §9.2 */}
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-title-lg text-primary">{watch.name}</h2>
              <WatchStatusTag status={watch.status} />
              <span className="flex-1" />
              {firing && watch.last_fired_at ? (
                <span
                  className="flex items-center gap-1.5 text-subtitle text-qualified"
                  title={isoTitle(watch.last_fired_at)}
                >
                  <TriangleAlertFilled size={15} />
                  Firing since {formatAbsolute(watch.last_fired_at).split(", ")[1]}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-ui-sm text-tertiary">
              {watch.definition_name} · {describeCondition(watch)} · {watch.schedule}
            </p>
          </header>

          {effectiveError ? (
            <p className="flex items-start gap-2 rounded-md border border-contested-border bg-contested-bg px-3 py-2.5 text-ui text-contested">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              {effectiveError} Last successful read{" "}
              {checkedAt ? formatRelative(checkedAt) : "unknown"}.
            </p>
          ) : null}

          <WatchBandCard watch={watch} />

          <BreachLine watch={watch} />

          {checks.length > 0 ? (
            <PreAlertChecks
              checks={checks}
              state={state}
              heldHours={watch.held_hours}
              heldReason={watch.held_reason}
            />
          ) : (
            <section>
              <h3 className="text-label text-tertiary uppercase">
                Before alerting, we checked
              </h3>
              <p className="mt-3 rounded-lg border border-border-default bg-surface-1 px-3 py-4 text-ui-sm text-secondary">
                This watch has not fired, so no pre-alert checks have run yet. When it
                does, freshness, row counts, period completeness and the definition are
                checked before anyone is notified — and the alert is held if any of them
                raises a caveat.
              </p>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {investigationId ? (
              <Link href={`/investigations/${investigationId}`}>
                <Button variant="primary" size="md">
                  <Search size={14} />
                  Investigate
                </Button>
              </Link>
            ) : (
              <Link href="/investigations">
                <Button variant="primary" size="md">
                  <Search size={14} />
                  Investigate
                </Button>
              </Link>
            )}
            <WatchControls watch={watch} onChanged={setWatch} />
          </div>

          <WatchEventHistory watch={watch} events={events} />
        </div>
      </SurfaceBody>

    </>
  );
}
