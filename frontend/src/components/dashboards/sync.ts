/**
 * Dashboard persistence — one reconcile path for every mutation.
 *
 * Adding, removing and replacing tiles used to be pure React state: the board
 * looked edited, "Done" did nothing, and a reload restored whatever the server
 * still believed. Only drag/resize persisted, and only for tiles that already
 * had a server id.
 *
 * Rather than bolt a call onto each handler — which leaves undo, the one path
 * nobody remembers, still lying — every change funnels through `syncTiles`.
 * It diffs the next array against what the server last confirmed and issues
 * the calls that difference implies. Undo is then just another next-state, and
 * it persists for free.
 */

import {
  addDashboardTile,
  deleteDashboardTile,
  replaceDashboardTile,
  saveDashboardLayout,
} from "@/lib/api/client";
import type { DashboardTile } from "@/lib/api/types";

export interface SyncResult {
  /** Tiles with server ids filled in for anything newly created. */
  tiles: DashboardTile[];
  failed: boolean;
}

/**
 * Reconcile `next` against `known` (the last server-confirmed array).
 *
 * Order matters: deletes first so a replace-by-remove-then-add can't collide
 * on geometry, then creates (so new tiles have ids before the layout call),
 * then answer swaps, then the whole layout in one write.
 */
export async function syncTiles(
  dashboardId: string,
  known: DashboardTile[],
  next: DashboardTile[],
): Promise<SyncResult> {
  let failed = false;
  const settled: DashboardTile[] = [...next];

  const gone = known.filter(
    (k) => k.id && !next.some((n) => n.id && n.id === k.id),
  );
  for (const t of gone) {
    try {
      await deleteDashboardTile(dashboardId, t.id!);
    } catch {
      failed = true;
    }
  }

  for (let i = 0; i < settled.length; i++) {
    const t = settled[i];
    // Create when the tile has no id (brand new) OR when its id is not one
    // the server currently knows — that is an UNDO resurrecting a tile we
    // already deleted. Skipping those left undo restoring the board on screen
    // only, which is the same lie in the other direction.
    const resurrected = Boolean(t.id) && !known.some((k) => k.id === t.id);
    if (t.id && !resurrected) continue;
    try {
      const created = await addDashboardTile(dashboardId, {
        answer_id: t.answer_id,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
      });
      // Adopt the server's id so the next reconcile sees this tile as known
      // rather than creating a duplicate. A resurrected tile gets a NEW id —
      // its original row is gone and cannot be revived.
      settled[i] = { ...t, id: created.id };
    } catch {
      failed = true;
    }
  }

  for (const t of settled) {
    if (!t.id) continue;
    const before = known.find((k) => k.id === t.id);
    if (before && before.answer_id !== t.answer_id) {
      try {
        await replaceDashboardTile(dashboardId, t.id, t.answer_id);
      } catch {
        failed = true;
      }
    }
  }

  const geometry = settled
    .filter((t) => t.id && (t.x ?? -1) >= 0)
    .map((t) => ({ tile_id: t.id!, x: t.x!, y: t.y!, w: t.w!, h: t.h ?? 2 }));
  if (geometry.length) {
    try {
      await saveDashboardLayout(dashboardId, geometry);
    } catch {
      failed = true;
    }
  }

  return { tiles: settled, failed };
}
