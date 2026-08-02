"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Database, RotateCw } from "lucide-react";
import type { Catalog, Source, User } from "@/lib/api/types";
import { ApiFailure, getCatalog, getSources, getUsers } from "@/lib/api/client";
import { formatAbsolute, formatRelative, isoTitle } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { SurfaceBody } from "@/components/shell/app-shell";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { ConnectionState } from "@/components/sources/connection-state";
import { useDemoState } from "@/components/sources/demo";
import { FindingsStrip } from "@/components/sources/findings-strip";
import { findingsFor, useStagger, type Finding } from "@/components/sources/introspection";
import { resolveCurrentUser } from "@/components/admin/roles";
import {
  SampleRows,
  SampleRowsSkeleton,
  TableDetail,
  TableDetailSkeleton,
  TableList,
  TableListSkeleton,
} from "@/components/sources/schema-browser";

/** The person looking at the screen. Permission gates read from this. */

/**
 * screens.md §10.4. States: empty · loading · streaming (introspection) ·
 * error (connection error with the cause). Refusal is n/a for this surface
 * (§14) — nothing here produces an answer.
 */
export default function SchemaPage() {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const params = useParams<{ id: string }>();
  const sourceId = params.id;
  const demo = useDemoState();

  const [source, setSource] = React.useState<Source | null>(null);
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [me, setMe] = React.useState<User | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);

  const [findings, setFindings] = React.useState<Finding[] | null>(null);
  const [introspecting, setIntrospecting] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // Reset inside the async body: a synchronous set here commits a render
      // purely to blank the screen, then commits again when data arrives.
      setCatalog(null);
      setError(null);
      try {
        const [sources, users, cat] = await Promise.all([
          getSources(),
          getUsers(),
          getCatalog(sourceId),
        ]);
        if (!alive) return;
        setSource(sources.find((s) => s.id === sourceId) ?? null);
        setMe(resolveCurrentUser(users).user);
        setCatalog(cat);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The schema could not be read from this source.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [sourceId, reloads]);

  const tables = React.useMemo(
    () => (demo === "empty" ? [] : (catalog?.tables ?? [])),
    [demo, catalog],
  );

  // Derived, not mirrored. `selected` holds only what the user CHOSE; which
  // table is actually shown falls out of that plus the current list. Syncing
  // it through an effect meant a render with a stale selection, then another
  // to correct it — and a selection that briefly pointed at a table the new
  // catalog no longer had.
  const shown =
    tables.length === 0
      ? null
      : selected && tables.some((t) => t.name === selected)
        ? selected
        : tables[0].name;

  const shownFindings = useStagger(findings?.length ?? 0, findings !== null);

  const reintrospect = async () => {
    setIntrospecting(true);
    setFindings(null);
    try {
      const cat = await getCatalog(sourceId);
      setCatalog(cat);
      setFindings(findingsFor(cat));
    } catch (err) {
      setError(
        err instanceof ApiFailure ? err.message : "The re-introspection did not complete.",
      );
    } finally {
      setIntrospecting(false);
    }
  };

  const loading = demo === "loading" || (catalog === null && error === null);
  const failed = demo === "error" || error !== null;
  const table = tables.find((t) => t.name === shown) ?? null;

  const canUnmask = me?.role === "admin";
  const unmaskReason = me
    ? `${me.name} is a ${me.role === "viewer" ? "Viewer" : "Editor"} — only Owners and Admins can unmask personal data`
    : "Only Owners and Admins can unmask personal data";

  return (
    <>
      <SurfaceHeader
        crumbs={[
          { label: "Sources", href: "/sources" },
          { label: source?.name ?? "Schema" },
        ]}
        scrollRef={scrollRef}
        actions={
          <>
            {source ? <ConnectionState status={source.status} className="mr-1.5" /> : null}
            <Button
              size="sm"
              variant="ghost"
              loading={introspecting}
              onClick={() => void reintrospect()}
            >
              <RotateCw size={13} strokeWidth={2.25} />
              Re-introspect
            </Button>
          </>
        }
      />

      <SurfaceBody scrollRef={scrollRef} wide>
        {failed ? (
          <div className="rounded-lg border border-contested-border bg-contested-bg px-5 py-4">
            <h2 className="text-subtitle text-contested">
              Can&apos;t reach {source?.name ?? "this source"}
            </h2>
            <p className="mt-1 max-w-[62ch] text-ui-sm text-secondary">
              {demo === "error"
                ? "The connection was refused at the host. The schema shown before this failure is unchanged; no answer will run against this source until it is reachable."
                : error}
            </p>
            {source?.last_introspected_at ? (
              <p className="mt-1 text-ui-sm text-tertiary">
                Last successful introspection{" "}
                <time
                  dateTime={source.last_introspected_at}
                  title={isoTitle(source.last_introspected_at)}
                >
                  {formatAbsolute(source.last_introspected_at)}
                </time>
                .
              </p>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={() => setReloads((n) => n + 1)}>
                <RotateCw size={13} strokeWidth={2.25} />
                Retry
              </Button>
              <Link
                href="/sources"
                className="inline-flex h-7 items-center rounded-sm px-2.5 text-ui font-medium text-secondary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary"
              >
                Check connection
              </Link>
            </div>
          </div>
        ) : (
          <>
            {findings !== null ? (
              <div className="mb-4 rounded-lg border border-border-default bg-surface-1 px-3.5 py-2.5">
                <FindingsStrip findings={findings} shown={shownFindings} />
              </div>
            ) : null}

            {loading ? (
              <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
                <TableListSkeleton />
                <div className="grid min-w-0 gap-6 xl:grid-cols-2">
                  <TableDetailSkeleton />
                  <SampleRowsSkeleton />
                </div>
              </div>
            ) : tables.length === 0 ? (
              <EmptyState
                icon={<Database size={20} strokeWidth={1.75} />}
                headline="Nothing has been introspected here yet"
                body="This source is connected but its schema has not been read. Introspection takes a few seconds and needs no modeling — column roles and relationships are inferred from the schema itself."
                action={
                  <Button variant="primary" size="md" onClick={() => void reintrospect()}>
                    Introspect now
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-136px)]">
                  <TableList tables={tables} selected={shown} onSelect={setSelected} />
                  {catalog ? (
                    <p className="mt-2 px-1 text-ui-sm text-tertiary">
                      Introspected{" "}
                      <time
                        dateTime={catalog.introspected_at}
                        title={isoTitle(catalog.introspected_at)}
                      >
                        {formatRelative(catalog.introspected_at)}
                      </time>
                    </p>
                  ) : null}
                </div>

                <div className="grid min-w-0 gap-6 xl:grid-cols-2">
                  {table ? (
                    <>
                      <TableDetail table={table} />
                      <SampleRows
                        table={table}
                        canUnmask={canUnmask}
                        reason={unmaskReason}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}
      </SurfaceBody>
    </>
  );
}
