"use client";

import * as React from "react";
import { Check, LayoutGrid, Link2, Plus, RotateCw, Undo2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelative, isoTitle } from "@/lib/format";
import type { Answer, Dashboard, DashboardTile } from "@/lib/api/types";
import { useRouter } from "next/navigation";
import {
  ApiFailure,
  createDashboard,
  getAnswer,
  getDashboard,
  patchTileViz,
  refreshDashboard,
} from "@/lib/api/client";
import type { ConfidenceState } from "@/lib/confidence";
import { useHotkeys, MOD } from "@/lib/keyboard";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { useEvidence } from "@/state/evidence";
import { AddTileDialog } from "@/components/dashboards/add-tile-dialog";
import { syncTiles } from "@/components/dashboards/sync";
import { useToast } from "@/components/ui/toast";
import { DashboardCanvas, type TilePlacement } from "@/components/dashboards/canvas";
import { ConfidenceRollup } from "@/components/dashboards/rollup";
import {
  firstFreeSlot,
  type GridItem,
  reposition,
  rollup,
  tileEvidence,
  tileState,
} from "@/components/dashboards/tile-model";

const NEW: Dashboard = {
  id: "new",
  name: "Untitled dashboard",
  tiles: [],
  last_refreshed_at: null,
};

export default function DashboardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const setSubject = useEvidence((s) => s.setSubject);

  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const [tiles, setTiles] = React.useState<DashboardTile[]>([]);
  /** What the server last confirmed. The reconcile path diffs against this,
   * never against React state, so an in-flight edit can't be mistaken for a
   * change the server already knows about. */
  const knownRef = React.useRef<DashboardTile[]>([]);
  const { toast } = useToast();
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({});
  const [tileErrors, setTileErrors] = React.useState<Record<string, string>>({});
  const [loadingTiles, setLoadingTiles] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [editing, setEditing] = React.useState(false);
  const [filter, setFilter] = React.useState<ConfidenceState | null>(null);
  const [refreshing, setRefreshing] = React.useState<ReadonlySet<string>>(new Set());
  const [refreshedAt, setRefreshedAt] = React.useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [replaceIndex, setReplaceIndex] = React.useState<number | null>(null);
  const [copied, setCopied] = React.useState(false);

  const historyRef = React.useRef<DashboardTile[][]>([]);
  const [canUndo, setCanUndo] = React.useState(false);

  /* --- load ------------------------------------------------------------- */

  const loadAnswers = React.useCallback(async (list: DashboardTile[]) => {
    const ids = Array.from(new Set(list.map((t) => t.answer_id)));
    if (ids.length === 0) {
      setLoadingTiles(false);
      return;
    }
    const settled = await Promise.allSettled(ids.map((aid) => getAnswer(aid)));
    const next: Record<string, Answer> = {};
    const errs: Record<string, string> = {};
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") next[ids[i]] = r.value;
      else
        errs[ids[i]] =
          r.reason instanceof ApiFailure
            ? r.reason.message
            : "This answer could not be read.";
    });
    setAnswers((prev) => ({ ...prev, ...next }));
    setTileErrors((prev) => ({ ...prev, ...errs }));
    setLoadingTiles(false);
  }, []);

  const [attempt, setAttempt] = React.useState(0);
  const router = useRouter();
  // Serialises draft promotion: the first commit on /dashboards/new creates
  // the real dashboard; a second commit racing it must reuse the same promise
  // or two dashboards get minted.
  const creatingRef = React.useRef<Promise<Dashboard> | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      if (id === "new") {
        if (!alive) return;
        setDashboard(NEW);
        setTiles([]);
        knownRef.current = [];
        setRefreshedAt(null);
        setLoadingTiles(false);
        return;
      }
      try {
        const d = await getDashboard(id);
        if (!alive) return;
        setDashboard(d);
        const loaded = reposition([...d.tiles].sort((a, b) => a.position - b.position));
        setTiles(loaded);
        knownRef.current = loaded;
        setRefreshedAt(d.last_refreshed_at);
        await loadAnswers(d.tiles);
      } catch (e: unknown) {
        if (!alive) return;
        setError(
          e instanceof ApiFailure ? e.message : "This dashboard could not be loaded.",
        );
        setLoadingTiles(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, attempt, loadAnswers]);

  const retry = () => {
    setError(null);
    setDashboard(null);
    setLoadingTiles(true);
    setAttempt((a) => a + 1);
  };

  /* --- evidence: the panel tracks the surface even before a tile is focused */

  React.useEffect(() => {
    if (loadingTiles) return;
    const first = tiles.map((t) => answers[t.answer_id]).find(Boolean);
    if (first) setSubject(tileEvidence(first, `Tile · ${first.question}`));
  }, [loadingTiles, tiles, answers, setSubject]);

  /* --- mutation + undo --------------------------------------------------- */

  const pushHistory = React.useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-24), tiles];
    setCanUndo(true);
  }, [tiles]);

  /**
   * Every tile mutation goes through here, and everything that lands here is
   * persisted — INCLUDING on /dashboards/new. That route used to early-return
   * before the sync, one line under this comment, so the first dashboard a
   * user ever made rendered its tiles and saved none of them: the picker
   * closed, the tile appeared, zero requests left the page, and navigating
   * away destroyed the board. The draft is now promoted on first commit —
   * create, sync against the real id, then swap the route — the same
   * first-write promotion the notebook draft already does.
   */
  const commit = React.useCallback(
    (next: DashboardTile[]) => {
      if (next === tiles) return;
      pushHistory();
      setTiles(next);
      const write = (dashId: string) =>
        syncTiles(dashId, knownRef.current, next).then(({ tiles: settled, failed }) => {
          knownRef.current = settled;
          // Adopt server ids without clobbering edits made while in flight.
          setTiles((cur) =>
            cur.length === settled.length
              ? cur.map((t, i) => (t.id ? t : { ...t, id: settled[i]?.id }))
              : cur,
          );
          if (failed) {
            toast({
              kind: "error",
              message: "Some changes to this dashboard could not be saved.",
            });
          }
          return dashId;
        });
      if (id === "new") {
        creatingRef.current ??= createDashboard(dashboard?.name ?? "Untitled dashboard");
        void creatingRef.current
          .then((d) => write(d.id))
          .then((dashId) => router.replace(`/dashboards/${dashId}`))
          .catch(() => {
            creatingRef.current = null;
            toast({
              kind: "error",
              message: "This dashboard could not be created — nothing was saved.",
            });
          });
        return;
      }
      void write(id);
    },
    [tiles, pushHistory, id, toast, dashboard?.name, router],
  );

  // Undo is just another next-state, so it reconciles like any other edit —
  // which is the point of routing everything through one path.
  const undo = React.useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    const prev = h[h.length - 1];
    historyRef.current = h.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setTiles(prev);
    if (id === "new") return;
    void syncTiles(id, knownRef.current, prev).then(({ tiles: settled }) => {
      knownRef.current = settled;
      setTiles((cur) =>
        cur.length === settled.length
          ? cur.map((t, i) => (t.id ? t : { ...t, id: settled[i]?.id }))
          : cur,
      );
    });
  }, [id]);

  useHotkeys([{ key: "z", mod: true, run: undo }], [undo]);

  /* --- actions ----------------------------------------------------------- */

  const markRefreshing = (ids: string[], stagger = 260) => {
    setRefreshing((prev) => new Set([...prev, ...ids]));
    ids.forEach((aid, i) => {
      window.setTimeout(
        () =>
          setRefreshing((prev) => {
            const next = new Set(prev);
            next.delete(aid);
            return next;
          }),
        520 + i * stagger,
      );
    });
  };

  const clearSupersession = (ids: string[]) => {
    setAnswers((prev) => {
      const next = { ...prev };
      for (const aid of ids) {
        const a = next[aid];
        if (a?.supersession) next[aid] = { ...a, supersession: undefined };
      }
      return next;
    });
  };

  const refreshAll = React.useCallback(() => {
    const ids = Array.from(new Set(tiles.map((t) => t.answer_id)));
    if (ids.length === 0) return;
    markRefreshing(ids);
    void refreshDashboard(id).catch(() => {});
    window.setTimeout(() => {
      clearSupersession(ids);
      setRefreshedAt(new Date().toISOString());
    }, 520 + ids.length * 260);
  }, [tiles, id]);

  const rerunTile = (index: number) => {
    const aid = tiles[index]?.answer_id;
    if (!aid) return;
    markRefreshing([aid]);
    window.setTimeout(() => clearSupersession([aid]), 900);
  };

  const removeTile = (index: number) =>
    commit(reposition(tiles.filter((_, i) => i !== index)));

  /** A tile's chart choice changed: apply locally and persist — a tile is
   * editorial, the choice must survive reload. */
  const changeTileViz = React.useCallback(
    (index: number, v: import("@/lib/viz/resolve").VizOverride) => {
      setTiles((cur) => cur.map((t, i) => (i === index ? { ...t, viz: v } : t)));
      const t = tiles[index];
      if (t?.id && id !== "new") void patchTileViz(id, t.id, v).catch(() => {});
    },
    [tiles, id],
  );

  /** A drag or resize settled: apply every tile's new geometry and persist
   * the whole canvas in one call. */
  const applyLayout = React.useCallback(
    (next: TilePlacement[]) => {
      const byIndex = new Map(next.map((pl) => [pl.index, pl]));
      const updated = tiles.map((t, i) => {
        const pl = byIndex.get(i);
        return pl
          ? { ...t, x: pl.x, y: pl.y, w: pl.w, h: pl.h, size: pl.size, position: pl.y * 12 + pl.x }
          : t;
      });
      // No-op layouts happen (RGL settles on mount) — don't spam history/API.
      if (JSON.stringify(updated) === JSON.stringify(tiles)) return;
      commit(updated);
    },
    [tiles, commit],
  );

  const addTile = (answerId: string) => {
    if (replaceIndex !== null) {
      const next = [...tiles];
      next[replaceIndex] = { ...next[replaceIndex], answer_id: answerId };
      commit(next);
    } else {
      // Land in the first gap that fits rather than flowing from legacy
      // positions, which leaves a tile floating with dead space beside it.
      const slot = firstFreeSlot(tiles, 3, 2);
      commit(
        reposition([
          ...tiles,
          {
            answer_id: answerId,
            position: tiles.length,
            size: "3x2",
            x: slot.x,
            y: slot.y,
            w: 3,
            h: 2,
          },
        ]),
      );
    }
    setAddOpen(false);
    setReplaceIndex(null);
    if (!answers[answerId]) {
      void getAnswer(answerId)
        .then((a) => setAnswers((prev) => ({ ...prev, [answerId]: a })))
        .catch((e: unknown) =>
          setTileErrors((prev) => ({
            ...prev,
            [answerId]:
              e instanceof ApiFailure ? e.message : "This answer could not be read.",
          })),
        );
    }
  };

  const retryTile = (index: number) => {
    const aid = tiles[index]?.answer_id;
    if (!aid) return;
    setTileErrors((prev) => {
      const next = { ...prev };
      delete next[aid];
      return next;
    });
    void getAnswer(aid)
      .then((a) => setAnswers((prev) => ({ ...prev, [aid]: a })))
      .catch((e: unknown) =>
        setTileErrors((prev) => ({
          ...prev,
          [aid]: e instanceof ApiFailure ? e.message : "This answer could not be read.",
        })),
      );
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  /* --- derived ----------------------------------------------------------- */

  const items: GridItem[] = tiles.map((tile, index) => ({
    index,
    tile,
    answer: answers[tile.answer_id],
    error: tileErrors[tile.answer_id],
  }));

  const states = items
    .map((i) => (i.answer ? tileState(i.answer) : null))
    .filter(Boolean) as ConfidenceState[];
  const counts = rollup(states);

  const visible = filter
    ? items.filter((i) => i.answer && tileState(i.answer) === filter)
    : items;

  const supersededIds = items
    .filter((i) => i.answer?.supersession)
    .map((i) => i.tile.answer_id);
  const showBanner = !bannerDismissed && supersededIds.length > 0 && !loadingTiles;

  const empty = !loadingTiles && tiles.length === 0 && !error;

  /* --- render ------------------------------------------------------------ */

  return (
    <>
      <SurfaceHeader
        crumbs={[
          { label: "Dashboards", href: "/dashboards" },
          { label: dashboard?.name ?? "…" },
        ]}
        scrollRef={scrollRef}
        actions={
          // A dashboard that failed to load offers no actions — Share, Edit
          // and Add tile against nothing is a ghost surface.
          dashboard === null ? undefined : (
          <>
            {canUndo ? (
              <Button size="sm" variant="ghost" onClick={undo} title={`Undo (${MOD}Z)`}>
                <Undo2 size={13} />
                Undo
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshAll}
              disabled={tiles.length === 0}
            >
              <RotateCw size={13} />
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={copyLink}>
              {copied ? <Check size={13} /> : <Link2 size={13} />}
              {copied ? "Copied" : "Share"}
            </Button>
            <Button
              size="sm"
              variant={editing ? "secondary" : "ghost"}
              aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Done" : "Edit"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setReplaceIndex(null);
                setAddOpen(true);
              }}
            >
              <Plus size={14} />
              Add tile
            </Button>
          </>
          )
        }
      />

      <SurfaceBody scrollRef={scrollRef} wide>
        {/* Sub-header: last refreshed + the confidence roll-up. §6.1 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {error ? null : dashboard === null ? (
            <Skeleton className="h-4 w-[180px]" />
          ) : (
            <p className="text-ui-sm text-tertiary">
              {refreshedAt ? (
                <>
                  Last refreshed{" "}
                  <time dateTime={refreshedAt} title={isoTitle(refreshedAt)}>
                    {formatRelative(refreshedAt)}
                  </time>
                </>
              ) : (
                "Never refreshed"
              )}
            </p>
          )}
          <ConfidenceRollup
            counts={counts}
            active={filter}
            onToggle={(s) => setFilter((cur) => (cur === s ? null : s))}
          />
        </div>

        {/* A tile's source definition changed — shown once. §6.4 */}
        {showBanner ? (
          <div className="ds-fade mb-4 flex items-center gap-3 rounded-md border border-qualified-border bg-qualified-bg px-3.5 py-2.5">
            <p className="min-w-0 flex-1 text-ui text-qualified">
              {supersededIds.length}{" "}
              {supersededIds.length === 1 ? "tile uses" : "tiles use"} a definition that
              has changed since they were answered.
            </p>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                markRefreshing(supersededIds);
                window.setTimeout(
                  () => clearSupersession(supersededIds),
                  520 + supersededIds.length * 260,
                );
                setBannerDismissed(true);
              }}
            >
              Re-run all
            </Button>
            <IconButton
              label="Dismiss"
              size="xs"
              onClick={() => setBannerDismissed(true)}
            >
              <X size={13} />
            </IconButton>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-contested-border bg-surface-1 p-5">
            <p className="text-subtitle text-contested">This dashboard didn’t load</p>
            <p className="mt-1 text-ui-sm text-secondary">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={retry}>
              <RotateCw size={13} />
              Retry
            </Button>
          </div>
        ) : empty ? (
          <EmptyState
            icon={<LayoutGrid size={20} />}
            headline="Nothing on this dashboard yet"
            body="Tiles come from answers you have already verified — every tile keeps its seal and links back to its evidence. There is no chart builder here on purpose."
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setReplaceIndex(null);
                  setAddOpen(true);
                }}
              >
                <Plus size={14} />
                Add your first tile
              </Button>
            }
          />
        ) : (
          <>
            {filter ? (
              <p className="mb-3 flex items-center gap-2 text-ui-sm text-tertiary">
                Showing {visible.length} of {items.length} tiles.
                <button
                  type="button"
                  onClick={() => setFilter(null)}
                  className="rounded-xs px-1 font-medium text-accent transition-colors duration-100 hover:bg-overlay-hover"
                >
                  Clear filter
                </button>
              </p>
            ) : null}

            <DashboardCanvas
              items={visible}
              editing={editing}
              loading={loadingTiles}
              refreshedAt={refreshedAt}
              refreshingIds={refreshing}
              onLayoutChange={applyLayout}
              onVizChange={changeTileViz}
              onRerun={rerunTile}
              onRemove={removeTile}
              onReplace={(index) => {
                setReplaceIndex(index);
                setAddOpen(true);
              }}
              onRetry={retryTile}
            />

            {editing ? (
              <p className={cn("mt-3 text-ui-sm text-tertiary")}>
                Drag a tile anywhere on the canvas; neighbours flow around it. Drag
                the right, bottom, or corner handle to resize. {MOD}Z undoes.
              </p>
            ) : null}
          </>
        )}
      </SurfaceBody>

      <AddTileDialog
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setReplaceIndex(null);
        }}
        onAdd={addTile}
        existing={new Set(tiles.map((t) => t.answer_id))}
      />
    </>
  );
}
