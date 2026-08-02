/**
 * Dashboard tile reconciliation.
 *
 * `syncTiles` is the fix for "edits to the dashboard don't save, even when I
 * press Done, and on refresh they go away". Everything it does is invisible
 * from the board itself — the tiles look right either way — so this file is
 * the only place the difference between "saved" and "appeared to save" shows.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardTile } from "@/lib/api/types";

const calls: Array<{ fn: string; args: unknown[] }> = [];
const fail = new Set<string>();
let nextId = 0;

vi.mock("@/lib/api/client", () => {
  const record =
    (fn: string) =>
    async (...args: unknown[]) => {
      calls.push({ fn, args });
      if (fail.has(fn)) throw new Error(`${fn} failed`);
      nextId += 1;
      return { id: `srv_${nextId}` };
    };
  return {
    addDashboardTile: record("addDashboardTile"),
    deleteDashboardTile: record("deleteDashboardTile"),
    replaceDashboardTile: record("replaceDashboardTile"),
    saveDashboardLayout: record("saveDashboardLayout"),
  };
});

const { syncTiles } = await import("./sync");

const names = () => calls.map((c) => c.fn);
const of = (fn: string) => calls.filter((c) => c.fn === fn);

const tile = (t: Partial<DashboardTile>): DashboardTile =>
  ({ answer_id: "a1", x: 0, y: 0, w: 6, h: 2, ...t }) as DashboardTile;

beforeEach(() => {
  calls.length = 0;
  fail.clear();
  nextId = 0;
});

describe("create", () => {
  it("creates a tile that has no server id and adopts the id it is given", async () => {
    const next = [tile({ answer_id: "a1" })];
    const res = await syncTiles("d1", [], next);

    expect(of("addDashboardTile")).toHaveLength(1);
    expect(res.tiles[0].id).toBe("srv_1");
    expect(res.failed).toBe(false);
  });

  it("does not re-create a tile the server already knows", async () => {
    const known = [tile({ id: "t1" })];
    await syncTiles("d1", known, [...known]);

    expect(of("addDashboardTile")).toHaveLength(0);
  });

  /**
   * Adopting the returned id is what stops the NEXT reconcile from seeing the
   * same tile as new. Without it, every subsequent edit duplicated the board.
   */
  it("is idempotent across successive reconciles", async () => {
    const first = await syncTiles("d1", [], [tile({ answer_id: "a1" })]);
    calls.length = 0;
    await syncTiles("d1", first.tiles, first.tiles);

    expect(of("addDashboardTile")).toHaveLength(0);
  });
});

describe("delete", () => {
  it("deletes a tile the server knows and the next state drops", async () => {
    const known = [tile({ id: "t1" }), tile({ id: "t2" })];
    await syncTiles("d1", known, [known[0]]);

    expect(of("deleteDashboardTile")).toHaveLength(1);
    expect(of("deleteDashboardTile")[0].args[1]).toBe("t2");
  });

  it("deletes before it creates, so a swap cannot collide on geometry", async () => {
    const known = [tile({ id: "t1", x: 0 })];
    await syncTiles("d1", known, [tile({ answer_id: "a2", x: 0 })]);

    expect(names().indexOf("deleteDashboardTile")).toBeLessThan(
      names().indexOf("addDashboardTile"),
    );
  });
});

describe("undo", () => {
  /**
   * A tile removed and then restored by undo carries its ORIGINAL id, but the
   * server row is gone. Treating "has an id" as "server knows it" made undo
   * restore the board on screen only — the same lie as the original bug, in
   * the other direction.
   */
  it("re-creates a resurrected tile whose id the server no longer knows", async () => {
    const deleted = tile({ id: "t_old" });
    const res = await syncTiles("d1", [], [deleted]);

    expect(of("addDashboardTile")).toHaveLength(1);
    expect(res.tiles[0].id).toBe("srv_1");
    expect(res.tiles[0].id).not.toBe("t_old");
  });
});

describe("replace", () => {
  it("swaps the answer on a tile that kept its id", async () => {
    const known = [tile({ id: "t1", answer_id: "a1" })];
    await syncTiles("d1", known, [tile({ id: "t1", answer_id: "a2" })]);

    expect(of("replaceDashboardTile")).toHaveLength(1);
    expect(of("replaceDashboardTile")[0].args[2]).toBe("a2");
  });

  it("does not call replace when the answer is unchanged", async () => {
    const known = [tile({ id: "t1", answer_id: "a1" })];
    await syncTiles("d1", known, [tile({ id: "t1", answer_id: "a1", x: 3 })]);

    expect(of("replaceDashboardTile")).toHaveLength(0);
  });
});

describe("layout", () => {
  it("writes the whole geometry once, after creates, so new tiles are included", async () => {
    await syncTiles("d1", [], [tile({ answer_id: "a1", x: 2, y: 1 })]);

    const layout = of("saveDashboardLayout");
    expect(layout).toHaveLength(1);
    expect(names().indexOf("addDashboardTile")).toBeLessThan(
      names().indexOf("saveDashboardLayout"),
    );
    expect(layout[0].args[1]).toEqual([
      { tile_id: "srv_1", x: 2, y: 1, w: 6, h: 2 },
    ]);
  });

  it("skips the layout call entirely when there is no geometry to write", async () => {
    await syncTiles("d1", [], []);
    expect(of("saveDashboardLayout")).toHaveLength(0);
  });
});

describe("failure", () => {
  it("reports failure but still attempts the remaining work", async () => {
    fail.add("deleteDashboardTile");
    const known = [tile({ id: "t1" })];
    const res = await syncTiles("d1", known, [tile({ answer_id: "a2" })]);

    expect(res.failed).toBe(true);
    expect(of("addDashboardTile")).toHaveLength(1);
  });

  it("does not reject — a partial save must surface, not crash the board", async () => {
    fail.add("saveDashboardLayout");
    await expect(
      syncTiles("d1", [], [tile({ answer_id: "a1" })]),
    ).resolves.toMatchObject({ failed: true });
  });

  it("leaves a failed create without an id so the next reconcile retries it", async () => {
    fail.add("addDashboardTile");
    const res = await syncTiles("d1", [], [tile({ answer_id: "a1" })]);

    expect(res.failed).toBe(true);
    expect(res.tiles[0].id).toBeUndefined();
  });
});
