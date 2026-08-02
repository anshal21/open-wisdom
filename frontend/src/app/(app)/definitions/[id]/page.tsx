"use client";

import * as React from "react";
import Link from "next/link";
import {
  ApiFailure,
  getAnswers,
  getDefinition,
  getDefinitionImpact,
  getUsers,
} from "@/lib/api/client";
import type {
  AnswerSummary,
  Definition,
  DefinitionImpact,
  User,
} from "@/lib/api/types";
import { EMPTY, formatAbsolute, formatCount, isoTitle } from "@/lib/format";
import { useEvidence } from "@/state/evidence";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Button } from "@/components/ui/button";
import { ProvenanceStamp, SectionLabel, Skeleton } from "@/components/ui/primitives";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { DefinitionExport } from "@/components/definitions/definition-export";
import {
  DefinitionConflicts,
  DefinitionUsage,
} from "@/components/definitions/definition-usage";
import { RatifySheet } from "@/components/definitions/ratify-sheet";
import { VersionHistory } from "@/components/definitions/version-history";
import { DefinitionNotFound, RetryBanner } from "@/components/definitions/states";
import { definitionEvidence } from "@/components/definitions/evidence";

export default function DefinitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const setSubject = useEvidence((s) => s.setSubject);

  const [definition, setDefinition] = React.useState<Definition | null>(null);
  const [answers, setAnswers] = React.useState<AnswerSummary[] | null>(null);
  const [impact, setImpact] = React.useState<DefinitionImpact | null>(null);
  const [users, setUsers] = React.useState<Record<string, User>>({});
  const [missing, setMissing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const next = await getDefinition(id);
      const [nextAnswers, nextImpact, nextUsers] = await Promise.all([
        getAnswers({ definition_id: id }),
        getDefinitionImpact(id),
        getUsers(),
      ]);
      setDefinition(next);
      setAnswers(nextAnswers);
      setImpact(nextImpact);
      setUsers(Object.fromEntries(nextUsers.map((u) => [u.id, u])));
      setError(null);
      setMissing(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) {
        setMissing(err.message);
        return;
      }
      setError(
        err instanceof ApiFailure ? err.message : "This definition didn't load.",
      );
    }
  }, [id]);

  // Deferred a microtask so the first paint is the skeleton, never a state
  // write inside the effect body.
  React.useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (live) return load();
    });
    return () => {
      live = false;
    };
  }, [load]);

  React.useEffect(() => {
    if (!definition) return;
    setSubject(definitionEvidence(definition, users[definition.ratified_by]?.name));
  }, [definition, users, setSubject]);

  const retry = React.useCallback(async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  }, [load]);

  const ratifier = definition ? users[definition.ratified_by] : undefined;
  const loading = definition === null && missing === null && error === null;

  return (
    <>
      <SurfaceHeader
        crumbs={[
          { label: "Definitions", href: "/definitions" },
          { label: definition?.name ?? "Definition" },
        ]}
        scrollRef={scrollRef}
        actions={
          definition ? (
            <Button size="sm" variant="primary" onClick={() => setSheetOpen(true)}>
              New version
            </Button>
          ) : null
        }
      />

      <SurfaceBody scrollRef={scrollRef}>
        {missing ? (
          <DefinitionNotFound message={missing} />
        ) : loading ? (
          <DetailSkeleton />
        ) : (
          <div className="space-y-8">
            {error ? (
              <RetryBanner
                headline="Couldn't load this definition"
                reason={error}
                onRetry={() => void retry()}
                retrying={retrying}
              />
            ) : null}

            {definition ? (
              <>
                <section>
                  <div className="flex flex-wrap items-center gap-3">
                    <ConfidenceSeal state={definition.confidence} size="inline" />
                    <span className="font-mono text-mono-sm text-tertiary">
                      v{definition.version}
                    </span>
                    {definition.precedence ? (
                      <span className="text-ui-sm text-tertiary">
                        {definition.precedence === "official"
                          ? "Official — used without asking"
                          : "Preferred — alternatives are still flagged"}
                      </span>
                    ) : null}
                    {definition.earned ? (
                      <span className="text-ui-sm text-accent">
                        Born from a resolved ambiguity
                      </span>
                    ) : null}
                    <span className="flex-1" />
                    <Link
                      href={`/ledger?definition_id=${encodeURIComponent(definition.id)}`}
                      className="text-ui-sm text-secondary transition-colors duration-100 hover:text-accent"
                    >
                      Used in {formatCount(definition.usage_count)} answers ›
                    </Link>
                  </div>

                  <SectionLabel className="mt-5">Plain English</SectionLabel>
                  <p className="mt-1 max-w-[68ch] text-body text-primary">
                    {definition.plain_english || (
                      <span className="text-disabled">
                        {EMPTY} no plain English yet — this reading has never been
                        ratified.
                      </span>
                    )}
                  </p>

                  {ratifier && definition.ratified_at ? (
                    <ProvenanceStamp
                      className="mt-3"
                      name={ratifier.name}
                      initials={ratifier.initials}
                      at={isoTitle(definition.ratified_at)}
                      atLabel={`ratified ${formatAbsolute(definition.ratified_at, false)}`}
                    />
                  ) : null}
                </section>

                <section>
                  <SectionLabel>Expression</SectionLabel>
                  <SqlViewer
                    className="mt-2"
                    paths={[{ label: "Expression", sql: definition.expression }]}
                  />
                </section>

                <section>
                  <SectionLabel>Version history</SectionLabel>
                  <div className="mt-3">
                    <VersionHistory definition={definition} users={users} />
                  </div>
                </section>

                <section>
                  <SectionLabel count={answers?.length}>Usage</SectionLabel>
                  <div className="mt-2">
                    <DefinitionUsage
                      definition={definition}
                      answers={answers ?? []}
                      impact={impact}
                      loading={answers === null}
                    />
                  </div>
                </section>

                {definition.conflicts && definition.conflicts.length > 0 ? (
                  <section>
                    <SectionLabel count={definition.conflicts.length}>
                      Conflicts
                    </SectionLabel>
                    <div className="mt-2">
                      <DefinitionConflicts definition={definition} />
                    </div>
                  </section>
                ) : null}

                <section>
                  <SectionLabel>Export</SectionLabel>
                  <div className="mt-2">
                    <DefinitionExport definition={definition} users={users} />
                  </div>
                </section>
              </>
            ) : null}
          </div>
        )}
      </SurfaceBody>

      {sheetOpen && definition ? (
        <RatifySheet
          open
          onClose={() => setSheetOpen(false)}
          name={definition.name}
          plainEnglish={definition.plain_english}
          expression={definition.expression}
          definitionId={definition.id}
          sourceAnswerId={definition.source_answer_id || undefined}
          onRatified={() => void load()}
        />
      ) : null}
    </>
  );
}

/** Matches the loaded layout section for section. §9.13 */
function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <section>
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-[84px] rounded-xs" />
          <Skeleton className="h-3 w-6" />
          <Skeleton className="h-3 w-[188px]" />
          <span className="flex-1" />
          <Skeleton className="h-3 w-[132px]" />
        </div>
        <div className="mt-5 flex h-6 items-center">
          <Skeleton className="h-3 w-[104px]" />
        </div>
        <div className="mt-1 space-y-1.5">
          <div className="flex h-[22px] items-center">
            <Skeleton className="h-3.5 w-full max-w-[560px]" />
          </div>
          <div className="flex h-[22px] items-center">
            <Skeleton className="h-3.5 w-full max-w-[392px]" />
          </div>
        </div>
        <div className="mt-3 flex h-4 items-center gap-1.5">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-3 w-[156px]" />
        </div>
      </section>

      <section>
        <div className="flex h-6 items-center">
          <Skeleton className="h-3 w-[84px]" />
        </div>
        <Skeleton className="mt-2 h-[124px] w-full rounded-lg" />
      </section>

      <section>
        <div className="flex h-6 items-center">
          <Skeleton className="h-3 w-[116px]" />
        </div>
        <div className="mt-3 space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-[72px]" />
                <span className="flex-1" />
                <Skeleton className="h-3 w-[168px]" />
              </div>
              <Skeleton className="mt-2 h-[96px] w-full rounded-lg" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex h-6 items-center">
          <Skeleton className="h-3 w-[56px]" />
        </div>
        <Skeleton className="mt-2 h-[144px] w-full rounded-lg" />
      </section>
    </div>
  );
}
