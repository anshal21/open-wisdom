"use client";

import * as React from "react";
import { MoreHorizontal, Play, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { EMPTY, formatCount, formatDuration, formatValue } from "@/lib/format";
import type { Cell as WireCell, CellKind } from "@/lib/api/types";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Viz } from "@/components/viz/viz";
import type { VizOverride } from "@/lib/viz/resolve";
import { Button, IconButton } from "@/components/ui/button";
import { MenuItem, Popover } from "@/components/ui/overlays";
import { Skeleton } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/table";
import { CellEditor } from "./cell-editor";
import { InCellFork } from "./in-cell-fork";
import { Markdown } from "./markdown";
import { PromoteBar } from "./promote";
import {
  CELL_KINDS,
  KIND_LABEL,
  PYTHON_FINDING,
  cellSealState,
  resultOf,
  stdoutOf,
  type CellView,
} from "./cell-model";

/** The 2px accent progress line at the cell's top edge while it runs. §7.3 */
function CellProgressLine() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden rounded-t-lg bg-accent-tint"
    >
      <span
        className="block h-full w-full"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, var(--c-accent-solid) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "ds-shimmer 1.4s linear infinite",
        }}
      />
    </span>
  );
}

export interface NotebookCellProps {
  cell: CellView;
  index: number;
  focused: boolean;
  editing: boolean;
  busy?: boolean;
  onFocusCell: () => void;
  onEnterEdit: () => void;
  onChangeSource: (v: string) => void;
  onChangeKind: (k: CellKind) => void;
  onRun: () => void;
  onRunFromHere: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onUseCandidate: (candidateId: string, ratify: boolean) => void;
  editorRef?: (el: HTMLTextAreaElement | null) => void;
  shellRef?: (el: HTMLDivElement | null) => void;
  onEditorKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function NotebookCellView({
  cell,
  index,
  focused,
  editing,
  busy = false,
  onFocusCell,
  onEnterEdit,
  onChangeSource,
  onChangeKind,
  onRun,
  onRunFromHere,
  onInsertBelow,
  onDelete,
  onUseCandidate,
  editorRef,
  shellRef,
  onEditorKeyDown,
}: NotebookCellProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLButtonElement>(null);

  const seal = cellSealState(cell);
  const running = cell.state === "running";
  const queued = cell.state === "queued";
  const stale = cell.state === "stale";
  const errored = cell.state === "error";
  const isMarkdown = cell.kind === "markdown";
  const result = resultOf(cell);
  const console_ = stdoutOf(cell);
  const showEditor = !isMarkdown || (focused && editing);

  return (
    <div className="flex gap-3" data-cell-index={index}>
      {/* Gutter: cell number + run status. §7.1 */}
      <div className="flex w-8 shrink-0 flex-col items-end gap-1 pt-2">
        <span className="text-ui-sm tabular text-tertiary" aria-hidden="true">
          ⌗{index + 1}
        </span>
        <span className="text-ui-sm text-disabled">
          <RunStatus state={cell.state} />
        </span>
      </div>

      <div
        ref={shellRef}
        tabIndex={-1}
        data-cell-shell
        onMouseDown={onFocusCell}
        onFocusCapture={onFocusCell}
        className={cn(
          "group relative min-w-0 flex-1 rounded-lg border bg-surface-1 transition-colors duration-100 outline-none",
          focused ? "border-border-accent" : "border-border-default",
          queued && "opacity-60",
        )}
      >
        {running ? <CellProgressLine /> : null}
        {queued ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-solid"
          />
        ) : null}
        {stale ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 left-0 border-l-2 border-dotted border-qualified"
          />
        ) : null}

        {/* Header strip */}
        <div className="flex h-8 items-center gap-1.5 border-b border-border-subtle px-2">
          <span className="text-label text-tertiary uppercase">
            {KIND_LABEL[cell.kind]}
          </span>
          {stale ? (
            <span className="text-ui-sm text-qualified">
              · a cell above ran after this one
            </span>
          ) : null}
          <span className="flex-1" />
          {!isMarkdown ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={onRun}
              loading={running}
              disabled={busy && !running}
            >
              {running ? null : <Play size={11} />}
              Run
            </Button>
          ) : null}
          <span
            className={cn(
              "opacity-0 transition-opacity duration-100",
              "group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <IconButton
              ref={menuRef}
              label="Cell actions"
              size="xs"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={14} />
            </IconButton>
          </span>
        </div>

        {/* Editor / prose */}
        {showEditor ? (
          <CellEditor
            value={cell.source}
            kind={cell.kind}
            onChange={onChangeSource}
            onFocus={onEnterEdit}
            onKeyDown={onEditorKeyDown}
            registerRef={editorRef}
          />
        ) : (
          <button
            type="button"
            onClick={onEnterEdit}
            className="block w-full px-3.5 py-3 text-left"
          >
            {cell.source.trim() ? (
              <Markdown source={cell.source} />
            ) : (
              <span className="text-body text-tertiary">
                Empty prose cell — click to write.
              </span>
            )}
          </button>
        )}

        {/* Result strip + output */}
        {errored ? (
          <div className="border-t border-border-subtle px-3.5 py-3">
            <p className="text-subtitle text-contested">The query didn’t run</p>
            <p className="mt-1 text-ui-sm text-secondary">
              {cell.error ?? "The source rejected this statement."}
            </p>
            <Button size="xs" variant="secondary" className="mt-2.5" onClick={onRun}>
              <RotateCw size={11} />
              Run again
            </Button>
          </div>
        ) : seal ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border-subtle px-3.5 py-2">
              <ConfidenceSeal
                state={seal}
                size="standard"
                passed={cell.report?.passed}
                total={cell.report?.total}
              />
              <span className="text-ui-sm tabular text-tertiary">
                {result
                  ? `${formatCount(result.row_count)} ${result.row_count === 1 ? "row" : "rows"}`
                  : "no rows yet"}
                {cell.elapsed_ms ? ` · ${formatDuration(cell.elapsed_ms)}` : ""}
              </span>
              {cell.kind === "python" ? (
                <span className="text-ui-sm text-unverified">{PYTHON_FINDING}</span>
              ) : null}
            </div>

            {cell.ambiguity ? (
              <div className="px-3.5 pb-3.5">
                <InCellFork
                  ambiguity={cell.ambiguity}
                  unit={result?.unit}
                  formatHint={result?.format_hint}
                  onUse={onUseCandidate}
                  busy={busy}
                />
              </div>
            ) : result || console_ ? (
              <CellOutput cell={cell} />
            ) : null}
          </>
        ) : null}

        {/* Footer: promotion — one click, never buried. §7.4 */}
        {!isMarkdown && (result || console_ || cell.report) ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
            <PromoteBar cell={cell} index={index} />
            {stale ? (
              <Button
                size="xs"
                variant="secondary"
                className="ml-auto"
                onClick={onRunFromHere}
              >
                <RotateCw size={11} />
                Re-run from here
              </Button>
            ) : null}
          </div>
        ) : null}

        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuRef}
          align="end"
          width={196}
        >
          {CELL_KINDS.filter((k) => k !== cell.kind).map((k) => (
            <MenuItem
              key={k}
              onSelect={() => {
                setMenuOpen(false);
                onChangeKind(k);
              }}
            >
              Change to {KIND_LABEL[k].toLowerCase()}
            </MenuItem>
          ))}
          <MenuItem
            onSelect={() => {
              setMenuOpen(false);
              onInsertBelow();
            }}
          >
            Insert cell below
          </MenuItem>
          <MenuItem
            danger
            onSelect={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            Delete cell
          </MenuItem>
        </Popover>
      </div>
    </div>
  );
}

function RunStatus({ state }: { state: CellView["state"] }) {
  const label: Record<CellView["state"], string> = {
    idle: "",
    queued: "queued",
    running: "running",
    done: "",
    error: "error",
    stale: "stale",
  };
  const tone: Record<CellView["state"], string> = {
    idle: "text-disabled",
    queued: "text-accent",
    running: "text-accent",
    done: "text-disabled",
    error: "text-contested",
    stale: "text-qualified",
  };
  if (!label[state]) return null;
  return <span className={cn("text-ui-sm", tone[state])}>{label[state]}</span>;
}

/* ---------------------------------------------------------------------------
   Output — a chart when the cell carries a spec, otherwise the rows
--------------------------------------------------------------------------- */

const MAX_ROWS = 10;

function CellOutput({ cell }: { cell: CellView }) {
  // `output` is a union across four kinds; resultOf/stdoutOf are the only
  // places that know its shape.
  const output = resultOf(cell);
  const console_ = stdoutOf(cell);
  const state = cellSealState(cell);
  const checks = cell.report?.checks ?? [];
  // Chart override for this cell — view state; a re-run replaces the output
  // and the shape may change with it.
  const [viz, setViz] = React.useState<VizOverride | undefined>(undefined);

  const columns = React.useMemo<Column<WireCell[]>[]>(() => {
    // A python cell's output is a note, not a table — it has no columns.
    if (!output?.columns) return [];
    let firstQuant = true;
    return output.columns.map((c, ci) => {
      const numeric = c.type === "quantitative";
      const hint = numeric && firstQuant ? (output.format_hint ?? "number") : "number";
      if (numeric) firstQuant = false;
      return {
        key: c.name,
        header: c.label ?? c.name,
        numeric,
        render: (row: WireCell[]) => {
          const v = row[ci];
          if (v === null || v === undefined || v === "") return EMPTY;
          return numeric
            ? formatValue(Number(v), hint, { unit: output.unit })
            : String(v);
        },
      };
    });
  }, [output]);

  if (!state) return null;

  // A python cell's console output renders as a terminal transcript. stderr
  // is shown too — a traceback is the most useful thing a failed cell has.
  if (!output && console_) {
    return (
      <div className="px-3.5 pb-3.5">
        <PythonConsole stdout={console_.stdout} stderr={console_.stderr} />
      </div>
    );
  }

  if (!output) return null;

  if (!output.columns.length || !output.rows.length) {
    return console_ ? (
      <div className="px-3.5 pb-3.5">
        <PythonConsole stdout={console_.stdout} stderr={console_.stderr} />
      </div>
    ) : (
      <div className="px-3.5 pb-3.5">
        <p className="text-ui-sm text-tertiary">
          The cell ran and returned no rows.
        </p>
      </div>
    );
  }

  if (output.chart) {
    return (
      <div className="px-3.5 pb-3.5">
        <Viz
          hint={output.chart}
          override={viz}
          onOverride={setViz}
          columns={output.columns}
          rows={output.rows}
          confidenceState={state}
          checks={checks}
          passed={cell.report?.passed}
          total={cell.report?.total}
          caveat={state === "qualified" ? cell.report?.headline : undefined}
          unit={output.unit}
          formatHint={output.format_hint}
        />
      </div>
    );
  }

  return (
    <div className="px-3.5 pb-3.5">
      <DataTable
        columns={columns}
        rows={output.rows.slice(0, MAX_ROWS)}
        getKey={(_, i) => String(i)}
        density="compact"
      />
      {output.row_count > MAX_ROWS ? (
        <p className="mt-1.5 text-ui-sm tabular text-tertiary">
          Showing {MAX_ROWS} of {formatCount(output.row_count)} rows.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Loading — geometry matches a loaded cell. §9.13
--------------------------------------------------------------------------- */

export function CellSkeleton({ index }: { index: number }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-8 shrink-0 justify-end pt-2">
        <span className="text-ui-sm tabular text-disabled" aria-hidden="true">
          ⌗{index + 1}
        </span>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1">
        <div className="flex h-8 items-center gap-2 border-b border-border-subtle px-2">
          <Skeleton className="h-3 w-14" />
        </div>
        <div className="px-3.5 py-2">
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex items-center gap-3 border-t border-border-subtle px-3.5 py-2">
          <Skeleton className="h-[26px] w-[136px] rounded-sm" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}

/**
 * A Python cell's console. stderr is shown alongside stdout rather than
 * swallowed — when a script fails, the traceback IS the output.
 */
function PythonConsole({ stdout, stderr }: { stdout: string; stderr?: string }) {
  if (!stdout && !stderr) {
    return <p className="text-ui-sm text-tertiary">The cell ran and printed nothing.</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-2">
      {stdout ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-ui-sm text-secondary">
          {stdout}
        </pre>
      ) : null}
      {stderr ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border-subtle bg-contested-bg px-3 py-2 font-mono text-ui-sm text-contested">
          {stderr}
        </pre>
      ) : null}
    </div>
  );
}
