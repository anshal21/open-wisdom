"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatValue, isoTitle } from "@/lib/format";
import type {
  AmbiguityPayload,
  AnswerSummary,
  Definition,
  Report,
  ResultEvent,
} from "@/lib/api/types";
import { getAnswers, getDefinitions, streamAsk } from "@/lib/api/client";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Input, Skeleton, Tabs, Textarea } from "@/components/ui/primitives";
import { MOD } from "@/lib/keyboard";

/**
 * §6.3 — three paths, all leading to the same place. There is deliberately no
 * chart builder: you ask a question, verify the answer, and place it.
 */

type TabKey = "ledger" | "definitions" | "ask";

export function AddTileDialog({
  open,
  onClose,
  onAdd,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (answerId: string) => void;
  existing: ReadonlySet<string>;
}) {
  const [tab, setTab] = React.useState<TabKey>("ledger");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="wide"
      title="Add a tile"
      description="Tiles come from answers that have already been through verification."
    >
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        options={[
          { value: "ledger", label: "From ledger" },
          { value: "definitions", label: "From definitions" },
          { value: "ask", label: "Ask" },
        ]}
      />
      <div className="pt-4">
        {tab === "ledger" ? (
          <FromLedger onAdd={onAdd} existing={existing} />
        ) : tab === "definitions" ? (
          <FromDefinitions onAdd={onAdd} existing={existing} />
        ) : (
          <FromAsk onAdd={onAdd} />
        )}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
   A refused answer cannot become a tile. §6.2
--------------------------------------------------------------------------- */

function RefusedNotice({ href, count }: { href: string; count?: number }) {
  const router = useRouter();
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-accent-tint-border bg-accent-tint px-3.5 py-2.5">
      <span className="mt-px shrink-0 text-accent">
        <ConfidenceGlyph state="refused" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-subtitle text-accent">
          {count && count > 1
            ? `This question has ${count} defensible answers`
            : "This question has more than one defensible answer"}
        </p>
        <p className="mt-0.5 text-ui-sm text-secondary">
          A refused answer has no single number, so it cannot be a tile. Choose a reading
          on the fork first — the resolved answer can then be placed here.
        </p>
      </div>
      <Button size="sm" variant="primary" onClick={() => router.push(href)}>
        Resolve the fork
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   From ledger — searchable, the default
--------------------------------------------------------------------------- */

function AnswerRow({
  answer,
  selected,
  disabled,
  onSelect,
}: {
  answer: AnswerSummary;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-row
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "flex h-9 w-full items-center gap-3 rounded-sm px-2 text-left transition-colors duration-100",
          selected ? "bg-overlay-selected" : "hover:bg-overlay-hover",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-ui text-primary">
          {answer.question}
        </span>
        <span className="shrink-0 text-ui-sm tabular text-secondary">
          {formatValue(answer.value, answer.format_hint, { unit: answer.unit })}
        </span>
        <ConfidenceSeal
          state={answer.confidence}
          size="inline"
          className="w-[92px] justify-center"
        />
        <time
          dateTime={answer.created_at}
          title={isoTitle(answer.created_at)}
          className="w-[112px] shrink-0 text-right text-ui-sm tabular text-tertiary"
        >
          {formatAbsolute(answer.created_at, false)}
        </time>
      </button>
    </li>
  );
}

/** Every list is arrow-navigable. §15 */
function rovingKeys(
  e: React.KeyboardEvent,
  ref: React.RefObject<HTMLUListElement | null>,
) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const nodes = Array.from(
    ref.current?.querySelectorAll<HTMLButtonElement>(
      "button[data-row]:not(:disabled)",
    ) ?? [],
  );
  if (nodes.length === 0) return;
  e.preventDefault();
  const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? at + 1 : at - 1;
  nodes[Math.max(0, Math.min(nodes.length - 1, next))]?.focus();
}

function FromLedger({
  onAdd,
  existing,
}: {
  onAdd: (id: string) => void;
  existing: ReadonlySet<string>;
}) {
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<AnswerSummary[] | null>(null);
  const [selected, setSelected] = React.useState<AnswerSummary | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    let alive = true;
    void getAnswers().then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = React.useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.question.toLowerCase().includes(q) ||
        (r.definition_used?.name ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary"
        />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search answers"
          className="pl-8"
          aria-label="Search answers"
        />
      </div>

      <ul
        ref={listRef}
        onKeyDown={(e) => rovingKeys(e, listRef)}
        className="h-[320px] overflow-y-auto rounded-md border border-border-default bg-surface-1 p-1"
      >
        {rows === null
          ? Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex h-9 items-center px-2">
                <Skeleton className="h-3 w-full max-w-[380px]" />
              </li>
            ))
          : filtered.map((a) => (
              <AnswerRow
                key={a.id}
                answer={a}
                selected={selected?.id === a.id}
                disabled={existing.has(a.id)}
                onSelect={() => setSelected(a)}
              />
            ))}
        {rows !== null && filtered.length === 0 ? (
          <li className="px-2 py-8 text-center text-ui-sm text-tertiary">
            No answer matches “{query}”. Ask the question on the Ask tab and it will be
            recorded in the ledger.
          </li>
        ) : null}
      </ul>

      {selected?.confidence === "refused" ? (
        <RefusedNotice href={`/a/${selected.id}`} />
      ) : (
        <div className="flex items-center justify-end gap-2">
          <p className="mr-auto text-ui-sm text-tertiary">
            {selected ? selected.question : "Select an answer to place on the dashboard."}
          </p>
          <Button
            variant="primary"
            size="md"
            disabled={!selected}
            onClick={() => selected && onAdd(selected.id)}
          >
            Add tile
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   From definitions — pick a metric, then a range
--------------------------------------------------------------------------- */

function FromDefinitions({
  onAdd,
  existing,
}: {
  onAdd: (id: string) => void;
  existing: ReadonlySet<string>;
}) {
  const [definitions, setDefinitions] = React.useState<Definition[] | null>(null);
  const [answers, setAnswers] = React.useState<AnswerSummary[]>([]);
  const [picked, setPicked] = React.useState<Definition | null>(null);
  const [selected, setSelected] = React.useState<AnswerSummary | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    let alive = true;
    void Promise.all([getDefinitions(), getAnswers()]).then(([d, a]) => {
      if (!alive) return;
      setDefinitions(d.filter((x) => x.status === "ratified"));
      setAnswers(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  const ranges = React.useMemo(
    () =>
      picked
        ? answers.filter(
            (a) => a.definition_used?.id === picked.id && a.confidence !== "refused",
          )
        : [],
    [picked, answers],
  );

  return (
    <div className="grid h-[380px] grid-cols-[240px_1fr] gap-3">
      <div className="overflow-y-auto rounded-md border border-border-default bg-surface-1 p-1">
        {definitions === null
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex h-9 items-center px-2">
                <Skeleton className="h-3 w-full" />
              </div>
            ))
          : definitions.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={picked?.id === d.id}
                onClick={() => {
                  setPicked(d);
                  setSelected(null);
                }}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-100",
                  picked?.id === d.id ? "bg-overlay-selected" : "hover:bg-overlay-hover",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-ui text-primary">
                  {d.name}
                </span>
                <span className="shrink-0 text-ui-sm tabular text-tertiary">
                  v{d.version}
                </span>
              </button>
            ))}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {picked ? (
          <>
            <p className="text-ui-sm text-secondary">{picked.plain_english}</p>
            <ul
              ref={listRef}
              onKeyDown={(e) => rovingKeys(e, listRef)}
              className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-default bg-surface-1 p-1"
            >
              {ranges.map((a) => (
                <AnswerRow
                  key={a.id}
                  answer={a}
                  selected={selected?.id === a.id}
                  disabled={existing.has(a.id)}
                  onSelect={() => setSelected(a)}
                />
              ))}
              {ranges.length === 0 ? (
                <li className="px-2 py-8 text-center text-ui-sm text-tertiary">
                  No answer has been recorded against {picked.name} yet. Ask for it on the
                  Ask tab and it becomes placeable here.
                </li>
              ) : null}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <p className="mr-auto text-ui-sm text-tertiary">
                Pick the range you want on the dashboard.
              </p>
              <Button
                variant="primary"
                size="md"
                disabled={!selected}
                onClick={() => selected && onAdd(selected.id)}
              >
                Add tile
              </Button>
            </div>
          </>
        ) : (
          <p className="pt-8 text-center text-ui-sm text-tertiary">
            Pick a definition to see the ranges that have been answered against it.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Ask — an inline composer
--------------------------------------------------------------------------- */

function FromAsk({ onAdd }: { onAdd: (id: string) => void }) {
  const [question, setQuestion] = React.useState("");
  const [stage, setStage] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ResultEvent | null>(null);
  const [report, setReport] = React.useState<Report | null>(null);
  const [ambiguity, setAmbiguity] = React.useState<AmbiguityPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  const ask = React.useCallback(async () => {
    const q = question.trim();
    if (!q || running) return;
    setRunning(true);
    setResult(null);
    setReport(null);
    setAmbiguity(null);
    setError(null);
    setStage("interpret");
    try {
      for await (const evt of streamAsk({ question: q })) {
        if (evt.event === "stage" && evt.data.state === "start") setStage(evt.data.stage);
        else if (evt.event === "result") setResult(evt.data);
        else if (evt.event === "ambiguity") setAmbiguity(evt.data);
        else if (evt.event === "verdict") setReport(evt.data);
        else if (evt.event === "error") setError(evt.data.message);
      }
    } catch {
      setError("The question could not be answered. Try again.");
    } finally {
      setRunning(false);
      setStage(null);
    }
  }, [question, running]);

  const state = ambiguity ? "refused" : (report?.confidence ?? "checking");

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        autoFocus
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void ask();
          }
        }}
        placeholder="Ask a question. The answer is verified before it can be placed."
        aria-label="Question"
      />

      <div className="flex items-center gap-2">
        <p className="mr-auto text-ui-sm text-tertiary">
          {running ? `Working — ${stage ?? "interpret"}` : `${MOD}↵ to ask`}
        </p>
        <Button
          variant="primary"
          size="md"
          loading={running}
          disabled={question.trim().length === 0}
          onClick={() => void ask()}
        >
          Ask
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-contested-border bg-contested-bg px-3.5 py-2.5">
          <p className="text-subtitle text-contested">The query didn’t run</p>
          <p className="mt-0.5 text-ui-sm text-secondary">{error}</p>
        </div>
      ) : null}

      {ambiguity ? (
        <RefusedNotice
          href={`/ask?q=${encodeURIComponent(question)}`}
          count={ambiguity.candidates.length}
        />
      ) : result ? (
        <div className="flex items-center gap-3 rounded-md border border-border-default bg-surface-1 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui-sm text-tertiary">{question}</p>
            <p className="mt-0.5 text-title-lg tabular text-primary">
              {formatValue(result.value, result.format_hint, { unit: result.unit })}
            </p>
          </div>
          <ConfidenceSeal
            state={state}
            size="standard"
            passed={report?.passed}
            total={report?.total}
          />
          <Button
            variant="primary"
            size="md"
            disabled={running}
            onClick={() => onAdd(result.answer_id)}
          >
            Add tile
          </Button>
        </div>
      ) : null}
    </div>
  );
}
