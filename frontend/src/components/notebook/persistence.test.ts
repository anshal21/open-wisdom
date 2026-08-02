/**
 * The notebook write path.
 *
 * These exist because the module they cover is the fix for "edits don't save,
 * and on refresh they go away" — a bug whose whole character is that nothing
 * on screen looks wrong. Only a test can see a write that was never sent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ fn: string; args: unknown[] }> = [];
const fail = new Set<string>();

vi.mock("@/lib/api/client", () => {
  const record =
    (fn: string) =>
    async (...args: unknown[]) => {
      calls.push({ fn, args });
      if (fail.has(fn)) throw new Error(`${fn} failed`);
      return { id: `srv_${calls.length}` };
    };
  return {
    addNotebookCell: record("addNotebookCell"),
    deleteNotebookCell: record("deleteNotebookCell"),
    renameNotebook: record("renameNotebook"),
    reorderNotebookCells: record("reorderNotebookCells"),
    updateNotebookCell: record("updateNotebookCell"),
  };
});

const { NotebookWriter, SOURCE_DEBOUNCE_MS } = await import("./persistence");

const updates = () => calls.filter((c) => c.fn === "updateNotebookCell");
/** The payload of the nth updateNotebookCell call. */
const payload = (n: number) => updates()[n]?.args[2] as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
  fail.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("source debounce", () => {
  it("does not write while the caller is still typing", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "SEL");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS - 50);
    w.source("c1", "SELECT 1");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS - 50);

    expect(updates()).toHaveLength(0);
  });

  it("writes once, with the final text, after the caller stops", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "SEL");
    w.source("c1", "SELE");
    w.source("c1", "SELECT 1");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS + 10);

    expect(updates()).toHaveLength(1);
    expect(payload(0)).toEqual({ source: "SELECT 1" });
  });

  it("debounces each cell independently", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "one");
    w.source("c2", "two");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS + 10);

    expect(updates()).toHaveLength(2);
  });
});

describe("flush", () => {
  /**
   * The regression this file was written for.
   *
   * flush() used to clear the pending timer and await the chain — cancelling
   * the write instead of forcing it. Since `runNotebookCell` sends only a cell
   * id and the server executes the source it has stored, pressing Run inside
   * the debounce window executed the PREVIOUS source and displayed its result
   * against the edited text.
   */
  it("sends the pending edit rather than discarding it", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "SELECT 2");
    // No timer advance: this is the user hitting Run immediately after typing.
    await w.flush("c1");

    expect(updates()).toHaveLength(1);
    expect(payload(0)).toEqual({ source: "SELECT 2" });
  });

  it("leaves no timer behind, so the write does not also fire later", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "SELECT 2");
    await w.flush("c1");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS * 2);

    expect(updates()).toHaveLength(1);
  });

  it("flushes only the named cell", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "one");
    w.source("c2", "two");
    await w.flush("c1");

    expect(updates()).toHaveLength(1);
    expect(payload(0)).toEqual({ source: "one" });
  });

  it("flushes every cell when called with no id", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "one");
    w.source("c2", "two");
    await w.flush();

    expect(updates()).toHaveLength(2);
  });

  it("is a no-op when nothing is pending", async () => {
    const w = new NotebookWriter("nb_1");
    await w.flush("c1");
    expect(calls).toHaveLength(0);
  });

  it("waits for an in-flight write before returning", async () => {
    const w = new NotebookWriter("nb_1");
    void w.kind("c1", "sql");
    await w.flush();
    expect(calls).toHaveLength(1);
  });
});

describe("remove", () => {
  it("cancels the cell's pending source write — there is nothing to write to", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "doomed");
    await w.remove("c1");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS * 2);

    expect(updates()).toHaveLength(0);
    expect(calls.map((c) => c.fn)).toEqual(["deleteNotebookCell"]);
  });

  it("does not disturb another cell's pending write", async () => {
    const w = new NotebookWriter("nb_1");
    w.source("c1", "doomed");
    w.source("c2", "kept");
    await w.remove("c1");
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS + 10);

    expect(updates()).toHaveLength(1);
    expect(payload(0)).toEqual({ source: "kept" });
  });
});

describe("ordering", () => {
  it("serialises writes so a delete cannot overtake an earlier patch", async () => {
    const w = new NotebookWriter("nb_1");
    void w.kind("c1", "python");
    void w.remove("c1");
    void w.reorder(["c2"]);
    await vi.runAllTimersAsync();

    expect(calls.map((c) => c.fn)).toEqual([
      "updateNotebookCell",
      "deleteNotebookCell",
      "reorderNotebookCells",
    ]);
  });
});

describe("failure", () => {
  it("reports an error and keeps the queue alive for the next write", async () => {
    const w = new NotebookWriter("nb_1");
    const seen: string[] = [];
    w.subscribe((s) => seen.push(s.status));

    fail.add("reorderNotebookCells");
    await w.reorder(["c1"]);
    await vi.runAllTimersAsync();

    fail.clear();
    await w.rename("still works");
    await vi.runAllTimersAsync();

    expect(seen).toContain("error");
    expect(calls.map((c) => c.fn)).toContain("renameNotebook");
  });

  it("resolves undefined rather than rejecting, so callers cannot crash on a failed save", async () => {
    const w = new NotebookWriter("nb_1");
    fail.add("renameNotebook");
    await expect(w.rename("x")).resolves.toBeUndefined();
  });
});

describe("bind", () => {
  it("retargets writes after a draft notebook is created", async () => {
    const w = new NotebookWriter("draft");
    w.bind("nb_real");
    await w.rename("named");

    expect(calls[0].args[0]).toBe("nb_real");
  });
});
