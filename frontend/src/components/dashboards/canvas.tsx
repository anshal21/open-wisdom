"use client";

/**
 * The dashboard canvas — the industry-standard grid model.
 *
 * Tiles live at explicit {x, y, w, h} in 12-column units, drag anywhere with
 * live collision + vertical compaction, resize from the corner/edges. This is
 * the interaction model users already know from every serious dashboard tool,
 * provided by react-grid-layout rather than reinvented — the layout engine is
 * a solved problem; this product's contribution is what's INSIDE the tiles
 * (sealed, auditable answers), not a new physics for rectangles.
 *
 * View mode is completely static. Edit mode arms drag + resize; every change
 * reports the whole layout upward, where the page persists it in one call.
 */

import * as React from "react";
import GridLayout, { useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { cn } from "@/lib/cn";
import type { TileSize } from "@/lib/api/types";
import { geom, ROW_H, GUTTER, snapSize, type GridItem } from "./tile-model";
import { DashboardTile, TileError, TileSkeleton } from "./tile";

export interface TilePlacement {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The legacy size bucket nearest this geometry, kept for older readers. */
  size: TileSize;
}

/** Grid geometry for a tile: explicit when it has one, legacy-derived when
 * it predates the canvas (x = -1). Legacy tiles flow row-major in position
 * order, which is exactly what the old renderer showed. */
export function placements(items: GridItem[]): Record<number, LayoutItem> {
  const out: Record<number, LayoutItem> = {};
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  for (const item of items) {
    const t = item.tile;
    const tx = t.x ?? -1;
    const ty = t.y ?? -1;
    if (tx >= 0 && ty >= 0 && (t.w ?? 0) > 0) {
      out[item.index] = { i: String(item.index), x: tx, y: ty, w: t.w!, h: t.h ?? 2 };
      continue;
    }
    const g = geom(t.size);
    if (cursorX + g.cols > COLS) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    out[item.index] = { i: String(item.index), x: cursorX, y: cursorY, w: g.cols, h: g.rows };
    cursorX += g.cols;
    rowH = Math.max(rowH, g.rows);
  }
  return out;
}

/** The authoring grid. Narrower viewports render a scaled-down projection of
 * it; they never re-author it. */
const COLS = 12;

/**
 * Columns for the viewport. `screens.md` breakpoints: a 12-column grid at
 * 420px produces 56px tiles rendering "$…" — so narrow viewports collapse
 * rather than shrink.
 */
export function useGridColumns(): number {
  const [cols, setCols] = React.useState(COLS);
  React.useEffect(() => {
    const on = () => {
      const w = window.innerWidth;
      setCols(w < 768 ? 1 : w < 1024 ? 6 : COLS);
    };
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return cols;
}

/**
 * Project a 12-column layout onto `cols`. At 1 column every tile is full
 * width and stacks in reading order; at 6 the geometry halves. This is a
 * VIEW transform — the stored layout stays in 12-column units, which is why
 * editing is disabled below the full grid (see DashboardCanvas).
 */
function project(layout: LayoutItem[], cols: number): LayoutItem[] {
  if (cols === COLS) return layout;
  if (cols === 1) {
    return [...layout]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((l, i) => ({ ...l, x: 0, y: i * l.h, w: 1 }));
  }
  const k = cols / COLS;
  return layout.map((l) => ({
    ...l,
    x: Math.min(cols - 1, Math.round(l.x * k)),
    w: Math.max(1, Math.min(cols, Math.round(l.w * k))),
  }));
}

export function DashboardCanvas({
  items,
  editing = false,
  loading = false,
  refreshedAt,
  refreshingIds,
  onLayoutChange,
  onRerun,
  onReplace,
  onRemove,
  onRetry,
  onVizChange,
  className,
}: {
  items: GridItem[];
  editing?: boolean;
  loading?: boolean;
  refreshedAt: string | null;
  refreshingIds?: ReadonlySet<string>;
  /** Fired after a drag/resize settles, with every tile's new placement. */
  onLayoutChange?: (placements: TilePlacement[]) => void;
  onRerun?: (index: number) => void;
  onReplace?: (index: number) => void;
  onRemove?: (index: number) => void;
  onRetry?: (index: number) => void;
  onVizChange?: (index: number, v: import("@/lib/viz/resolve").VizOverride) => void;
  className?: string;
}) {
  const cols = useGridColumns();
  const base = React.useMemo(
    () => items.map((it) => placements(items)[it.index]),
    [items],
  );
  const layout = React.useMemo(() => project(base, cols), [base, cols]);
  const { width, containerRef, mounted } = useContainerWidth();

  // Authoring happens on the full grid only. A drag at 6 columns would
  // persist projected geometry as if it were authored, permanently halving
  // every tile the next time the board opens on a wide screen.
  const canEdit = editing && cols === COLS;

  const settle = (next: Layout) => {
    if (!canEdit || !onLayoutChange) return;
    onLayoutChange(
      next.map((l) => ({
        index: Number(l.i),
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        size: snapSize(l.w, l.h),
      })),
    );
  };

  /** Keyboard resize: the grid's own handles are pointer-only. Alt+arrows
   * step a focused tile one column/row, staying inside the grid. */
  const keyResize = (index: number, e: React.KeyboardEvent) => {
    if (!canEdit || !onLayoutChange || !e.altKey) return;
    const d =
      e.key === "ArrowRight" ? [1, 0] :
      e.key === "ArrowLeft" ? [-1, 0] :
      e.key === "ArrowDown" ? [0, 1] :
      e.key === "ArrowUp" ? [0, -1] : null;
    if (!d) return;
    e.preventDefault();
    onLayoutChange(
      base.map((l) => {
        const i = Number(l.i);
        if (i !== index) return { index: i, x: l.x, y: l.y, w: l.w, h: l.h, size: snapSize(l.w, l.h) };
        const w = Math.max(1, Math.min(COLS - l.x, l.w + d[0]));
        const h = Math.max(1, l.h + d[1]);
        return { index: i, x: l.x, y: l.y, w, h, size: snapSize(w, h) };
      }),
    );
  };

  return (
    <div ref={containerRef} className={cn(canEdit && "select-none", className)}>
      {mounted ? (
      <GridLayout
        layout={layout}
        width={width}
        gridConfig={{
          cols,
          rowHeight: ROW_H,
          margin: [GUTTER, GUTTER],
          containerPadding: [0, 0],
        }}
        dragConfig={{
          enabled: canEdit,
          cancel: "button, a, input, textarea, select",
        }}
        resizeConfig={{ enabled: canEdit, handles: ["se", "e", "s"] }}
        onLayoutChange={settle}
      >
        {items.map((item) => (
          <div
            key={String(item.index)}
            className={cn(
              canEdit &&
                "cursor-grab rounded-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--c-accent-solid)] active:cursor-grabbing",
            )}
            tabIndex={canEdit ? 0 : undefined}
            role={canEdit ? "group" : undefined}
            aria-label={
              canEdit
                ? `Tile ${item.index + 1}. Alt plus arrow keys resizes.`
                : undefined
            }
            onKeyDown={canEdit ? (e) => keyResize(item.index, e) : undefined}
          >
            {loading ? (
              <TileSkeleton size={item.tile.size} />
            ) : item.error ? (
              <TileError message={item.error} onRetry={onRetry ? () => onRetry(item.index) : undefined} />
            ) : item.answer ? (
              // draggableCancel exempts buttons/links, so the tile's menu and
              // permalink still click while the body drags.
              <DashboardTile
                answer={item.answer}
                size={item.tile.size}
                gridCols={base.find((l) => Number(l.i) === item.index)?.w}
                gridRows={base.find((l) => Number(l.i) === item.index)?.h}
                viz={item.tile.viz}
                onVizChange={onVizChange ? (v) => onVizChange(item.index, v) : undefined}
                refreshedAt={refreshedAt}
                refreshing={refreshingIds?.has(item.tile.answer_id)}
                editing={editing}
                onRerun={onRerun ? () => onRerun(item.index) : undefined}
                onReplace={onReplace ? () => onReplace(item.index) : undefined}
                onRemove={onRemove ? () => onRemove(item.index) : undefined}
                className="h-full"
              />
            ) : null}
          </div>
        ))}
      </GridLayout>
      ) : null}
    </div>
  );
}
