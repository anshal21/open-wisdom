"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { formatRelative, isoTitle } from "@/lib/format";
import type { Notebook } from "@/lib/api/types";
import { ApiFailure, createNotebook, getNotebook, renameNotebook } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { CellSkeleton } from "@/components/notebook/cell";
import { NotebookView } from "@/components/notebook/notebook-view";
import { newCell, type CellView } from "@/components/notebook/cell-model";
import type { SaveState } from "@/components/notebook/persistence";
import { NotebookTitle } from "@/components/notebook/title";

export default function NotebookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const [notebook, setNotebook] = React.useState<Notebook | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });

  React.useEffect(() => {
    let alive = true;
    if (id === "new") {
      // "New notebook" used to fabricate a client-only object with id "new"
      // that could never be saved. Create it for real, then swap the URL to
      // its id so a reload — or a shared link — finds it.
      void createNotebook("Untitled notebook")
        .then((n) => {
          if (!alive) return;
          setNotebook(n);
          window.history.replaceState(null, "", `/notebooks/${n.id}`);
        })
        .catch((e: unknown) => {
          if (alive)
            setError(
              e instanceof ApiFailure
                ? e.message
                : "A new notebook could not be created.",
            );
        });
      return () => {
        alive = false;
      };
    }
    void getNotebook(id)
      .then((n) => {
        if (alive) setNotebook(n);
      })
      .catch((e: unknown) => {
        if (alive)
          setError(
            e instanceof ApiFailure ? e.message : "This notebook could not be loaded.",
          );
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const rename = React.useCallback(
    (next: string) => {
      if (!notebook) return;
      // Optimistic: the title is the user's own text, so echoing it back after
      // a round trip would just make renaming feel broken.
      const previous = notebook.name;
      setNotebook({ ...notebook, name: next });
      setSave({ status: "saving" });
      void renameNotebook(notebook.id, next)
        .then(() => setSave({ status: "saved", at: Date.now() }))
        .catch((e: unknown) => {
          setNotebook((n) => (n ? { ...n, name: previous } : n));
          setSave({
            status: "error",
            message:
              e instanceof ApiFailure ? e.message : "The name could not be saved.",
          });
        });
    },
    [notebook],
  );

  const retry = () => {
    setError(null);
    setNotebook(null);
    setAttempt((a) => a + 1);
  };

  const initialCells: CellView[] = React.useMemo(() => {
    if (!notebook) return [];
    return notebook.cells.length > 0
      ? notebook.cells.map((c) => ({ ...c }))
      : [newCell("question")];
  }, [notebook]);

  return (
    <>
      <SurfaceHeader
        crumbs={[
          { label: "Notebooks", href: "/notebooks" },
          { label: notebook?.name ?? "…" },
        ]}
        scrollRef={scrollRef}
      />
      <SurfaceBody scrollRef={scrollRef}>
        {notebook ? (
          <div className="mb-1.5">
            <NotebookTitle name={notebook.name} onRename={rename} />
          </div>
        ) : null}

        <div className="mb-4 flex items-center justify-between gap-3">
          {notebook === null && !error ? (
            <Skeleton className="h-4 w-[180px]" />
          ) : notebook ? (
            <p className="flex items-center gap-1.5 text-ui-sm text-tertiary">
              <span>
                {notebook.cells.length}{" "}
                {notebook.cells.length === 1 ? "cell" : "cells"}
              </span>
              {notebook.updated_at ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    last edited{" "}
                    <time
                      dateTime={notebook.updated_at}
                      title={isoTitle(notebook.updated_at)}
                    >
                      {formatRelative(notebook.updated_at)}
                    </time>
                  </span>
                </>
              ) : null}
              <SaveIndicator state={save} />
            </p>
          ) : null}
        </div>

        {/* §13 — below 768px a notebook is read-only in practice; say so. */}
        <p className="mb-4 rounded-md border border-border-default bg-surface-2 px-3 py-2 text-ui-sm text-secondary md:hidden">
          Notebooks are best on a desktop. The cells, their seals and their findings are
          all readable here, but running and editing want a keyboard.
        </p>

        {error ? (
          <div className="rounded-lg border border-contested-border bg-surface-1 p-5">
            <p className="text-subtitle text-contested">This notebook didn’t load</p>
            <p className="mt-1 text-ui-sm text-secondary">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={retry}>
              <RotateCw size={13} />
              Retry
            </Button>
          </div>
        ) : notebook === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <CellSkeleton key={i} index={i} />
            ))}
          </div>
        ) : (
          <NotebookView
            key={notebook.id}
            notebookId={notebook.id}
            initialCells={initialCells}
            onSaveStateChange={setSave}
          />
        )}
      </SurfaceBody>
    </>
  );
}

/**
 * Autosave status. Silent when idle — a notebook that says "saved" forever is
 * noise; it speaks up while saving, briefly after, and loudly on failure,
 * because an unsaved change the user doesn't know about is the whole bug.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  // No elapsed-time readout here, deliberately.
  //
  // It used to count seconds since the last save, which required state, an
  // interval, and a reset on every save. It also duplicated — less reliably —
  // the "last edited" beside it, which comes from the SERVER's `updated_at`
  // and is the durable truth. Two clocks disagreeing about the same fact is
  // worse than one clock.
  if (state.status === "idle") return null;
  if (state.status === "saving") {
    return (
      <>
        <span aria-hidden="true">·</span>
        <span aria-live="polite">Saving…</span>
      </>
    );
  }
  if (state.status === "saved") {
    return (
      <>
        <span aria-hidden="true">·</span>
        <span aria-live="polite">All changes saved</span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true">·</span>
      <span className="text-contested" role="alert">
        Not saved — {state.message}
      </span>
    </>
  );
}
