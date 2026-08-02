"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import type { Investigation, User } from "@/lib/api/types";
import {
  ApiFailure,
  getInvestigation,
  getUsers,
  rerunInvestigation,
} from "@/lib/api/client";
import { useHotkeys, usePrefersReducedMotion } from "@/lib/keyboard";
import { useEvidence } from "@/state/evidence";
import { useUi } from "@/state/ui";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { ConclusionBlock } from "./conclusion-block";
import { DriverDecomposition, DriverSkeleton } from "./driver-decomposition";
import { LadderSkeleton, RuleoutLadder } from "./ruleout-ladder";
import { NarrativeBlock, NarrativeSkeleton, buildShareText } from "./narrative-block";
import { StateSwitcher, type DemoState } from "./state-switcher";
import { itemsInPhase } from "./model";

const OVERRULE_LABEL = "Run after the metric was shown not to have moved.";
const REVEAL_MS = 110;

function ConclusionSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex items-start gap-2.5">
        <Skeleton className="mt-1 h-5 w-5 rounded-full" />
        <Skeleton className="h-6 w-full max-w-[340px]" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3.5 w-full max-w-[600px]" />
        <Skeleton className="h-3.5 w-full max-w-[560px]" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-md border border-border-default bg-surface-1 px-3 py-2.5"
          >
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-2 h-6 w-32" />
            <Skeleton className="mt-1.5 h-2.5 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    </div>
  );
}

export function InvestigationDetail({ id }: { id: string }) {
  const { toast } = useToast();
  const setSubject = useEvidence((s) => s.setSubject);
  const setEvidenceOpen = useUi((s) => s.setEvidenceOpen);
  const reduced = usePrefersReducedMotion();

  const [demo, setDemo] = React.useState<DemoState>("live");
  const [inv, setInv] = React.useState<Investigation | null>(null);
  const [failure, setFailure] = React.useState<{ code: string; message: string } | null>(
    null,
  );
  const [users, setUsers] = React.useState<User[]>([]);
  const [landed, setLanded] = React.useState(0);

  const [overruled, setOverruled] = React.useState(false);
  const [overrulePending, setOverrulePending] = React.useState(false);
  const [segmentsShown, setSegmentsShown] = React.useState(false);
  const [rerunning, setRerunning] = React.useState(false);

  /**
   * The page keys this component on `id`, so a route change remounts it and
   * every piece of local state resets without an effect writing to it.
   */
  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const [found, people] = await Promise.all([getInvestigation(id), getUsers()]);
        if (!alive) return;
        setInv(found);
        setUsers(people);
      } catch (e) {
        if (!alive) return;
        const f = e as ApiFailure;
        setFailure({
          code: f.code ?? "unknown",
          message: f.message ?? "The investigation could not be loaded.",
        });
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [id]);

  // ------------------------------------------- streaming: phases land in order
  const itemCount = inv?.ruleouts.length ?? 0;
  // Under reduced motion the ladder is simply complete — no timers, no writes.
  const revealed = reduced ? itemCount : landed;

  React.useEffect(() => {
    if (!inv || demo === "loading" || reduced) return;
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      setLanded(n);
      if (n >= itemCount) window.clearInterval(timer);
    }, REVEAL_MS);
    return () => window.clearInterval(timer);
  }, [inv, demo, reduced, itemCount]);

  // -------------------------------------------------------- evidence subject
  React.useEffect(() => {
    if (!inv) return;
    setSubject({
      id: inv.id,
      label: "this investigation",
      title: inv.question,
      state: inv.report.confidence,
      headline: inv.report.headline,
      checks: inv.report.checks,
      passed: inv.report.passed,
      total: inv.report.total,
      definitions: [{ id: inv.definition_id, name: inv.metric }],
    });
  }, [inv, setSubject]);

  // ------------------------------------------------------------------ share
  const share = React.useCallback(async () => {
    if (!inv) return;
    const permalink = `${window.location.origin}/investigations/${inv.id}`;
    try {
      await navigator.clipboard.writeText(buildShareText(inv, permalink));
      toast({
        kind: "success",
        message: "Conclusion copied with its seal, its figures and the permalink.",
      });
    } catch {
      toast({ kind: "error", message: "The clipboard could not be written to." });
    }
  }, [inv, toast]);

  useHotkeys(
    [{ key: "c", mod: true, shift: true, allowInEditable: true, run: () => void share() }],
    [share],
  );

  const loading = demo === "loading" || (!inv && !failure);
  const streaming = Boolean(inv) && revealed < itemCount;
  const errorPhase = demo === "error" ? (2 as const) : null;

  const author = users.find((u) => u.id === inv?.created_by);

  // ------------------------------------------------------------------ header
  const header = (
    <SurfaceHeader
      crumbs={[
        { label: "Investigations", href: "/investigations" },
        { label: inv?.question ?? "Investigation" },
      ]}
      actions={
        <>
          {inv && !streaming ? (
            <Button
              variant="ghost"
              size="sm"
              loading={rerunning}
              onClick={() => {
                setRerunning(true);
                void rerunInvestigation(inv.id)
                  .then((next) => {
                    toast({
                      kind: "success",
                      message: "Re-ran the investigation over the same period.",
                      action: {
                        label: "Open",
                        onClick: () => {
                          window.location.href = `/investigations/${next.id}`;
                        },
                      },
                    });
                  })
                  .catch((e: unknown) =>
                    toast({
                      kind: "error",
                      message:
                        e instanceof ApiFailure
                          ? e.message
                          : "The investigation could not be re-run.",
                    }),
                  )
                  .finally(() => setRerunning(false));
              }}
            >
              <RotateCw size={13} />
              Re-run
            </Button>
          ) : null}
          {streaming ? (
            <span className="flex items-center gap-1.5 text-ui-sm text-tertiary">
              <span
                aria-hidden="true"
                className="ds-pulse-accent h-1.5 w-1.5 rounded-full bg-accent-solid"
              />
              Phases resolving
            </span>
          ) : null}
          <StateSwitcher
            value={demo}
            onChange={(v) => {
              setLanded(0);
              setDemo(v);
            }}
            options={["live", "loading", "streaming", "error"]}
          />
        </>
      }
    />
  );

  // ------------------------------------------------------------------- error
  if (failure && demo !== "loading") {
    return (
      <>
        {header}
        <SurfaceBody>
          <Card className="mx-auto max-w-[560px]">
            <h2 className="text-subtitle text-primary">
              {failure.code === "not_found"
                ? "This investigation no longer exists"
                : "The investigation did not load"}
            </h2>
            <p className="mt-1.5 text-ui-sm text-secondary">{failure.message}</p>
            <div className="mt-4 flex items-center gap-2">
              <Link href="/investigations">
                <Button variant="secondary" size="md">
                  <ArrowLeft size={14} />
                  All investigations
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setFailure(null);
                  setInv(null);
                  void getInvestigation(id)
                    .then(setInv)
                    .catch((e: ApiFailure) =>
                      setFailure({ code: e.code, message: e.message }),
                    );
                }}
              >
                <RotateCw size={14} />
                Retry
              </Button>
            </div>
          </Card>
        </SurfaceBody>
      </>
    );
  }

  // ----------------------------------------------------------------- loading
  if (loading || !inv) {
    return (
      <>
        {header}
        <SurfaceBody wide>
          <div className="flex gap-8">
            <LadderSkeleton />
            <div className="min-w-0 flex-1 space-y-8">
              <ConclusionSkeleton />
              <DriverSkeleton />
              <NarrativeSkeleton />
            </div>
          </div>
        </SurfaceBody>
      </>
    );
  }

  const nullResult = inv.verdict.kind === "no_driver";
  const hasDecomposition = inv.drivers.length > 0;
  const showDecomposition = hasDecomposition && (!nullResult || segmentsShown);
  const totalLabel = inv.verdict.figures[0]?.comparison ?? inv.period;
  const implicated = itemsInPhase(inv.ruleouts, 1).find((r) => r.status === "implicated");

  return (
    <>
      {header}
      <SurfaceBody wide>
        <div className="flex gap-8">
          <div className="sticky top-0 self-start">
            <RuleoutLadder
              question={inv.question}
              ruleouts={inv.ruleouts}
              stoppedAt={inv.stopped_at}
              revealedCount={revealed}
              errorPhase={errorPhase}
              onRetryPhase={() => setDemo("live")}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-8 pb-8">
            <ConclusionBlock
              investigation={inv}
              authorName={author?.name ?? inv.created_by}
              authorInitials={author?.initials}
              overruled={overruled}
              segmentsShown={segmentsShown}
              segmentCount={inv.drivers.length}
              onOpenEvidence={() => setEvidenceOpen(true)}
              onShare={() => void share()}
              onShowSegments={() => setSegmentsShown((v) => !v)}
              onInvestigateAnyway={() => {
                setOverruled(true);
                setOverrulePending(true);
                window.setTimeout(() => setOverrulePending(false), 700);
              }}
            />

            {/* Phase 3 run at the user's request, permanently labelled. §8.2 */}
            {overruled ? (
              overrulePending ? (
                <DriverSkeleton rows={3} />
              ) : hasDecomposition ? (
                <DriverDecomposition
                  drivers={inv.drivers}
                  waterfall={inv.waterfall}
                  totalLabel={totalLabel}
                  state={inv.report.confidence}
                  checks={inv.report.checks}
                  passed={inv.report.passed}
                  total={inv.report.total}
                  overruleLabel={OVERRULE_LABEL}
                />
              ) : (
                <section aria-labelledby="overrule-label">
                  <h3 id="overrule-label" className="text-label text-tertiary uppercase">
                    Driver analysis
                  </h3>
                  <p className="mt-2.5 rounded-sm border border-qualified-border bg-qualified-bg px-2.5 py-1.5 text-ui-sm text-qualified">
                    {OVERRULE_LABEL}
                  </p>
                  <p className="prose-measure mt-3 text-body text-secondary">
                    Phase 3 ran at your request.{" "}
                    {implicated ? `${implicated.finding} ` : ""}
                    Decomposing a change that the measurement phase already accounts for
                    decomposes noise, so no segment contribution is reported here.
                  </p>
                </section>
              )
            ) : null}

            {/* The recorded decomposition. §8.4 */}
            {!overruled && showDecomposition ? (
              (
                <DriverDecomposition
                  drivers={inv.drivers}
                  waterfall={inv.waterfall}
                  totalLabel={totalLabel}
                  state={inv.report.confidence}
                  checks={inv.report.checks}
                  passed={inv.report.passed}
                  total={inv.report.total}
                />
              )
            ) : null}

            {streaming ? (
              <NarrativeSkeleton />
            ) : (
              <NarrativeBlock
                investigation={inv}
                onOpenEvidence={() => setEvidenceOpen(true)}
              />
            )}
          </div>
        </div>
      </SurfaceBody>
    </>
  );
}
