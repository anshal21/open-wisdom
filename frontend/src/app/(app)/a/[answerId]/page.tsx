"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy, MoreHorizontal, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getAnswer,
  getPermalink,
  rerunAnswer,
  ApiFailure,
  flagAnswer,
} from "@/lib/api/client";
import type { Answer, RerunDiff } from "@/lib/api/types";
import { CONFIDENCE, figureAriaLabel, sortChecks } from "@/lib/confidence";
import { formatAbsolute, formatDuration, formatValue, isoTitle, formatRange, formatCount } from "@/lib/format";
import { nameOf, initialsOf } from "@/lib/api/mock/base";
import { useEvidence } from "@/state/evidence";
import { useUi } from "@/state/ui";
import { useToast } from "@/components/ui/toast";
import { Button, IconButton } from "@/components/ui/button";
import {
  Avatar,
  Disclosure,
  EmptyState,
  SectionLabel,
  Skeleton,
} from "@/components/ui/primitives";
import { Dialog, MenuItem, Popover } from "@/components/ui/overlays";
import { Textarea, Input } from "@/components/ui/primitives";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { CheckRow } from "@/components/evidence/check-row";
import { Viz } from "@/components/viz/viz";
import type { VizOverride } from "@/lib/viz/resolve";
import { RefusalFork } from "@/components/ask/refusal-fork";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";

export default function AnswerDetailPage() {
  const { answerId } = useParams<{ answerId: string }>();
  // Keyed so a different permalink remounts with fresh state rather than
  // clearing the previous answer from inside an effect.
  return <AnswerDetail key={answerId} answerId={answerId} />;
}

function AnswerDetail({ answerId }: { answerId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLButtonElement>(null);

  const [answer, setAnswer] = React.useState<Answer | null>(null);
  // Chart override is view-state only: a permalink is shared truth and any
  // viewer reshaping it must not reshape it for the next viewer. (D2)
  const [viz, setVizState] = React.useState<VizOverride | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [rerunning, setRerunning] = React.useState(false);
  const [diff, setDiff] = React.useState<RerunDiff | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [correcting, setCorrecting] = React.useState(false);
  const [changedOpen, setChangedOpen] = React.useState(false);

  const setSubject = useEvidence((s) => s.setSubject);
  const { setEvidenceOpen } = useUi();

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const a = await getAnswer(answerId);
        if (alive) setAnswer(a);
      } catch (e) {
        if (alive)
          setError(
            e instanceof ApiFailure ? e.message : "This answer could not be loaded.",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [answerId]);

  // A permalink recipient sees the claim first — the panel stays collapsed.
  React.useEffect(() => {
    setEvidenceOpen(false);
  }, [setEvidenceOpen]);

  React.useEffect(() => {
    if (!answer) return;
    setSubject({
      id: answer.id,
      label: "this answer",
      title: answer.question,
      state: answer.supersession
        ? "superseded"
        : (answer.report?.confidence ?? "refused"),
      headline: answer.report?.headline,
      checks: answer.report?.checks ?? [],
      passed: answer.report?.passed,
      total: answer.report?.total,
      definitions: answer.definition_used
        ? [
            {
              id: answer.definition_used.id,
              name: answer.definition_used.name,
              version: answer.definition_used.version,
            },
          ]
        : undefined,
      coverage: answer.chart
        ? {
            included: answer.chart.coverage.included_rows,
            total:
              answer.chart.coverage.included_rows + answer.chart.coverage.excluded_rows,
            reason: answer.chart.coverage.reason || undefined,
          }
        : undefined,
      derivation: {
        paths: [
          ...(answer.sql ? [{ label: "Path A", sql: answer.sql }] : []),
          ...(answer.sql_path_b ? [{ label: "Path B", sql: answer.sql_path_b }] : []),
        ],
        rowCount: answer.row_count,
        scannedRows: answer.scanned_rows,
        elapsedMs: answer.cost?.elapsed_ms,
        llmCalls: answer.cost?.llm_calls,
        usd: answer.cost?.usd,
      },
    });
  }, [answer, setSubject]);

  /**
   * Record a human correction. This used to toast "Correction recorded. It
   * will appear as a precedent finding on future answers" and call nothing at
   * all — the single most dishonest thing in the product. It now writes a flag
   * and re-reads the answer so the correction is visible on the page, which is
   * what makes the claim checkable.
   */
  const recordCorrection = async (reason: string) => {
    if (!answer) return;
    try {
      await flagAnswer(answer.id, reason);
      const fresh = await getAnswer(answer.id);
      setAnswer(fresh);
      setCorrecting(false);
      toast({ kind: "success", message: "Correction recorded against this answer." });
    } catch (e: unknown) {
      toast({
        kind: "error",
        message:
          e instanceof ApiFailure
            ? e.message
            : "The correction could not be recorded. Nothing was saved.",
      });
    }
  };

  const rerun = async () => {
    if (!answer) return;
    setRerunning(true);
    try {
      const res = await rerunAnswer(answer.id);
      setDiff(res.diff);
      toast({ kind: "success", message: "Answer re-run" });
    } finally {
      setRerunning(false);
    }
  };

  if (error) {
    return (
      <>
        <SurfaceHeader crumbs={[{ label: "Ledger", href: "/ledger" }, { label: "Answer" }]} />
        <SurfaceBody>
          <EmptyState
            icon={<ConfidenceGlyph state="unverified" size={20} />}
            headline="This answer was deleted"
            body={error}
            action={
              <Button variant="primary" onClick={() => router.push("/ledger")}>
                Back to the ledger
              </Button>
            }
          />
        </SurfaceBody>
      </>
    );
  }

  if (!answer) {
    return (
      <>
        <SurfaceHeader crumbs={[{ label: "Ledger", href: "/ledger" }, { label: "Answer" }]} />
        <SurfaceBody scrollRef={scrollRef}>
          <div className="space-y-6">
            <Skeleton className="h-6 w-[52ch]" />
            <Skeleton className="h-4 w-64" />
            <div className="flex items-end gap-4">
              <Skeleton className="h-11 w-64" />
              <Skeleton className="mb-2 h-[26px] w-40" />
            </div>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-[280px] w-full" />
            <Skeleton className="h-4 w-full max-w-[62ch]" />
            <Skeleton className="h-4 w-full max-w-[50ch]" />
          </div>
        </SurfaceBody>
      </>
    );
  }

  // A refused answer carries no report — the refusal itself is its state.
  // `report` is the branch point for the whole page: everything that presents
  // a verified figure (hero, seal, chart, checks) exists only inside it.
  const report = answer.report;
  const state = answer.supersession
    ? "superseded"
    : (report?.confidence ?? "refused");
  const meta = CONFIDENCE[state];
  const formatHint = answer.format_hint;

  return (
    <>
      <SurfaceHeader
        scrollRef={scrollRef}
        crumbs={[{ label: "Ledger", href: "/ledger" }, { label: answer.question }]}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => router.push("/ledger")}>
              <ArrowLeft size={13} />
              Ledger
            </Button>
            <Button size="sm" variant="ghost" loading={rerunning} onClick={rerun}>
              {rerunning ? null : <RefreshCw size={13} />}
              Re-run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const { url } = await getPermalink(answer.id);
                void navigator.clipboard?.writeText(url);
                toast({ kind: "success", message: "Permalink copied" });
              }}
            >
              <Copy size={13} />
              Copy
            </Button>
            <IconButton
              ref={menuRef}
              label="More actions"
              size="sm"
              onClick={() => setMenuOpen(true)}
            >
              <MoreHorizontal size={15} />
            </IconButton>
            <Popover
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              anchorRef={menuRef}
              align="end"
              width={200}
            >
              <MenuItem
                onSelect={() => {
                  setMenuOpen(false);
                  setEvidenceOpen(true);
                }}
              >
                Open evidence panel
              </MenuItem>
              <MenuItem onSelect={() => router.push("/share")}>Share to Slack</MenuItem>
              <MenuItem onSelect={() => router.push("/dashboards")}>
                Add to a dashboard
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setMenuOpen(false);
                  setCorrecting(true);
                }}
              >
                This is wrong
              </MenuItem>
            </Popover>
          </>
        }
      />

      <SurfaceBody scrollRef={scrollRef}>
        {/* Superseded banner. The original figure is NOT struck through — it was
            correct under the old definition. */}
        {answer.supersession ? (
          <div className="mb-6 rounded-md border border-unverified-border bg-unverified-bg px-3.5 py-3" style={{ borderStyle: "dotted" }}>
            <p className="flex items-start gap-2 text-subtitle text-primary">
              <ConfidenceGlyph state="superseded" size={16} />
              A definition this answer used has changed since it was recorded.
            </p>
            <p className="mt-1 pl-6 text-ui text-secondary">
              {answer.supersession.definition_name} v{answer.supersession.from_version} →
              v{answer.supersession.to_version} on{" "}
              <time
                dateTime={answer.supersession.changed_at}
                title={isoTitle(answer.supersession.changed_at)}
              >
                {formatAbsolute(answer.supersession.changed_at, false)}
              </time>
              .
            </p>
            <div className="mt-3 flex items-center gap-2 pl-6">
              <Button size="sm" variant="primary" loading={rerunning} onClick={rerun}>
                Re-run
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  router.push(`/definitions/${answer.supersession?.definition_id}`)
                }
              >
                View diff
              </Button>
            </div>
          </div>
        ) : null}

        {diff && diff.previous !== diff.current ? (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-qualified-border bg-qualified-bg px-3.5 py-2.5">
            <p className="text-subtitle tabular text-primary">
              {formatValue(diff.previous, formatHint, { unit: answer.unit })} →{" "}
              {formatValue(diff.current, formatHint, { unit: answer.unit })}
              {diff.delta_pct !== null ? (
                <span className="ml-2 font-normal text-qualified">
                  ({diff.delta_pct > 0 ? "+" : ""}
                  {diff.delta_pct.toFixed(1)}% vs the recorded run)
                </span>
              ) : null}
            </p>
            <button
              type="button"
              aria-expanded={changedOpen}
              className="text-ui font-medium text-accent hover:underline"
              onClick={() => setChangedOpen((v) => !v)}
            >
              {changedOpen ? "Hide" : "What changed?"}
            </button>
            {changedOpen ? (
              <p className="w-full text-ui-sm text-secondary">
                {diff.checks_changed.length > 0
                  ? `Checks that changed status: ${diff.checks_changed.join(", ")}.`
                  : "The figure moved; no check changed status between the runs."}
              </p>
            ) : null}
          </div>
        ) : null}

        <h1 className="text-title-lg text-primary">{answer.question}</h1>
        <p className="mt-1.5 flex items-center gap-1.5 text-ui-sm text-tertiary">
          <Avatar initials={initialsOf(answer.created_by)} />
          Asked by {nameOf(answer.created_by)} ·{" "}
          <time dateTime={answer.created_at} title={isoTitle(answer.created_at)}>
            {formatAbsolute(answer.created_at)}
          </time>
        </p>

        {answer.ambiguity ? (
          <RefusalFork
            className="mt-8"
            ambiguity={answer.ambiguity}
            unit={answer.ambiguity.unit ?? answer.unit}
            formatHint={answer.ambiguity.format_hint ?? formatHint}
            onUseOnce={() => router.push("/ask")}
            onUseAndRatify={() => router.push("/ask")}
            onDefineYourself={() => router.push("/definitions")}
          />
        ) : report ? (
          <>
            <div className="mt-7 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p
                className={cn(
                  "text-hero text-primary",
                  answer.supersession && "decoration-dotted underline underline-offset-8",
                )}
                aria-label={figureAriaLabel(
                  formatValue(answer.value, formatHint, { unit: answer.unit }),
                  state,
                  report.headline,
                )}
              >
                {formatValue(answer.value, formatHint, { unit: answer.unit })}
              </p>
              <span className="mb-2">
                <ConfidenceSeal
                  state={state}
                  size="standard"
                  passed={report.passed}
                  total={report.total}
                  onOpenEvidence={() => setEvidenceOpen(true)}
                />
              </span>
            </div>
            {answer.restated ? (
              <p className="mt-1.5 text-body text-secondary">{answer.restated}</p>
            ) : null}

            {meta.banner && report.headline ? (
              <ConfidenceSeal
                className="mt-5"
                state={state}
                size="banner"
                headline={report.headline}
                passed={report.passed}
                total={report.total}
                onOpenEvidence={() => setEvidenceOpen(true)}
              />
            ) : null}

            {answer.chart && answer.chart.x ? (
              <Viz
                className="mt-6"
                hint={answer.chart}
                override={viz}
                onOverride={setVizState}
                columns={answer.columns}
                rows={answer.rows}
                confidenceState={state}
                checks={report.checks}
                passed={report.passed}
                total={report.total}
                caveat={report.headline}
                unit={answer.unit}
                formatHint={formatHint}
                title={answer.chart.y[0]?.label}
                onRerun={rerun}
              />
            ) : null}

            {answer.narrative ? (
              <p className="mt-6 text-body text-secondary prose-measure">
                {answer.narrative}
              </p>
            ) : null}
          </>
        ) : (
          /* Refused with no fork to offer: no figure, no seal, no checks — the
             refusal and its reasoning ARE the answer. */
          <div className="mt-8 rounded-md border border-border-default bg-surface-1 px-4 py-4">
            <p className="flex items-start gap-2 text-subtitle text-primary">
              <ConfidenceGlyph state="refused" size={16} />
              This question was refused — no figure was produced.
            </p>
            {answer.narrative ? (
              <p className="mt-1.5 pl-6 text-body text-secondary prose-measure">
                {answer.narrative}
              </p>
            ) : null}
          </div>
        )}

        {/* CONTEXT */}
        <section className="mt-10 border-t border-border-subtle pt-4">
          <SectionLabel>Context</SectionLabel>
          <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-ui">
            {answer.definition_used ? (
              <>
                <dt className="text-tertiary">Metric</dt>
                <dd className="text-secondary">
                  {answer.definition_used.name}{" "}
                  <span className="text-tertiary">
                    v{answer.definition_used.version}
                  </span>
                </dd>
              </>
            ) : null}
            {answer.context?.filters?.length ? (
              <>
                <dt className="text-tertiary">Filters</dt>
                <dd className="text-secondary">
                  {answer.context?.filters
                    .map(
                      (f) =>
                        `${f.column} ${f.operator} ${Array.isArray(f.value) ? f.value.join(", ") : f.value}`,
                    )
                    .join(" · ")}
                </dd>
              </>
            ) : null}
            {answer.context?.grain ? (
              <>
                <dt className="text-tertiary">Grain</dt>
                <dd className="text-secondary">{answer.context?.grain}</dd>
              </>
            ) : null}
            {answer.context?.time_range ? (
              <>
                <dt className="text-tertiary">Range</dt>
                <dd className="text-secondary">
                  {formatRange(
                    answer.context?.time_range.from,
                    answer.context?.time_range.to,
                  )}
                </dd>
              </>
            ) : null}
            <dt className="text-tertiary">Rows</dt>
            <dd className="text-secondary tabular">
              {answer.scanned_rows
                ? `${formatCount(answer.scanned_rows)} scanned → ${formatCount(answer.row_count)} returned`
                : formatCount(answer.row_count)}
            </dd>
          </dl>
        </section>

        {/* CHECKS — inline and expanded here, not behind a panel toggle.
            A refused answer ran no checks; the section does not exist for it. */}
        {report ? (
          <section className="mt-8 border-t border-border-subtle pt-4">
            <SectionLabel count={report.checks.length}>Checks</SectionLabel>
            <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface-1">
              {sortChecks(report.checks).map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </div>
          </section>
        ) : null}

        {/* CORRECTIONS — a human said this answer was wrong. Never deleted:
            an answer once contested by a person says so forever. */}
        {answer.flags && answer.flags.length > 0 ? (
          <section className="mt-8 border-t border-border-subtle pt-4">
            <SectionLabel count={answer.flags.length}>Corrections</SectionLabel>
            <ul className="mt-2 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default bg-surface-1">
              {answer.flags.map((f) => (
                <li key={f.id} className="px-3 py-2.5">
                  <p className="text-ui text-primary">{f.reason}</p>
                  <p className="mt-1 text-ui-sm text-tertiary">
                    {f.created_by ? `${nameOf(f.created_by)} · ` : ""}
                    <time dateTime={f.created_at} title={isoTitle(f.created_at)}>
                      {formatAbsolute(f.created_at)}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* DERIVATION */}
        {answer.sql ? (
          <section className="mt-8 border-t border-border-subtle pt-4">
            <SectionLabel>Derivation</SectionLabel>
            <Disclosure
              className="mt-2"
              summary={<span className="text-ui-sm">SQL, timings and model</span>}
              contentClassName="mt-2 space-y-3"
            >
              <SqlViewer
                paths={[
                  { label: "Path A", sql: answer.sql },
                  ...(answer.sql_path_b
                    ? [{ label: "Path B", sql: answer.sql_path_b }]
                    : []),
                ]}
                rowCount={answer.row_count}
                elapsedMs={answer.cost?.elapsed_ms}
                maxHeight={320}
              />
              {answer.cost ? (
                <dl className="grid max-w-sm grid-cols-2 gap-x-4 gap-y-1.5 text-ui-sm">
                  <dt className="text-tertiary">Model calls</dt>
                  <dd className="text-right tabular text-secondary">
                    {answer.cost.llm_calls}
                  </dd>
                  <dt className="text-tertiary">Cost</dt>
                  <dd className="text-right tabular text-secondary">
                    ${answer.cost.usd.toFixed(2)}
                  </dd>
                  <dt className="text-tertiary">Elapsed</dt>
                  <dd className="text-right tabular text-secondary">
                    {formatDuration(answer.cost.elapsed_ms)}
                  </dd>
                </dl>
              ) : null}
            </Disclosure>
          </section>
        ) : null}

        {/* HISTORY */}
        {answer.runs && answer.runs.length > 0 ? (
          <section className="mt-8 border-t border-border-subtle pt-4">
            <SectionLabel>History</SectionLabel>
            <ul className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface-1">
              {answer.runs.map((r) => (
                <li
                  key={r.id}
                  className="flex h-9 items-center gap-3 border-b border-border-subtle px-3 last:border-0"
                >
                  <span className="w-12 shrink-0 text-ui-sm text-tertiary">
                    Run {r.run}
                  </span>
                  <time
                    dateTime={r.created_at}
                    title={isoTitle(r.created_at)}
                    className="w-28 shrink-0 text-ui-sm text-tertiary tabular"
                  >
                    {formatAbsolute(r.created_at, false)}
                  </time>
                  <span className="w-28 shrink-0 text-ui tabular text-primary">
                    {formatValue(r.value, formatHint, { unit: answer.unit })}
                  </span>
                  <ConfidenceSeal state={r.confidence} size="inline" />
                  <span className="flex-1" />
                  {r.current ? (
                    <span className="text-ui-sm text-tertiary">current</span>
                  ) : r.id === answer.id ? (
                    <span className="text-ui-sm text-tertiary">viewing</span>
                  ) : (
                    // Each run is itself an answer with a permalink, so the
                    // honest affordance is navigation to that record — not a
                    // "diff" button for a view that does not exist.
                    <Link
                      href={`/a/${r.id}`}
                      className="text-ui-sm font-medium text-accent hover:underline"
                    >
                      Open
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="h-10" />
      </SurfaceBody>

      <CorrectionDialog
        open={correcting}
        onClose={() => setCorrecting(false)}
        onSubmit={recordCorrection}
      />
    </>
  );
}

function CorrectionDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  const [why, setWhy] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="What should this have been?"
      description="Corrections attach to the answer and become a precedent finding for future ones."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!why.trim() || busy}
            onClick={async () => {
              setBusy(true);
              // The corrected value is part of the correction's text: the
              // server stores one reason string, so folding it in keeps the
              // whole correction on the record rather than dropping half of it.
              const reason = value.trim()
                ? `Should have been ${value.trim()}. ${why.trim()}`
                : why.trim();
              try {
                await onSubmit(reason);
              } finally {
                setBusy(false);
              }
            }}
          >
            Record correction
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-ui font-medium text-secondary">
            The correct value
          </label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-ui font-medium text-secondary">
            Why the recorded answer was wrong
          </label>
          <Textarea
            rows={3}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="If this names an ambiguity, a definition proposal is created."
          />
        </div>
      </div>
    </Dialog>
  );
}
