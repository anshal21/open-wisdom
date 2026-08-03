"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, GitBranch, Sparkles } from "lucide-react";
import { getCatalog, getSettings, getSources } from "@/lib/api/client";
import type { Catalog, Source } from "@/lib/api/types";
import { useHotkeys } from "@/lib/keyboard";
import { useAsk, contextFromChips, turnState, turnTally } from "@/state/ask";
import { useEvidence } from "@/state/evidence";
import { useUi } from "@/state/ui";
import { useToast } from "@/components/ui/toast";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { AskComposer } from "@/components/ask/composer";
import { AnswerBlock } from "@/components/ask/answer-block";
import { ScrollbackTurn } from "@/components/ask/scrollback-turn";
import { RatifySheet } from "@/components/definitions/ratify-sheet";

/**
 * `useSearchParams` opts a route into client-side rendering, and Next requires
 * an explicit Suspense boundary to say what to show while that resolves.
 * Without it the production build fails at prerender — invisible in `next dev`,
 * which is why this survived until the first real `npm run build`.
 *
 * The fallback is the same skeleton the page already uses while booting, so
 * the boundary is not a new visual state.
 */
export default function AskPage() {
  return (
    <React.Suspense fallback={<BootSkeleton />}>
      <AskSurface />
    </React.Suspense>
  );
}

function AskSurface() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);

  const {
    turns,
    draft,
    setDraft,
    ask,
    reset,
    setExpected,
    focusedTurnId,
    setFocusedTurn,
    editChip,
    removeChip,
    togglePin,
    resolveCandidate,
    setViz,
    title,
  } = useAsk();
  const setSubject = useEvidence((s) => s.setSubject);
  const { setEvidenceOpen } = useUi();

  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [ratify, setRatify] = React.useState<{
    open: boolean;
    name?: string;
    expression?: string;
    plainEnglish?: string;
    candidateId?: string;
    turnId?: string;
  }>({ open: false });

  // --- bootstrap ---------------------------------------------------------
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [srcs, settings] = await Promise.all([getSources(), getSettings()]);
      if (!alive) return;
      setSources(srcs);
      setExpected(
        settings.check_policy.filter((p) => p.mode !== "off").map((p) => p.id),
      );
      const primary = srcs.find((s) => s.status === "connected") ?? srcs[0];
      if (primary) {
        const cat = await getCatalog(primary.id).catch(() => null);
        if (alive) setCatalog(cat);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setExpected]);

  // A question handed over from the command palette starts the loop.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    const q = params.get("q");
    if (q && !seeded.current) {
      seeded.current = true;
      void ask(q);
    }
  }, [params, ask]);

  const activeTurn = turns[turns.length - 1] ?? null;
  const focused = turns.find((t) => t.id === focusedTurnId) ?? activeTurn;

  // --- evidence panel tracks the focused turn ----------------------------
  React.useEffect(() => {
    if (!focused) {
      setSubject(null);
      return;
    }
    const state = turnState(focused);
    const { passed, total } = turnTally(focused);
    setSubject({
      id: focused.id,
      label: "this answer",
      title: focused.question,
      state: state ?? "checking",
      headline: focused.report?.headline,
      checks: focused.checks,
      passed,
      total,
      pendingChecks: focused.checks.length === 0 ? focused.expected : undefined,
      definitions: focused.interpretation?.definition_used?.name
        ? [
            {
              id: focused.interpretation.definition_used.id || "inferred",
              name: focused.interpretation.definition_used.name,
              inferred: !focused.interpretation.definition_used.id,
            },
          ]
        : undefined,
      coverage: focused.chart
        ? {
            included: focused.chart.coverage.included_rows,
            total:
              focused.chart.coverage.included_rows +
              focused.chart.coverage.excluded_rows,
            reason: focused.chart.coverage.reason || undefined,
          }
        : undefined,
      derivation: focused.checks.some((c) => c.detail?.sql_path_a)
        ? {
            paths: [
              ...(focused.checks.find((c) => c.detail?.sql_path_a)?.detail?.sql_path_a
                ? [
                    {
                      label: "Path A",
                      sql: focused.checks.find((c) => c.detail?.sql_path_a)!.detail!
                        .sql_path_a as string,
                    },
                  ]
                : []),
              ...(focused.checks.find((c) => c.detail?.sql_path_b)?.detail?.sql_path_b
                ? [
                    {
                      label: "Path B",
                      sql: focused.checks.find((c) => c.detail?.sql_path_b)!.detail!
                        .sql_path_b as string,
                    },
                  ]
                : []),
            ],
            rowCount: focused.result?.row_count,
            scannedRows: focused.result?.scanned_rows,
            elapsedMs: focused.elapsedMs,
            llmCalls: focused.cost?.llm_calls,
            usd: focused.cost?.usd,
          }
        : undefined,
    });
  }, [focused, setSubject]);

  // --- keyboard ----------------------------------------------------------
  useHotkeys(
    [
      { key: "/", run: () => composerRef.current?.focus() },
      {
        key: "r",
        run: () => {
          if (activeTurn) void ask(activeTurn.question, contextFromChips(activeTurn.chips));
        },
      },
      { key: "f", run: () => composerRef.current?.focus() },
      {
        key: "p",
        run: () => {
          void navigator.clipboard?.writeText(window.location.href);
          toast({ kind: "success", message: "Permalink copied" });
        },
      },
      {
        key: "s",
        run: () => {
          setEvidenceOpen(true);
          useUi.getState().setEvidenceTier(3);
        },
      },
      { key: "e", run: () => setEvidenceOpen(true) },
      {
        key: "c",
        run: () => {
          if (!activeTurn?.result) return;
          void navigator.clipboard?.writeText(slackText());
          toast({ kind: "success", message: "Answer copied for Slack" });
        },
      },
      { key: "i", run: () => router.push("/investigations") },
      { key: "d", run: () => router.push("/dashboards") },
    ],
    [activeTurn, ask, router, toast, setEvidenceOpen],
  );

  const slackText = () => {
    if (!activeTurn?.result) return "";
    const state = turnState(activeTurn);
    const { passed, total } = turnTally(activeTurn);
    return `*${activeTurn.result.value}*\n${activeTurn.question}\n${state} · ${passed} of ${total} checks\n${activeTurn.report?.headline ?? ""}`;
  };

  // Auto-scroll to the newest turn as it streams.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length]);

  const connected = sources?.some((s) => s.status === "connected") ?? false;
  const primarySource = sources?.find((s) => s.status === "connected") ?? sources?.[0];
  // A source exists but has not been introspected yet — the state a warehouse
  // sits in while it is being profiled at boot. Telling someone to "connect a
  // warehouse" when they have already connected one and it is still warming up
  // is the sort of thing that makes people re-connect it twice.
  const introspecting =
    !connected && (sources?.some((s) => s.status === "pending") ?? false);

  // Starters are generated from the connected schema, never hardcoded.
  const starters = React.useMemo(() => {
    if (!catalog) return [];
    const out: string[] = [];
    const withMeasure = catalog.tables.find((t) =>
      t.columns.some((c) => c.role === "measure"),
    );
    const measure = withMeasure?.columns.find((c) => c.role === "measure");
    const dateCol = withMeasure?.columns.find((c) => c.role === "date");
    if (withMeasure && measure && dateCol)
      out.push(`What was total ${humanize(measure.name)} last month?`);
    const entity = catalog.tables.slice().sort((a, b) => b.row_count - a.row_count)[0];
    if (entity) out.push(`How many ${humanize(entity.name)} do we have?`);
    const dim = catalog.tables
      .flatMap((t) => t.columns.filter((c) => c.role === "dimension"))
      .find((c) => c.distinct_count > 2 && c.distinct_count < 60);
    if (dim && measure)
      out.push(`Which ${humanize(dim.name)} has the most ${humanize(measure.name)}?`);
    return out.slice(0, 3);
  }, [catalog]);

  return (
    <>
      <SurfaceHeader
        scrollRef={scrollRef}
        crumbs={[
          { label: "Ask", href: "/ask" },
          { label: title || "New question" },
        ]}
        actions={
          turns.length > 0 ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (activeTurn)
                    void ask(activeTurn.question, contextFromChips(activeTurn.chips));
                }}
              >
                Re-run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(window.location.href);
                  toast({ kind: "success", message: "Permalink copied" });
                }}
              >
                Copy link
              </Button>
              <IconButton label="Branch this thread" size="sm" onClick={reset}>
                <GitBranch size={14} />
              </IconButton>
              <Button size="sm" variant="secondary" onClick={reset}>
                New question
              </Button>
            </>
          ) : null
        }
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col px-6">
          <div className="flex-1 py-6">
            {sources === null ? (
              <BootSkeleton />
            ) : introspecting ? (
              <EmptyState
                className="py-24"
                icon={<Database size={20} />}
                headline="Reading your schema"
                body={
                  <>
                    The connection is registered and the catalog is being
                    profiled. This takes a few seconds on a local file and longer
                    on a large warehouse.
                    <br />
                    Nothing is copied out of the warehouse.
                  </>
                }
                action={
                  <Button variant="ghost" onClick={() => router.push("/sources")}>
                    View sources
                  </Button>
                }
              />
            ) : !connected ? (
              <EmptyState
                className="py-24"
                icon={<Database size={20} />}
                headline="Connect a warehouse to get started"
                body={
                  <>
                    We introspect your schema automatically. There&apos;s no modeling
                    step — you can ask a question as soon as the connection is live.
                    <br />
                    Read-only credentials are enough.
                  </>
                }
                action={
                  <Button variant="primary" onClick={() => router.push("/sources")}>
                    Connect a source
                  </Button>
                }
              />
            ) : turns.length === 0 ? (
              <EmptyState
                className="py-24"
                icon={<Sparkles size={20} />}
                headline="Ask anything about your data"
                body={
                  <>
                    Connected to {primarySource?.name} · {primarySource?.table_count}{" "}
                    tables.
                    <br />
                    Nothing has been modeled yet. Ask a question and definitions will
                    accumulate as you go.
                  </>
                }
                action={
                  <div className="flex flex-col items-center gap-2">
                    {catalog === null
                      ? [0, 1, 2].map((i) => (
                          <Skeleton key={i} className="h-8 w-64" />
                        ))
                      : starters.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => void ask(s)}
                            className="h-8 rounded-md border border-border-default bg-surface-1 px-3 text-ui text-secondary transition-colors duration-100 hover:border-border-hover hover:text-primary"
                          >
                            {s}
                          </button>
                        ))}
                  </div>
                }
              />
            ) : (
              <div className="flex flex-col gap-8">
                {turns.map((turn, i) => {
                  const isActive = i === turns.length - 1;
                  const block = (
                    <AnswerBlock
                      turn={turn}
                      active={isActive}
                      onEditQuestion={(q) => void ask(q, contextFromChips(turn.chips))}
                      onEditChip={(id, v) => void editChip(turn.id, id, v)}
                      onRemoveChip={(id) => void removeChip(turn.id, id)}
                      onTogglePin={(id) => togglePin(turn.id, id)}
                      onOpenEvidence={() => {
                        setFocusedTurn(turn.id);
                        setEvidenceOpen(true);
                      }}
                      onFollowUp={(q) => void ask(q, contextFromChips(turn.chips))}
                      onUseCandidate={(cid) =>
                        void resolveCandidate(turn.id, cid, false)
                      }
                      onRatifyCandidate={(cid) => {
                        const cand = turn.ambiguity?.candidates.find(
                          (c) => c.id === cid,
                        );
                        setRatify({
                          open: true,
                          name: turn.ambiguity?.term || guessTerm(turn.question),
                          plainEnglish: cand?.description,
                          expression: cand?.sql,
                          candidateId: cid,
                          turnId: turn.id,
                        });
                      }}
                      onDefineYourself={() =>
                        setRatify({
                          open: true,
                          name: turn.ambiguity?.term || guessTerm(turn.question),
                          plainEnglish: "",
                          expression: "",
                          turnId: turn.id,
                        })
                      }
                      onInvestigate={() => router.push("/investigations")}
                      onRetry={() =>
                        void ask(turn.question, contextFromChips(turn.chips))
                      }
                      onVizChange={(v) => setViz(turn.id, v)}
                    />
                  );

                  if (isActive) return <div key={turn.id}>{block}</div>;

                  return (
                    <ScrollbackTurn
                      key={turn.id}
                      turn={turn}
                      expanded={expandedIds.has(turn.id)}
                      onFocus={() => setFocusedTurn(turn.id)}
                      onExpand={() =>
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(turn.id)) next.delete(turn.id);
                          else next.add(turn.id);
                          return next;
                        })
                      }
                    >
                      {block}
                    </ScrollbackTurn>
                  );
                })}
              </div>
            )}
          </div>

          {connected ? (
            <div className="sticky bottom-0">
              <AskComposer
                inputRef={composerRef}
                value={draft}
                onChange={setDraft}
                onSubmit={(q) =>
                  void ask(
                    q,
                    activeTurn ? contextFromChips(activeTurn.chips) : undefined,
                  )
                }
                onRecall={() => turns[turns.length - 1]?.question}
                placeholder={
                  turns.length === 0 ? "Ask anything about your data…" : "Ask a follow-up…"
                }
                sourceName={primarySource?.name}
                suggestions={turns.length === 0 ? starters : undefined}
                suggestionsLoading={turns.length === 0 && catalog === null}
              />
            </div>
          ) : null}
        </div>
      </div>

      <RatifySheet
        open={ratify.open}
        onClose={() => setRatify({ open: false })}
        name={ratify.name}
        plainEnglish={ratify.plainEnglish}
        expression={ratify.expression}
        sourceAnswerId={undefined}
        onRatified={(name, definitionId) => {
          setRatify({ open: false });
          toast({ kind: "success", message: `${name} ratified` });
          if (ratify.turnId && ratify.candidateId)
            void resolveCandidate(
              ratify.turnId,
              ratify.candidateId,
              true,
              name,
              undefined,
              definitionId,
            );
        }}
      />
    </>
  );
}

function BootSkeleton() {
  return (
    <div className="space-y-6 py-10">
      <Skeleton className="h-6 w-72" />
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-11 w-64" />
      <Skeleton className="h-[240px] w-full" />
    </div>
  );
}

function humanize(name: string): string {
  return name.replace(/_/g, " ").replace(/\bid\b/gi, "").trim();
}


function guessTerm(question: string): string {
  const m = /"([^"]+)"/.exec(question);
  if (m) return m[1];
  const words = question.replace(/[?.,]/g, "").split(/\s+/);
  const candidate = words.filter((w) => w.length > 4).pop();
  return candidate ? candidate[0].toUpperCase() + candidate.slice(1) : "Definition";
}
