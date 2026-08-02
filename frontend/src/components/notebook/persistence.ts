/**
 * Notebook persistence.
 *
 * The notebook used to be pure React state: every edit, insert, delete and run
 * lived in memory and died with the tab. This module is the write path.
 *
 * Two speeds, deliberately:
 *   - Source edits debounce (~600ms after you stop typing). Typing is a stream
 *     of intermediate states and none of them deserve a round trip.
 *   - Structural changes — insert, delete, reorder, kind change, run output —
 *     write immediately. They are discrete, intentional, and losing one is
 *     losing work.
 *
 * Writes are queued per cell so a fast edit followed by a delete can't land
 * out of order, and a failed write surfaces rather than silently dropping.
 */

import {
  addNotebookCell,
  deleteNotebookCell,
  renameNotebook,
  reorderNotebookCells,
  updateNotebookCell,
} from "@/lib/api/client";
import type { CellKind, NotebookCell, ReportConfidence } from "@/lib/api/types";

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

export const SOURCE_DEBOUNCE_MS = 600;

/**
 * A serialised write queue. Every mutation for a notebook runs in order, so
 * "patch cell then delete cell" can never invert into "delete then patch".
 */
export class NotebookWriter {
  private chain: Promise<unknown> = Promise.resolve();
  // The pending source is held WITH its timer. Holding only the timer meant
  // `flush` could cancel a write but had nothing left to send in its place —
  // see the note on flush.
  private timers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; source: string }
  >();
  private listeners = new Set<(s: SaveState) => void>();
  private inFlight = 0;

  constructor(private notebookId: string) {}

  /** The id can change once: a draft notebook is created on first write. */
  bind(notebookId: string) {
    this.notebookId = notebookId;
  }

  subscribe(fn: (s: SaveState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(s: SaveState) {
    // Deferred, always. A write can start from inside an effect (adopting the
    // seeded cell, hydrating an answer), and emitting synchronously would set
    // React state during that effect — a cascading render, and the thing the
    // compiler's set-state-in-effect rule exists to prevent. The save
    // indicator is not worth a render cascade.
    queueMicrotask(() => {
      for (const fn of this.listeners) fn(s);
    });
  }

  private run<T>(op: () => Promise<T>): Promise<T | undefined> {
    this.inFlight += 1;
    this.emit({ status: "saving" });
    const next = this.chain.then(async () => {
      try {
        const out = await op();
        this.inFlight -= 1;
        if (this.inFlight === 0) this.emit({ status: "saved", at: Date.now() });
        return out;
      } catch (e) {
        this.inFlight -= 1;
        this.emit({
          status: "error",
          message:
            e instanceof Error ? e.message : "This change could not be saved.",
        });
        return undefined;
      }
    });
    this.chain = next;
    return next;
  }

  /** Debounced — the caller types, this fires once they stop. */
  source(cellId: string, source: string) {
    const existing = this.timers.get(cellId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.timers.delete(cellId);
      void this.run(() =>
        updateNotebookCell(this.notebookId, cellId, { source }),
      );
    }, SOURCE_DEBOUNCE_MS);
    this.timers.set(cellId, { timer, source });
  }

  /**
   * Force any pending debounced source write to land now, then wait for the
   * queue to drain. Called before running a cell — you must never run stale
   * source.
   *
   * This once cleared the timer and awaited the chain, which *cancelled* the
   * pending write rather than flushing it. Because `runNotebookCell` sends only
   * a cell id and the server executes the source it has on file, typing and
   * pressing Run inside the debounce window ran the PREVIOUS source and
   * rendered its result beside the edited text — the exact deception the call
   * site says this exists to prevent. Cancelling is `remove`'s job, not this
   * one's.
   */
  async flush(cellId?: string): Promise<void> {
    const pending =
      cellId !== undefined
        ? this.timers.has(cellId)
          ? ([[cellId, this.timers.get(cellId)!]] as const)
          : []
        : ([...this.timers.entries()] as const);

    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      this.timers.delete(id);
      void this.run(() =>
        updateNotebookCell(this.notebookId, id, { source: p.source }),
      );
    }
    // `run` reassigns this.chain, so reading it after the loop covers the
    // writes just queued as well as anything already in flight.
    await this.chain;
  }

  kind(cellId: string, kind: CellKind) {
    return this.run(() => updateNotebookCell(this.notebookId, cellId, { kind }));
  }

  output(
    cellId: string,
    output: NotebookCell["output"],
    confidence: ReportConfidence | null,
  ) {
    return this.run(() =>
      updateNotebookCell(this.notebookId, cellId, { output, confidence }),
    );
  }

  insert(kind: CellKind, source: string, afterCellId?: string) {
    return this.run(() =>
      addNotebookCell(this.notebookId, {
        kind,
        source,
        after_cell_id: afterCellId,
      }),
    );
  }

  remove(cellId: string) {
    // Cancelling here is correct: the cell is going away, so its pending source
    // write has nothing left to write to.
    const t = this.timers.get(cellId);
    if (t) clearTimeout(t.timer);
    this.timers.delete(cellId);
    return this.run(() => deleteNotebookCell(this.notebookId, cellId));
  }

  reorder(cellIds: string[]) {
    return this.run(() => reorderNotebookCells(this.notebookId, cellIds));
  }

  rename(name: string) {
    return this.run(() => renameNotebook(this.notebookId, name));
  }
}
