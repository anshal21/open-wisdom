"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotebookPen, Plus, RotateCw } from "lucide-react";
import { formatRelative, isoTitle } from "@/lib/format";
import type { NotebookSummary } from "@/lib/api/types";
import { ApiFailure, getNotebooks } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";

/** Index of notebooks. §7 */
export default function NotebooksIndexPage() {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const router = useRouter();
  const [rows, setRows] = React.useState<NotebookSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void getNotebooks()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e: unknown) => {
        if (alive)
          setError(e instanceof ApiFailure ? e.message : "Notebooks could not be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = () => {
    setError(null);
    setRows(null);
    setAttempt((a) => a + 1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    nodes[Math.max(0, Math.min(nodes.length - 1, next))]?.focus();
  };

  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Notebooks" }]}
        scrollRef={scrollRef}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push("/notebooks/new")}
          >
            <Plus size={14} />
            New notebook
          </Button>
        }
      />
      <SurfaceBody scrollRef={scrollRef} wide>
        {error ? (
          <div className="rounded-lg border border-contested-border bg-surface-1 p-5">
            <p className="text-subtitle text-contested">Notebooks didn’t load</p>
            <p className="mt-1 text-ui-sm text-secondary">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={retry}>
              <RotateCw size={13} />
              Retry
            </Button>
          </div>
        ) : rows === null ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i}>
                <div className="flex h-[92px] flex-col justify-between rounded-lg border border-border-default bg-surface-1 p-4">
                  <Skeleton className="h-4 w-[58%]" />
                  <Skeleton className="h-3 w-[42%]" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<NotebookPen size={20} />}
            headline="No notebooks yet"
            body="A notebook is multi-step analysis where every cell that produces a figure carries the same checks as an answer — and can be promoted into a definition, a tile, or a watch."
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => router.push("/notebooks/new")}
              >
                <Plus size={14} />
                New notebook
              </Button>
            }
          />
        ) : (
          <ul
            ref={listRef}
            onKeyDown={onKeyDown}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {rows.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/notebooks/${n.id}`}
                  className="flex h-[92px] flex-col justify-between rounded-lg border border-border-default bg-surface-1 p-4 transition-colors duration-100 hover:border-border-hover hover:bg-surface-2"
                >
                  <span className="truncate text-subtitle text-primary">{n.name}</span>
                  <span className="flex items-center gap-1.5 text-ui-sm text-tertiary">
                    <span className="tabular">
                      {n.cell_count} {n.cell_count === 1 ? "cell" : "cells"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={n.updated_at} title={isoTitle(n.updated_at)}>
                      edited {formatRelative(n.updated_at)}
                    </time>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SurfaceBody>
    </>
  );
}
