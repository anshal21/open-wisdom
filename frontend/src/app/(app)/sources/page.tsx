"use client";

import * as React from "react";
import { Plus, RotateCw } from "lucide-react";
import type { Source } from "@/lib/api/types";
import {
  ApiFailure,
  deleteSource,
  getCatalog,
  getSourceKinds,
  getSources,
} from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { SectionLabel } from "@/components/ui/primitives";
import { SurfaceBody } from "@/components/shell/app-shell";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { ConnectDialog } from "@/components/sources/connect-dialog";
import { ConnectEmptyState } from "@/components/sources/connect-empty-state";
import { useDemoState } from "@/components/sources/demo";
import type { SourceKind } from "@/lib/api/types";
import {
  SourceCard,
  SourceCardSkeleton,
} from "@/components/sources/source-card";

export default function SourcesPage() {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const demo = useDemoState();

  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  const [connect, setConnect] = React.useState<{
    engine?: SourceKind;
    editing?: Source;
  } | null>(null);
  const [removing, setRemoving] = React.useState<Source | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);

  /**
   * Which engines this build actually has connectors for.
   *
   * Fetched once, not hardcoded. The UI used to offer four engines against a
   * binary that registered one, so three of the four produced a source that
   * failed on first use. Falling back to `["duckdb"]` if the call fails keeps
   * the page usable rather than empty; the create call validates the kind
   * server-side anyway, so a wrong guess here is refused rather than stored.
   */
  const [kinds, setKinds] = React.useState<SourceKind[]>([]);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await getSourceKinds();
        if (alive) setKinds(list);
      } catch {
        if (alive) setKinds(["duckdb"]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // Reset inside the async body, not in the effect itself: a
      // synchronous set here commits a render purely to blank the
      // screen, then commits again the moment data arrives.
      setSources(null);
      setError(null);
      try {
        const list = await getSources();
        if (!alive) return;
        setSources(list);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The source list could not be read.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads]);

  const loading = demo === "loading" || (sources === null && !error);
  const shown = demo === "empty" ? [] : (sources ?? []);
  const failed = demo === "error" || error !== null;

  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Sources" }]}
        scrollRef={scrollRef}
        actions={
          shown.length > 0 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setConnect({ engine: undefined })}
            >
              <Plus size={14} strokeWidth={2.25} />
              Connect a source
            </Button>
          ) : null
        }
      />

      <SurfaceBody scrollRef={scrollRef}>
        {failed ? (
          <div className="rounded-lg border border-contested-border bg-contested-bg px-5 py-4">
            <h2 className="text-subtitle text-contested">
              Can&apos;t reach the source registry
            </h2>
            <p className="mt-1 max-w-[62ch] text-ui-sm text-secondary">
              {demo === "error"
                ? "The request to /sources did not complete. Your sources are unchanged — this is a read failure, not a disconnection."
                : error}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={() => setReloads((n) => n + 1)}>
                <RotateCw size={13} strokeWidth={2.25} />
                Retry
              </Button>
            </div>
          </div>
        ) : loading ? (
          <>
            <SectionLabel className="mb-3">Sources</SectionLabel>
            <div className="grid gap-4 md:grid-cols-2">
              <SourceCardSkeleton />
              <SourceCardSkeleton />
            </div>
          </>
        ) : shown.length === 0 ? (
          <ConnectEmptyState kinds={kinds} onPick={(engine) => setConnect({ engine })} />
        ) : (
          <>
            <SectionLabel className="mb-3" count={shown.length}>
              Sources
            </SectionLabel>
            <div className="grid gap-4 md:grid-cols-2">
              {shown.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  loadCatalog={getCatalog}
                  onEdit={(source) => setConnect({ editing: source })}
                  onDisconnect={(source) => {
                    setRemoveError(null);
                    setRemoving(source);
                  }}
                />
              ))}
            </div>
            <p className="mt-5 max-w-[68ch] text-ui-sm text-tertiary">
              Every source is introspected automatically. Column roles,
              relationships and date columns are inferred from the schema —
              there is no modeling step to keep up to date.
            </p>
          </>
        )}
      </SurfaceBody>

      <ConnectDialog
        open={connect !== null}
        onClose={() => {
          setConnect(null);
          // Reload on close, not only on success: an attempt that failed still
          // registered a source, and it must appear in the list so it can be
          // seen and removed.
          setReloads((n) => n + 1);
        }}
        kinds={kinds}
        engineId={connect?.engine}
        editing={connect?.editing ?? null}
        onConnected={() => setReloads((n) => n + 1)}
      />

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        destructive
        width="confirm"
        title={`Remove ${removing?.name ?? ""}?`}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                const id = removing?.id;
                if (!id) return;
                void (async () => {
                  try {
                    await deleteSource(id);
                    setRemoving(null);
                    setReloads((n) => n + 1);
                  } catch (err) {
                    // This used to edit local state and call nothing, so the
                    // source came back on the next reload. Now it either
                    // removes it or says why it could not.
                    setRemoveError(
                      err instanceof ApiFailure
                        ? err.message
                        : "The source could not be removed.",
                    );
                  }
                })();
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-ui text-secondary">
          Questions that resolve to this source will stop returning answers.
          Recorded answers keep their figures and their evidence — the ledger is
          a record, so nothing already answered is removed.
        </p>
        {removing ? (
          <p className="mt-3 text-ui-sm text-tertiary">
            The cached catalog goes with it: {removing.table_count} introspected
            tables. Connecting the same warehouse again re-introspects it.
          </p>
        ) : null}
        {removeError ? (
          <p className="mt-3 text-ui-sm text-contested">{removeError}</p>
        ) : null}
      </Dialog>
    </>
  );
}
