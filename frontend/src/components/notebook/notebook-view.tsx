"use client";

import * as React from "react";
import { Play, Plus } from "lucide-react";
import type { Check, CellKind, ChartSpec, Report, ResultEvent } from "@/lib/api/types";
import { getAnswer, runNotebookCell, streamAsk, streamResolve } from "@/lib/api/client";
import { NotebookWriter, type SaveState } from "./persistence";
import { MOD, useHotkeys } from "@/lib/keyboard";
import { tally } from "@/lib/confidence";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/primitives";
import { useEvidence } from "@/state/evidence";
import { NotebookCellView } from "./cell";
import {
  answerIdOf,
  cellEvidence,
  insertAt,
  markDownstreamStale,
  newCell,
  nextKind,
  patchAt,
  pythonReport,
  removeAt,
  sqlReport,
  type CellView,
} from "./cell-model";

/**
 * The cell stack. screens.md §7 — every cell that produces a figure carries the
 * same verification apparatus as an answer, and can be promoted out of here.
 */
export function NotebookView({
  notebookId,
  initialCells,
  onSaveStateChange,
}: {
  notebookId: string;
  initialCells: CellView[];
  onSaveStateChange?: (s: SaveState) => void;
}) {
  const [cells, setCells] = React.useState<CellView[]>(() =>
    initialCells.length > 0 ? initialCells : [newCell("question")],
  );

  // One writer per notebook. Every structural change goes through it, in
  // order; source edits debounce inside it.
  const writer = React.useMemo(() => new NotebookWriter(notebookId), [notebookId]);
  React.useEffect(() => {
    if (!onSaveStateChange) return;
    return writer.subscribe(onSaveStateChange);
  }, [writer, onSaveStateChange]);

  // A cell created before the notebook existed has a local id; it is replaced
  // by the server's id the moment the insert lands.
  const isLocal = (id: string) => id.startsWith("draft_");

  /** Hydrate question cells from the answer ledger. The cell stores only an
   * answer_id, so the figure is read from the one place that owns it. */
  /**
   * A brand-new notebook renders one seeded question cell so the page isn't
   * empty — but that cell exists only on screen, so typing into it hit the
   * `draft_` guard and saved nothing. Adopt it on the server immediately.
   */
  const adopted = React.useRef(false);
  React.useEffect(() => {
    const only = cells.length === 1 ? cells[0] : null;
    if (!only || !isLocal(only.id)) return;
    // Set BEFORE the await. StrictMode invokes this effect twice on the same
    // instance, and unlike hydration an insert is not idempotent — without
    // the flag the notebook is born with two cells. The flag is deliberately
    // not cleared on cleanup: the second invocation must skip, while the
    // in-flight promise is still allowed to land its state update.
    if (adopted.current) return;
    adopted.current = true;
    void writer.insert(only.kind, only.source).then((saved) => {
      if (!saved) return;
      setCells((cs) =>
        cs.map((c) => (c.id === only.id ? { ...c, id: saved.id } : c)),
      );
    });
    // Mount-only: later drafts are adopted by `insert()` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: no "already ran" ref here. StrictMode mounts, cleans up, and mounts
  // again — a ref guard makes the first pass start the fetch, the simulated
  // cleanup cancel it, and the second pass skip. The result is a question cell
  // that never hydrates. Re-fetching is idempotent; guarding is not.
  React.useEffect(() => {
    let alive = true;
    const pending = cells
      .map((c, i) => ({ id: answerIdOf(c), i, c }))
      .filter(({ id, c }) => id && !c.answer);
    if (pending.length === 0) return;
    void Promise.all(
      pending.map(async ({ id, i }) => {
        try {
          const a = await getAnswer(id!);
          return { i, answer: a };
        } catch {
          return { i, answer: null };
        }
      }),
    ).then((results) => {
      if (!alive) return;
      setCells((cs) =>
        cs.map((c, i) => {
          const hit = results.find((r) => r.i === i);
          return hit
            ? {
                ...c,
                answer: hit.answer,
                hydrating: false,
                state: "done" as const,
                confidence: hit.answer?.report?.confidence ?? c.confidence,
                report: hit.answer?.report ?? c.report,
              }
            : c;
        }),
      );
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [focused, setFocused] = React.useState(0);
  const [mode, setMode] = React.useState<"edit" | "nav">("nav");
  const [busy, setBusy] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const editorRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});
  const shellRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const cellsRef = React.useRef(cells);
  React.useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const focusEditorNext = React.useRef<string | null>(null);
  const focusShellNext = React.useRef<string | null>(null);
  const setSubject = useEvidence((s) => s.setSubject);

  React.useEffect(() => {
    const e = focusEditorNext.current;
    if (e) {
      focusEditorNext.current = null;
      editorRefs.current[e]?.focus();
    }
    const s = focusShellNext.current;
    if (s) {
      focusShellNext.current = null;
      shellRefs.current[s]?.focus();
    }
  });

  /* --- focus ------------------------------------------------------------- */

  // The evidence panel tracks the focused cell, and follows it as it runs. §7.1
  React.useEffect(() => {
    const cell = cells[focused];
    if (!cell) return;
    const subject = cellEvidence(cell, focused);
    if (subject) setSubject(subject);
  }, [cells, focused, setSubject]);

  const focusCell = React.useCallback(
    (index: number, next: "edit" | "nav") => {
      const cell = cellsRef.current[index];
      if (!cell) return;
      setFocused(index);
      setMode(next);
      if (next === "edit") focusEditorNext.current = cell.id;
      else focusShellNext.current = cell.id;
    },
    [],
  );

  /* --- run --------------------------------------------------------------- */

  const patch = React.useCallback((index: number, p: Partial<CellView>) => {
    setCells((cs) => patchAt(cs, index, p));
  }, []);

  const runCell = React.useCallback(
    async (index: number): Promise<boolean> => {
      const cell = cellsRef.current[index];
      if (!cell) return false;

      if (cell.kind === "markdown") {
        patch(index, { state: "done", dirty: false });
        return true;
      }

      patch(index, {
        state: "running",
        error: undefined,
        ambiguity: undefined,
      });
      const started = Date.now();

      if (cell.kind === "question") {
        let result: ResultEvent | null = null;
        let chart: ChartSpec | null = null;
        let report: Report | null = null;
        let ambiguity: CellView["ambiguity"];
        const checks: Check[] = [];
        let failure: string | null = null;

        try {
          for await (const evt of streamAsk({ question: cell.source })) {
            if (evt.event === "result") result = evt.data;
            else if (evt.event === "chart") chart = evt.data;
            else if (evt.event === "check") {
              // Checks stream into the cell as they land, so the evidence panel
              // fills in while the cell is still running. §0.4
              checks.push(evt.data);
              const snapshot = [...checks];
              const { passed, total } = tally(snapshot);
              patch(index, {
                report: {
                  confidence: "unverified",
                  checks: snapshot,
                  passed,
                  total,
                  headline: "",
                },
              });
            }
            else if (evt.event === "verdict") report = evt.data;
            else if (evt.event === "ambiguity") ambiguity = evt.data;
            else if (evt.event === "error") failure = evt.data.message;
          }
        } catch {
          failure = "The question could not be answered. Run the cell again.";
        }

        const elapsed = Date.now() - started;

        if (failure) {
          patch(index, { state: "error", error: failure, elapsed_ms: elapsed });
          return false;
        }

        if (ambiguity) {
          setCells((cs) =>
            patchAt(markDownstreamStale(cs, index), index, {
              state: "done",
              confidence: "refused",
              report: report ?? undefined,
              ambiguity,
              output: null,
              elapsed_ms: elapsed,
              dirty: false,
            }),
          );
          return true;
        }

        // The cell persists ONLY the reference. The figure lives in the
        // answer ledger, which is what a re-run or a supersession updates —
        // a notebook holding its own copy would quietly go stale.
        if (result?.answer_id) {
          void writer.output(cell.id, { answer_id: result.answer_id }, report?.confidence ?? "unverified");
        }

        setCells((cs) =>
          patchAt(markDownstreamStale(cs, index), index, {
            state: "done",
            output: result?.answer_id ? { answer_id: result.answer_id } : null,
            answer: result
              ? ({
                  id: result.answer_id,
                  columns: result.columns,
                  rows: result.rows,
                  row_count: result.row_count,
                  value: result.value,
                  unit: result.unit,
                  format_hint: result.format_hint,
                  chart,
                  report: report ?? null,
                } as unknown as NonNullable<CellView["answer"]>)
              : null,
            report: report ?? undefined,
            confidence: report?.confidence ?? "unverified",
            elapsed_ms: elapsed,
            dirty: false,
          }),
        );
        return true;
      }

      // sql / python — executed by the server. This used to be a setTimeout
      // returning an empty table, which meant a notebook could look like it
      // ran without a query ever reaching the warehouse.
      //
      // Any pending debounced source edit must land FIRST: running stale
      // source and showing the result against the edited text would be the
      // notebook lying about what it executed.
      await writer.flush(cell.id);

      let res: Awaited<ReturnType<typeof runNotebookCell>> | null = null;
      let transportError: string | null = null;
      try {
        res = await runNotebookCell(notebookId, cell.id);
      } catch (e) {
        transportError =
          e instanceof Error ? e.message : "The cell could not be run.";
      }
      const elapsed = Date.now() - started;

      if (transportError || !res) {
        patch(index, {
          state: "error",
          error: transportError ?? "The cell could not be run.",
          elapsed_ms: elapsed,
        });
        return false;
      }

      // A script that threw is a normal notebook outcome: keep the output
      // (the traceback is the useful part) and mark the cell errored.
      if (res.error) {
        setCells((cs) =>
          patchAt(markDownstreamStale(cs, index), index, {
            state: "error",
            output: res!.output,
            error: res!.error,
            confidence: "unverified",
            elapsed_ms: elapsed,
            dirty: false,
          }),
        );
        return false;
      }

      const report =
        cell.kind === "python" ? pythonReport() : sqlReport();

      setCells((cs) =>
        patchAt(markDownstreamStale(cs, index), index, {
          state: "done",
          output: res!.output,
          report,
          confidence: res!.confidence ?? "unverified",
          elapsed_ms: res!.elapsed_ms ?? elapsed,
          error: undefined,
          dirty: false,
        }),
      );
      return true;
    },
    [patch, notebookId, writer],
  );

  const runOne = React.useCallback(
    async (index: number) => {
      if (busy) return;
      setBusy(true);
      await runCell(index);
      setBusy(false);
    },
    [busy, runCell],
  );

  const runFrom = React.useCallback(
    async (start: number) => {
      if (busy) return;
      setBusy(true);
      const ids = cellsRef.current
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => i >= start && c.kind !== "markdown")
        .map(({ i }) => i);
      setCells((cs) =>
        cs.map((c, i) =>
          ids.includes(i) && c.kind !== "markdown" ? { ...c, state: "queued" } : c,
        ),
      );
      for (const i of ids) {
        const ok = await runCell(i);
        // A cell error stops the run. §14
        if (!ok) {
          setCells((cs) =>
            cs.map((c) => (c.state === "queued" ? { ...c, state: "idle" } : c)),
          );
          break;
        }
      }
      setBusy(false);
    },
    [busy, runCell],
  );

  const runAndAdvance = React.useCallback(async () => {
    const at = focused;
    await runOne(at);
    const list = cellsRef.current;
    if (at >= list.length - 1) {
      const created = newCell("question");
      setCells((cs) => [...cs, created]);
      setFocused(at + 1);
      setMode("edit");
      focusEditorNext.current = created.id;
    } else {
      focusCell(at + 1, "edit");
    }
  }, [focused, runOne, focusCell]);

  /* --- resolve a fork inside the cell ------------------------------------ */

  const resolveWithCandidate = React.useCallback(
    async (index: number, candidateId: string, ratify: boolean) => {
      if (busy) return;
      setBusy(true);
      patch(index, { state: "running" });
      const started = Date.now();
      let result: ResultEvent | null = null;
      let chart: ChartSpec | null = null;
      let report: Report | null = null;
      try {
        for await (const evt of streamResolve({
          thread_id: cellsRef.current[index]?.id ?? "",
          candidate_id: candidateId,
          ratify,
        })) {
          if (evt.event === "result") result = evt.data;
          else if (evt.event === "chart") chart = evt.data;
          else if (evt.event === "verdict") report = evt.data;
        }
      } catch {
        /* fall through to the error branch below */
      }
      const elapsed = Date.now() - started;
      if (!result) {
        patch(index, {
          state: "error",
          error: "The chosen reading could not be computed. Run the cell again.",
          elapsed_ms: elapsed,
        });
      } else {
        setCells((cs) =>
          patchAt(markDownstreamStale(cs, index), index, {
            state: "done",
            ambiguity: undefined,
            output: {
              columns: result.columns,
              rows: result.rows,
              row_count: result.row_count,
              value: result.value,
              unit: result.unit,
              format_hint: result.format_hint,
              chart,
            },
            report: report ?? undefined,
            confidence: report?.confidence ?? "unverified",
            elapsed_ms: elapsed,
          }),
        );
      }
      setBusy(false);
    },
    [busy, patch],
  );

  /* --- structure --------------------------------------------------------- */

  const insert = React.useCallback(
    (at: number) => {
      const created = newCell("question");
      setCells((cs) => insertAt(cs, at, created));
      setFocused(at);
      setMode("edit");
      focusEditorNext.current = created.id;
      // Persist immediately and adopt the server's id: a cell that exists
      // on screen but not on the server is the bug this whole change fixes.
      const after = at > 0 ? cellsRef.current[at - 1]?.id : undefined;
      void writer
        .insert("question", "", after && !isLocal(after) ? after : undefined)
        .then((saved) => {
          if (!saved) return;
          setCells((cs) =>
            cs.map((c) => (c.id === created.id ? { ...c, id: saved.id } : c)),
          );
          if (focusEditorNext.current === created.id) {
            focusEditorNext.current = saved.id;
          }
        });
    },
    [writer],
  );

  const remove = React.useCallback(
    (index: number) => {
      const doomed = cellsRef.current[index];
      setCells((cs) => {
        if (cs.length <= 1) return [newCell("question")];
        return removeAt(cs, index);
      });
      setFocused((f) => Math.max(0, Math.min(f, cellsRef.current.length - 2)));
      setMode("nav");
      if (doomed && !isLocal(doomed.id)) void writer.remove(doomed.id);
    },
    [writer],
  );

  const changeKind = React.useCallback(
    (index: number, kind: CellKind) => {
      patch(index, {
        kind,
        state: "idle",
        output: null,
        answer: null,
        report: undefined,
        confidence: null,
        ambiguity: undefined,
        error: undefined,
        dirty: true,
      });
      const id = cellsRef.current[index]?.id;
      // The server clears the stored output too: a cell whose kind changed is
      // no longer described by its old result.
      if (id && !isLocal(id)) void writer.kind(id, kind);
    },
    [patch, writer],
  );

  /* --- keyboard model — §7.3 --------------------------------------------- */

  const navActive = React.useCallback(() => {
    if (mode !== "nav") return false;
    const el = document.activeElement;
    return el === document.body || Boolean(rootRef.current?.contains(el));
  }, [mode]);

  useHotkeys(
    [
      {
        key: "Enter",
        shift: true,
        mod: false,
        allowInEditable: true,
        run: () => void runAndAdvance(),
      },
      {
        key: "Enter",
        mod: true,
        shift: true,
        allowInEditable: true,
        run: () => void runFrom(0),
      },
      {
        key: "Enter",
        mod: true,
        shift: false,
        allowInEditable: true,
        run: () => void runOne(focused),
      },
      {
        key: "Escape",
        allowInEditable: true,
        run: () => focusCell(focused, "nav"),
      },
      {
        key: "v",
        mod: true,
        shift: true,
        allowInEditable: true,
        run: () => changeKind(focused, nextKind(cellsRef.current[focused].kind)),
      },
      {
        key: "Enter",
        mod: false,
        shift: false,
        run: () => {
          if (navActive()) focusCell(focused, "edit");
        },
      },
      {
        key: "ArrowDown",
        run: () => {
          if (navActive())
            focusCell(Math.min(cellsRef.current.length - 1, focused + 1), "nav");
        },
      },
      {
        key: "ArrowUp",
        run: () => {
          if (navActive()) focusCell(Math.max(0, focused - 1), "nav");
        },
      },
      {
        key: "a",
        run: () => {
          if (navActive()) insert(focused);
        },
      },
      {
        key: "b",
        run: () => {
          if (navActive()) insert(focused + 1);
        },
      },
      {
        key: "d d",
        run: () => {
          if (navActive()) remove(focused);
        },
      },
    ],
    [focused, mode, runAndAdvance, runFrom, runOne, focusCell, changeKind, insert, remove, navActive],
  );

  /* --- render ------------------------------------------------------------ */

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void runFrom(0)} disabled={busy}>
          <Play size={12} />
          Run all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => insert(cells.length)}>
          <Plus size={13} />
          Add cell
        </Button>
        <span className="ml-auto flex items-center gap-1.5 text-ui-sm text-tertiary">
          <Kbd>⇧↵</Kbd> run and move on
          <Kbd>{MOD}↵</Kbd> run in place
          <Kbd>Esc</Kbd> cell navigation
        </span>
      </div>

      {cells.map((cell, i) => (
        <NotebookCellView
          key={cell.id}
          cell={cell}
          index={i}
          focused={focused === i}
          editing={mode === "edit"}
          busy={busy}
          shellRef={(el) => {
            shellRefs.current[cell.id] = el;
          }}
          editorRef={(el) => {
            editorRefs.current[cell.id] = el;
          }}
          onFocusCell={() => setFocused(i)}
          onEnterEdit={() => focusCell(i, "edit")}
          onChangeSource={(v) => {
            patch(i, { source: v, dirty: true });
            if (!isLocal(cell.id)) writer.source(cell.id, v);
          }}
          onChangeKind={(k) => changeKind(i, k)}
          onRun={() => void runOne(i)}
          onRunFromHere={() => void runFrom(i)}
          onInsertBelow={() => insert(i + 1)}
          onDelete={() => remove(i)}
          onUseCandidate={(id, ratify) => void resolveWithCandidate(i, id, ratify)}
        />
      ))}

      <div className="flex justify-center pt-1 pb-8">
        <Button size="sm" variant="ghost" onClick={() => insert(cells.length)}>
          <Plus size={13} />
          Add cell
        </Button>
      </div>
    </div>
  );
}
