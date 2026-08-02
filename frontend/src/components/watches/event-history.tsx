"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Watch, WatchEvent } from "@/lib/api/types";
import { deriveState, tally } from "@/lib/confidence";
import { formatAbsolute, formatDelta, formatValue, isoTitle } from "@/lib/format";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Skeleton } from "@/components/ui/primitives";

/**
 * The watch's own record. screens.md §9.2 — every event links to an
 * investigation, never to a bare number. A number with nowhere to go is how a
 * monitoring tool trains people to ignore it.
 */
export function WatchEventHistory({
  watch,
  events,
}: {
  watch: Watch;
  events: WatchEvent[];
}) {
  const checks = watch.pre_alert_checks ?? [];
  const liveState = checks.length ? deriveState(checks) : "unverified";
  const counts = tally(checks);

  return (
    <section aria-labelledby="events-label">
      <div className="flex items-center gap-3">
        <h3 id="events-label" className="text-label text-tertiary uppercase">
          Event history
        </h3>
        <span className="text-ui-sm tabular text-tertiary">{events.length}</span>
      </div>

      {events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border-default bg-surface-1 px-3 py-4 text-ui-sm text-secondary">
          This watch has never fired. Its readings have stayed inside the normal range
          for every period recorded.
        </p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
          {events.map((e, i) => {
            const pct =
              e.previous !== 0 ? ((e.value - e.previous) / Math.abs(e.previous)) * 100 : null;
            const live = i === 0 && watch.status === "firing" && checks.length > 0;
            return (
              <li
                key={e.id}
                className="group flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2.5 last:border-0"
              >
                <time
                  dateTime={isoTitle(e.fired_at)}
                  title={isoTitle(e.fired_at)}
                  className="w-[150px] shrink-0 text-ui-sm tabular text-tertiary"
                >
                  {formatAbsolute(e.fired_at)}
                </time>
                <span className="shrink-0 text-ui tabular text-primary">
                  {formatValue(e.value, watch.format_hint, { unit: watch.unit })}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui-sm tabular text-secondary">
                  {pct === null
                    ? `previous ${watch.grain}: ${formatValue(e.previous, watch.format_hint, { unit: watch.unit })}`
                    : formatDelta(
                        pct,
                        // A delta is never shown bare — it must name what it
                        // is measured against. Without a grain the honest
                        // base is "the previous reading", not "the previous
                        // undefined".
                        watch.grain ? `the previous ${watch.grain}` : "the previous reading",
                      )}
                </span>
                <ConfidenceSeal
                  size="inline"
                  state={live ? liveState : "unverified"}
                  passed={live ? counts.passed : undefined}
                  total={live ? counts.total : undefined}
                />
                {e.investigation_id ? (
                  <Link
                    href={`/investigations/${e.investigation_id}`}
                    className="inline-flex shrink-0 items-center gap-0.5 text-ui-sm font-medium text-accent transition-colors duration-100 hover:underline"
                  >
                    Why this fired
                    <ChevronRight size={13} />
                  </Link>
                ) : (
                  <Link
                    href="/investigations"
                    className="inline-flex shrink-0 items-center gap-0.5 text-ui-sm font-medium text-accent transition-colors duration-100 hover:underline"
                  >
                    Start an investigation
                    <ChevronRight size={13} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function EventHistorySkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-2.5 w-28" />
      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-0"
          >
            <Skeleton className="h-2.5 w-[140px] shrink-0" />
            <Skeleton className="h-3 w-16 shrink-0" />
            <Skeleton className="h-2.5 w-40" />
            <span className="flex-1" />
            <Skeleton className="h-4 w-20 rounded-xs" />
          </div>
        ))}
      </div>
    </div>
  );
}
