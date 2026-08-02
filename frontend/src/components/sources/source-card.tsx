"use client";

import * as React from "react";
import Link from "next/link";
import { Check, MoreHorizontal, TriangleAlert } from "lucide-react";
import type { Catalog, Source } from "@/lib/api/types";
import { ApiFailure } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatCount, formatDuration, formatRelative, isoTitle, EMPTY } from "@/lib/format";
import { IconButton } from "@/components/ui/button";
import { MenuItem, Popover } from "@/components/ui/overlays";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ConnectionState, EngineTile } from "./connection-state";
import { labelFor } from "./engines";
import { FindingsStrip } from "./findings-strip";
import { findingsFor, useStagger, type Finding } from "./introspection";

/* ---------------------------------------------------------------------------
   Metric row inside a card
--------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-tertiary uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-ui tabular text-secondary" title={title}>
        {value}
      </dd>
    </div>
  );
}

/** Deterministic, so the demo does not jitter. */
function latencyFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return 18 + (h % 74);
}

type Activity =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "tested"; latencyMs: number; ok: boolean; detail: string }
  | { kind: "introspecting"; findings: Finding[] | null; error: string | null };

export function SourceCard({
  source,
  loadCatalog,
  onEdit,
  onDisconnect,
}: {
  source: Source;
  loadCatalog: (sourceId: string) => Promise<Catalog>;
  onEdit: (source: Source) => void;
  onDisconnect: (source: Source) => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activity, setActivity] = React.useState<Activity>({ kind: "idle" });
  const anchor = React.useRef<HTMLButtonElement>(null);

  const findings =
    activity.kind === "introspecting" ? (activity.findings ?? []) : [];
  const shown = useStagger(
    findings.length,
    activity.kind === "introspecting" && activity.findings !== null,
  );

  const test = () => {
    setMenuOpen(false);
    setActivity({ kind: "testing" });
    window.setTimeout(() => {
      const reachable = source.status !== "disconnected";
      setActivity({
        kind: "tested",
        latencyMs: latencyFor(source.id),
        ok: reachable,
        detail: reachable
          ? `${labelFor(source.kind)} · ${formatCount(source.table_count)} tables readable`
          : "No route to host. The last successful query was " +
            (source.last_query_at ? formatAbsolute(source.last_query_at) : "never") +
            ".",
      });
    }, 650);
  };

  const introspect = async () => {
    setMenuOpen(false);
    setActivity({ kind: "introspecting", findings: null, error: null });
    try {
      const catalog = await loadCatalog(source.id);
      setActivity({ kind: "introspecting", findings: findingsFor(catalog), error: null });
    } catch (err) {
      setActivity({
        kind: "introspecting",
        findings: null,
        error:
          err instanceof ApiFailure
            ? err.message
            : `Can't reach ${source.name}.`,
      });
    }
  };

  return (
    <Card padding="compact" interactive className="group relative">
      <div className="flex items-start gap-3">
        <EngineTile kind={source.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/sources/${source.id}/schema`}
              className="min-w-0 truncate text-subtitle text-primary outline-none after:absolute after:inset-0 after:content-['']"
            >
              {source.name}
            </Link>
            <ConnectionState status={source.status} className="relative z-10" />
          </div>
          <p className="mt-0.5 truncate font-mono text-mono-sm text-tertiary">
            {[source.host, source.database].filter(Boolean).join(" · ") || labelFor(source.kind)}
          </p>
        </div>
        <div className="relative z-10 shrink-0">
          <IconButton
            ref={anchor}
            label={`Actions for ${source.name}`}
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100",
              menuOpen ? "opacity-100" : "opacity-0",
            )}
          >
            <MoreHorizontal size={15} />
          </IconButton>
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={anchor}
            align="end"
            width={196}
          >
            <MenuItem onSelect={test}>Test connection</MenuItem>
            <MenuItem onSelect={() => void introspect()}>Re-introspect</MenuItem>
            <MenuItem
              onSelect={() => {
                setMenuOpen(false);
                onEdit(source);
              }}
            >
              Edit
            </MenuItem>
            <MenuItem
              danger
              onSelect={() => {
                setMenuOpen(false);
                onDisconnect(source);
              }}
            >
              Disconnect
            </MenuItem>
          </Popover>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-border-subtle pt-3">
        <Stat label="Tables" value={formatCount(source.table_count)} />
        <Stat
          label="Introspected"
          value={
            source.last_introspected_at ? formatRelative(source.last_introspected_at) : EMPTY
          }
          title={
            source.last_introspected_at ? isoTitle(source.last_introspected_at) : undefined
          }
        />
        <Stat
          label="Last query"
          value={source.last_query_at ? formatRelative(source.last_query_at) : EMPTY}
          title={source.last_query_at ? isoTitle(source.last_query_at) : undefined}
        />
      </dl>

      {activity.kind !== "idle" ? (
        <div className="relative z-10 mt-3 rounded-sm border border-border-subtle bg-surface-2 px-3 py-2">
          {activity.kind === "testing" ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          ) : null}

          {activity.kind === "tested" ? (
            <p
              className={cn(
                "ds-fade flex items-start gap-1.5 text-ui-sm",
                activity.ok ? "text-secondary" : "text-contested",
              )}
            >
              {activity.ok ? (
                <Check size={14} className="mt-px shrink-0 text-verified" strokeWidth={2.25} />
              ) : (
                <TriangleAlert size={14} className="mt-px shrink-0" />
              )}
              <span>
                {activity.ok ? (
                  <>
                    <span className="text-primary tabular">
                      Reachable in {formatDuration(activity.latencyMs)}
                    </span>{" "}
                    — {activity.detail}
                  </>
                ) : (
                  <>Can&apos;t reach {source.name}. {activity.detail}</>
                )}
              </span>
            </p>
          ) : null}

          {activity.kind === "introspecting" ? (
            activity.error ? (
              <p className="text-ui-sm text-contested">{activity.error}</p>
            ) : activity.findings === null ? (
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-52" />
              </div>
            ) : (
              <FindingsStrip findings={activity.findings} shown={shown} />
            )
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Skeletons sit at the loaded card's geometry — no jump when data lands. */
export function SourceCardSkeleton() {
  return (
    <Card padding="compact">
      <div className="flex items-start gap-3">
        <Skeleton className="h-7 w-7 rounded-sm" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-52" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border-subtle pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="mt-1.5 h-3.5 w-20" />
          </div>
        ))}
      </div>
    </Card>
  );
}
