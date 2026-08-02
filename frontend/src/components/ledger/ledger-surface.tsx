"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, MessageSquarePlus } from "lucide-react";
import type {
  Answer,
  AnswerQuery,
  AnswerSummary,
  Definition,
  User,
} from "@/lib/api/types";
import {
  ApiFailure,
  getAnswer,
  getAnswers,
  getDefinitions,
  getUsers,
  rerunAnswer,
} from "@/lib/api/client";
import { CONFIDENCE } from "@/lib/confidence";
import { formatCount } from "@/lib/format";
import { useHotkeys } from "@/lib/keyboard";
import { useEvidence, type EvidenceSubject } from "@/state/evidence";
import { useUi } from "@/state/ui";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { LedgerFilterBar } from "./filters";
import { LedgerTable } from "./ledger-table";
import { LedgerToolbar, type RerunProgress } from "./toolbar";
import { RowPreview } from "./row-preview";
import { DiffDialog } from "./diff-dialog";
import { ExportDialog } from "./export-dialog";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  SCOPE_LABEL,
  WINDOW_LABEL,
  applyFilters,
  activeFilterCount,
  groupAnswers,
  runEntries,
  savedSearchTerms,
  sortGroups,
  windowStart,
  type Filters,
  type LedgerGroup,
  type SortKey,
  type SortState,
} from "./model";

/* ---------------------------------------------------------------------------
   Evidence subjects — the right panel tracks the focused row. §0.4
--------------------------------------------------------------------------- */

function subjectFromSummary(group: LedgerGroup): EvidenceSubject {
  const lead = group.lead;
  return {
    id: lead.id,
    label: "Ledger row",
    title: lead.question,
    state: group.state,
    checks: [],
    passed: lead.passed,
    total: lead.total,
    definitions: lead.definition_used
      ? [
          {
            id: lead.definition_used.id,
            name: lead.definition_used.name,
            version: lead.definition_used.version,
          },
        ]
      : undefined,
  };
}

function subjectFromAnswer(group: LedgerGroup, full: Answer): EvidenceSubject {
  const coverage = full.chart?.coverage;
  const paths = [
    ...(full.sql ? [{ label: "Path A", sql: full.sql }] : []),
    ...(full.sql_path_b ? [{ label: "Path B", sql: full.sql_path_b }] : []),
  ];
  return {
    id: full.id,
    label: "Ledger row",
    title: full.question,
    state: group.state,
    headline: full.report?.headline,
    checks: full.report?.checks ?? [],
    passed: full.report?.passed,
    total: full.report?.total,
    definitions: full.definition_used
      ? [
          {
            id: full.definition_used.id,
            name: full.definition_used.name,
            version: full.definition_used.version,
          },
        ]
      : undefined,
    coverage: coverage
      ? {
          included: coverage.included_rows,
          total: coverage.included_rows + coverage.excluded_rows,
          reason: coverage.reason || undefined,
        }
      : undefined,
    derivation: paths.length
      ? {
          paths,
          rowCount: full.row_count,
          scannedRows: full.scanned_rows,
          elapsedMs: full.cost?.elapsed_ms,
          llmCalls: full.cost?.llm_calls,
          usd: full.cost?.usd,
        }
      : undefined,
  };
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/* ---------------------------------------------------------------------------
   The surface
--------------------------------------------------------------------------- */

export function LedgerSurface() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const setSubject = useEvidence((s) => s.setSubject);

  const [rows, setRows] = React.useState<AnswerSummary[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [definitions, setDefinitions] = React.useState<Definition[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const urlDefinition = searchParams.get("definition_id");
  const [filters, setFilters] = React.useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    definitionId: urlDefinition,
  }));
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [focusedKey, setFocusedKey] = React.useState<string | null>(null);

  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [diffKey, setDiffKey] = React.useState<string | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);

  const [overrides, setOverrides] = React.useState<
    ReadonlyMap<string, number | null>
  >(new Map());
  const [running, setRunning] = React.useState<ReadonlySet<string>>(new Set());
  const [flashing, setFlashing] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [errors, setErrors] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [failed, setFailed] = React.useState<string[]>([]);
  const [progress, setProgress] = React.useState<RerunProgress>({
    running: false,
    done: 0,
    total: 0,
  });
  const busyRef = React.useRef(false);

  /* -------------------------------------------------------------- answers */

  const query: AnswerQuery = React.useMemo(() => {
    const start = windowStart(filters.window);
    return {
      confidence: filters.confidence ?? undefined,
      created_by: filters.who ?? undefined,
      definition_id: filters.definitionId ?? undefined,
      from: start !== null ? new Date(start).toISOString() : undefined,
    };
  }, [filters.confidence, filters.who, filters.definitionId, filters.window]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const answers = await getAnswers(query);
      setRows(answers);
    } catch (err) {
      setLoadError(
        err instanceof ApiFailure
          ? err.message
          : "The ledger could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [u, d] = await Promise.all([
        getUsers().catch(() => [] as User[]),
        getDefinitions().catch(() => [] as Definition[]),
      ]);
      if (!alive) return;
      setUsers(u);
      setDefinitions(d);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** The Definitions surface links here with `?definition_id=`. */
  React.useEffect(() => {
    setFilters((f) =>
      f.definitionId === urlDefinition
        ? f
        : { ...f, definitionId: urlDefinition },
    );
  }, [urlDefinition]);

  const nameOf = React.useCallback(
    (id: string) => users.find((u) => u.id === id)?.name ?? "Unknown",
    [users],
  );
  const initialsOf = React.useCallback(
    (id: string) => users.find((u) => u.id === id)?.initials ?? "··",
    [users],
  );

  /* ------------------------------------------------------------- grouping */

  const displayRows = React.useMemo(
    () =>
      rows.map((r) =>
        overrides.has(r.id) ? { ...r, value: overrides.get(r.id) ?? null } : r,
      ),
    [rows, overrides],
  );

  const filteredRows = React.useMemo(
    () => applyFilters(displayRows, filters),
    [displayRows, filters],
  );

  const groups = React.useMemo(
    () => sortGroups(groupAnswers(filteredRows), sort),
    [filteredRows, sort],
  );

  const total = rows.length;
  const savedSearches = React.useMemo(() => savedSearchTerms(rows), [rows]);
  const groupByKey = React.useCallback(
    (key: string | null) =>
      key ? (groups.find((g) => g.key === key) ?? null) : null,
    [groups],
  );

  /* ---------------------------------------------------------- answer cache */

  const cacheRef = React.useRef(new Map<string, Answer>());
  const [, bumpCache] = React.useReducer((n: number) => n + 1, 0);
  const focusRef = React.useRef<string | null>(null);

  const ensureAnswer = React.useCallback(
    async (id: string): Promise<Answer | null> => {
      const hit = cacheRef.current.get(id);
      if (hit) return hit;
      try {
        const full = await getAnswer(id);
        cacheRef.current.set(id, full);
        bumpCache();
        return full;
      } catch {
        return null;
      }
    },
    [],
  );

  const onFocusRow = React.useCallback(
    (group: LedgerGroup) => {
      setFocusedKey(group.key);
      focusRef.current = group.lead.id;
      setSubject(subjectFromSummary(group));
      void ensureAnswer(group.lead.id).then((full) => {
        if (!full || focusRef.current !== group.lead.id) return;
        setSubject(subjectFromAnswer(group, full));
      });
    },
    [ensureAnswer, setSubject],
  );

  /* ------------------------------------------------------------- selection */

  const toggleSelect = React.useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = React.useCallback(() => {
    setSelected(new Set(groups.map((g) => g.key)));
  }, [groups]);

  const clearSelection = React.useCallback(() => setSelected(new Set()), []);

  const selectedGroups = React.useMemo(
    () => groups.filter((g) => selected.has(g.key)),
    [groups, selected],
  );

  /* -------------------------------------------------------------- re-runs */

  const rerun = React.useCallback(async (targets: AnswerSummary[]) => {
    if (targets.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setProgress({ running: true, done: 0, total: targets.length });
    const nowFailed: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      setRunning(new Set([target.id]));
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(target.id);
        return next;
      });
      try {
        if (target.confidence === "refused") {
          throw new ApiFailure(
            "refused",
            "A refused answer must be resolved before it can be re-run.",
            409,
          );
        }
        const res = await rerunAnswer(target.id);
        await sleep(160);
        if (res.diff.current !== res.diff.previous) {
          setOverrides((prev) =>
            new Map(prev).set(target.id, res.diff.current),
          );
          setFlashing((prev) => new Set(prev).add(target.id));
          window.setTimeout(() => {
            setFlashing((prev) => {
              const next = new Set(prev);
              next.delete(target.id);
              return next;
            });
          }, 800);
        }
      } catch (err) {
        nowFailed.push(target.id);
        setErrors((prev) =>
          new Map(prev).set(
            target.id,
            err instanceof ApiFailure
              ? err.message
              : "This answer could not be re-run.",
          ),
        );
      }
      setProgress((p) => ({ ...p, done: i + 1 }));
    }

    setRunning(new Set());
    setProgress({ running: false, done: 0, total: 0 });
    setFailed(nowFailed);
    busyRef.current = false;
  }, []);

  const rerunSelected = React.useCallback(() => {
    void rerun(selectedGroups.map((g) => g.lead));
  }, [rerun, selectedGroups]);

  const rerunFailed = React.useCallback(() => {
    const targets = rows.filter((r) => failed.includes(r.id));
    setFailed([]);
    void rerun(targets);
  }, [failed, rerun, rows]);

  /* --------------------------------------------------------- row commands */

  const openAnswer = React.useCallback(
    (group: LedgerGroup) => router.push(`/a/${group.lead.id}`),
    [router],
  );

  const openPreview = React.useCallback(
    (group: LedgerGroup) => {
      setPreviewKey(group.key);
      if (!cacheRef.current.has(group.lead.id)) {
        setPreviewLoading(true);
        void ensureAnswer(group.lead.id).finally(() =>
          setPreviewLoading(false),
        );
      }
    },
    [ensureAnswer],
  );

  const openDiff = React.useCallback(
    (group: LedgerGroup) => {
      setDiffKey(group.key);
      setDiffError(null);
      if (cacheRef.current.has(group.lead.id)) return;
      setDiffLoading(true);
      void ensureAnswer(group.lead.id)
        .then((full) => {
          if (!full) {
            setDiffError(
              "The recorded runs for this answer could not be loaded. The divergence stands until they can be compared.",
            );
          }
        })
        .finally(() => setDiffLoading(false));
    },
    [ensureAnswer],
  );

  const toggleExpand = React.useCallback(
    (group: LedgerGroup) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(group.key)) next.delete(group.key);
        else {
          next.add(group.key);
          for (const m of group.members) void ensureAnswer(m.id);
        }
        return next;
      });
    },
    [ensureAnswer],
  );

  const onSortChange = React.useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "question" ? "asc" : "desc" },
    );
  }, []);

  const patchFilters = React.useCallback(
    (next: Partial<Filters>) => {
      setFilters((f) => ({ ...f, ...next }));
      if ("definitionId" in next) {
        const params = new URLSearchParams(searchParams.toString());
        if (next.definitionId) params.set("definition_id", next.definitionId);
        else params.delete("definition_id");
        const qs = params.toString();
        router.replace(qs ? `/ledger?${qs}` : "/ledger", { scroll: false });
      }
    },
    [router, searchParams],
  );

  const clearFilters = React.useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    router.replace("/ledger", { scroll: false });
  }, [router]);

  useHotkeys(
    [
      {
        key: "/",
        run: () => {
          searchRef.current?.focus();
          searchRef.current?.select();
        },
      },
    ],
    [],
  );

  /* ---------------------------------------------------------------- render */

  const previewGroup = groupByKey(previewKey);
  const diffGroup = groupByKey(diffKey);
  const filtersActive = activeFilterCount(filters) > 0;

  const scopeLabel = [
    SCOPE_LABEL[filters.scope],
    WINDOW_LABEL[filters.window],
    filters.who ? nameOf(filters.who) : null,
    filters.confidence ? CONFIDENCE[filters.confidence].label : null,
    filters.definitionId
      ? (definitions.find((d) => d.id === filters.definitionId)?.name ??
        filters.definitionId)
      : null,
    filters.query.trim() ? `matching "${filters.query.trim()}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const empty =
    rows.length === 0 && !filtersActive ? (
      <EmptyState
        icon={<Layers size={22} />}
        headline="No answers yet"
        body="Ask your first question and it will be recorded here — with the checks that stood behind it, permanently."
        action={
          <Button
            size="sm"
            variant="primary"
            onClick={() => router.push("/ask")}
          >
            <MessageSquarePlus size={13} aria-hidden="true" />
            Ask a question
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<Layers size={22} />}
        headline="No answers match these filters"
        body={`The ledger holds ${formatCount(total)} recorded answers. Widen the period or clear the filters to see them.`}
        action={
          <Button size="sm" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    );

  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Ledger" }]}
        scrollRef={scrollRef}
        actions={
          <LedgerToolbar
            query={filters.query}
            onQueryChange={(v) => setFilters((f) => ({ ...f, query: v }))}
            savedSearches={savedSearches}
            searchRef={searchRef}
            selectedCount={selected.size}
            onRerun={rerunSelected}
            progress={progress}
            onExport={() => setExportOpen(true)}
            density={density}
            onToggleDensity={() =>
              setDensity(density === "compact" ? "comfortable" : "compact")
            }
            onClearFilters={clearFilters}
            canClearFilters={filtersActive}
            onShortcuts={() => setShortcutsOpen(true)}
          />
        }
      />

      <SurfaceBody scrollRef={scrollRef} wide>
        {loadError ? (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-contested-border bg-contested-bg px-3 py-2.5">
            <p className="flex-1 text-ui text-contested">{loadError}</p>
            <Button size="xs" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}

        {failed.length > 0 ? (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-contested-border bg-contested-bg px-3 py-2.5">
            <p className="flex-1 text-ui text-contested">
              {formatCount(failed.length)} answer
              {failed.length === 1 ? "" : "s"} could not be re-run. The recorded
              values are unchanged.
            </p>
            <Button size="xs" variant="secondary" onClick={rerunFailed}>
              Retry
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setFailed([])}>
              Dismiss
            </Button>
          </div>
        ) : null}

        <LedgerFilterBar
          className="mb-3"
          filters={filters}
          onChange={patchFilters}
          users={users}
          definitions={definitions}
          shown={filteredRows.length}
          total={total}
        />

        <LedgerTable
          groups={groups}
          loading={loading}
          density={density}
          sort={sort}
          onSortChange={onSortChange}
          selected={selected}
          onToggleSelect={toggleSelect}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          runsFor={(g) => runEntries(g, cacheRef.current)}
          focusedKey={focusedKey}
          onFocusRow={onFocusRow}
          onOpen={openAnswer}
          onPreview={openPreview}
          onRerun={(g) => void rerun([g.lead])}
          onOpenDiff={openDiff}
          running={running}
          flashing={flashing}
          errors={errors}
          initialsOf={initialsOf}
          nameOf={nameOf}
          empty={empty}
        />

        {!loading && groups.length > 0 ? (
          <p className="mt-3 text-ui-sm text-tertiary">
            {formatCount(groups.length)} row
            {groups.length === 1 ? "" : "s"} ·{" "}
            {formatCount(filteredRows.length)} answer
            {filteredRows.length === 1 ? "" : "s"} after semantic dedupe
          </p>
        ) : null}
      </SurfaceBody>

      {previewGroup ? (
        <RowPreview
          group={previewGroup}
          answer={cacheRef.current.get(previewGroup.lead.id) ?? null}
          loading={previewLoading}
          onClose={() => setPreviewKey(null)}
          onOpen={(g) => {
            setPreviewKey(null);
            openAnswer(g);
          }}
          onRerun={(g) => {
            setPreviewKey(null);
            void rerun([g.lead]);
          }}
          nameOf={nameOf}
        />
      ) : null}

      {diffGroup ? (
        <DiffDialog
          group={diffGroup}
          answer={cacheRef.current.get(diffGroup.lead.id) ?? null}
          loading={diffLoading}
          error={diffError}
          onRetry={() => openDiff(diffGroup)}
          onClose={() => setDiffKey(null)}
          onOpen={(g) => {
            setDiffKey(null);
            openAnswer(g);
          }}
        />
      ) : null}

      {exportOpen ? (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          filtered={filteredRows}
          selected={selectedGroups.map((g) => g.lead)}
          scopeLabel={scopeLabel}
          nameOf={nameOf}
          onDone={(filename, count) =>
            toast({
              kind: "success",
              message: `Exported ${formatCount(count)} answers with their checks to ${filename}`,
            })
          }
        />
      ) : null}
    </>
  );
}
