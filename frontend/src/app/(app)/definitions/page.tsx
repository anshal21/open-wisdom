"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ApiFailure,
  dismissDefinition,
  getCoverage,
  getDefinitions,
  getProposedDefinitions,
  getUsers,
  ratifyDefinition,
} from "@/lib/api/client";
import type {
  Definition,
  DefinitionCoverage,
  DefinitionProposal,
  User,
} from "@/lib/api/types";
import { useEvidence } from "@/state/evidence";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import {
  CoverageHeader,
  CoverageHeaderSkeleton,
  ForkRateNudge,
} from "@/components/definitions/coverage-header";
import { DefinitionsTable } from "@/components/definitions/definitions-table";
import {
  ProposalQueue,
  ProposalQueueSkeleton,
} from "@/components/definitions/proposal-queue";
import { RatifySheet } from "@/components/definitions/ratify-sheet";
import { DefinitionsEmpty, RetryBanner } from "@/components/definitions/states";
import { definitionEvidence } from "@/components/definitions/evidence";

type Tab = "ratified" | "proposed" | "contested" | "all";
type Reading = DefinitionProposal["readings"][number];

interface SheetState {
  name?: string;
  plainEnglish?: string;
  expression?: string;
  definitionId?: string;
  sourceAnswerId?: string;
  /** Set when the sheet was opened from a proposal, so it can leave the queue. */
  proposalId?: string;
}

export default function DefinitionsPage() {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const setSubject = useEvidence((s) => s.setSubject);

  const [coverage, setCoverage] = React.useState<DefinitionCoverage | null>(null);
  const [definitions, setDefinitions] = React.useState<Definition[] | null>(null);
  const [proposals, setProposals] = React.useState<DefinitionProposal[] | null>(
    null,
  );
  const [users, setUsers] = React.useState<Record<string, User>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);

  const [tab, setTab] = React.useState<Tab>("ratified");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [resolved, setResolved] = React.useState<string[]>([]);
  const [busyProposal, setBusyProposal] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<SheetState | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [nextCoverage, nextDefinitions, nextProposals, nextUsers] =
        await Promise.all([
          getCoverage(),
          getDefinitions(),
          getProposedDefinitions(),
          getUsers(),
        ]);
      setCoverage(nextCoverage);
      setDefinitions(nextDefinitions);
      setProposals(nextProposals);
      setUsers(Object.fromEntries(nextUsers.map((u) => [u.id, u])));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiFailure
          ? err.message
          : "The definitions surface didn't load.",
      );
    }
  }, []);

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

  const retry = React.useCallback(async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  }, [load]);

  const visibleProposals = React.useMemo(
    () => (proposals ?? []).filter((p) => !resolved.includes(p.id)),
    [proposals, resolved],
  );

  const ratified = React.useMemo(
    () => (definitions ?? []).filter((d) => d.status === "ratified"),
    [definitions],
  );
  const contested = React.useMemo(
    () => (definitions ?? []).filter((d) => d.confidence === "contested"),
    [definitions],
  );

  const rows =
    tab === "ratified" ? ratified : tab === "contested" ? contested : definitions ?? [];

  const openDefinition = React.useCallback(
    (def: Definition) => router.push(`/definitions/${def.id}`),
    [router],
  );

  const focusDefinition = React.useCallback(
    (def: Definition) => {
      setSelectedId(def.id);
      setSubject(definitionEvidence(def, users[def.ratified_by]?.name));
    },
    [setSubject, users],
  );

  const openSheet = React.useCallback((next: SheetState) => setSheet(next), []);

  const ratifyReading = React.useCallback(
    (proposal: DefinitionProposal, reading: Reading) => {
      const existing = (definitions ?? []).find(
        (d) => d.name.toLowerCase() === proposal.term.toLowerCase(),
      );
      openSheet({
        name: proposal.term,
        plainEnglish: reading.label,
        expression: reading.expression,
        definitionId: existing?.id,
        proposalId: proposal.id,
      });
    },
    [definitions, openSheet],
  );

  /**
   * §4.3 — many ambiguities are two legitimate metrics wearing one word.
   * Resolving by naming both is a single click, and it ratifies each reading
   * under its own name rather than forcing a winner.
   */
  const ratifyBothApart = React.useCallback(
    async (proposal: DefinitionProposal) => {
      setBusyProposal(proposal.id);
      try {
        const created = await Promise.all(
          proposal.readings.map((r) =>
            ratifyDefinition({
              name: r.label,
              plain_english: r.label,
              expression: r.expression,
              scope: "workspace",
              precedence: "official",
              rerun_affected: false,
            }),
          ),
        );
        setDefinitions((prev) => [...created, ...(prev ?? [])]);
        setResolved((prev) => [...prev, proposal.id]);
        toast({
          kind: "success",
          message: `Ratified ${created
            .map((d) => `“${d.name}”`)
            .join(" and ")} as separate definitions.`,
        });
      } catch (err) {
        toast({
          kind: "error",
          message:
            err instanceof ApiFailure
              ? err.message
              : "Neither definition was ratified. Nothing was changed.",
        });
      } finally {
        setBusyProposal(null);
      }
    },
    [toast],
  );

  const dismissProposal = React.useCallback(
    (proposal: DefinitionProposal) => {
      // Optimistic: hide it now, put it back if the server refuses. A dismissal
      // that visibly lingers while a request flies reads as a broken button.
      setResolved((prev) => [...prev, proposal.id]);
      void dismissDefinition(proposal.id)
        .then(() => {
          toast({
            kind: "success",
            // Deliberately not "never proposed again": if the same ambiguity
            // recurs the pipeline raises a NEW proposal, because the question
            // genuinely came up again. Promising otherwise would be a claim the
            // server does not honour.
            message: `Dismissed “${proposal.term}”.`,
          });
        })
        .catch((e: unknown) => {
          setResolved((prev) => prev.filter((id) => id !== proposal.id));
          toast({
            kind: "error",
            message:
              e instanceof ApiFailure
                ? e.message
                : `“${proposal.term}” could not be dismissed.`,
          });
        });
    },
    [toast],
  );

  const loading = definitions === null && error === null;
  const isEmpty =
    definitions !== null &&
    proposals !== null &&
    definitions.length === 0 &&
    visibleProposals.length === 0;

  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Definitions" }]}
        scrollRef={scrollRef}
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => openSheet({})}
            disabled={loading}
          >
            New definition
          </Button>
        }
      />

      <SurfaceBody scrollRef={scrollRef}>
        <div className="space-y-6">
          {error ? (
            <RetryBanner
              headline="Couldn't load definitions"
              reason={error}
              onRetry={() => void retry()}
              retrying={retrying}
            />
          ) : null}

          {isEmpty ? (
            <DefinitionsEmpty onAsk={() => router.push("/ask")} />
          ) : (
            <>
              {coverage ? (
                <CoverageHeader coverage={coverage} />
              ) : error ? null : (
                <CoverageHeaderSkeleton />
              )}

              {coverage ? (
                <ForkRateNudge
                  coverage={coverage}
                  proposals={visibleProposals}
                  onReview={() => setTab("proposed")}
                />
              ) : null}

              <div>
                <Tabs<Tab>
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "ratified", label: "Ratified", count: ratified.length },
                    {
                      value: "proposed",
                      label: "Proposed",
                      count: visibleProposals.length,
                      accent: true,
                    },
                    {
                      value: "contested",
                      label: "Contested",
                      count: contested.length,
                    },
                    { value: "all", label: "All" },
                  ]}
                />

                <div className="mt-4">
                  {tab === "proposed" ? (
                    proposals === null ? (
                      <ProposalQueueSkeleton />
                    ) : visibleProposals.length === 0 ? (
                      <p className="rounded-lg border border-border-default bg-surface-1 px-4 py-8 text-center text-ui text-secondary">
                        Nothing waiting. A term lands here when a check finds two
                        defensible readings of it.
                      </p>
                    ) : (
                      <ProposalQueue
                        proposals={visibleProposals}
                        onRatify={ratifyReading}
                        onBoth={(p) => void ratifyBothApart(p)}
                        onDismiss={dismissProposal}
                        busyId={busyProposal}
                      />
                    )
                  ) : (
                    <DefinitionsTable
                      definitions={rows}
                      users={users}
                      loading={loading}
                      selectedId={selectedId}
                      onOpen={openDefinition}
                      onFocusRow={focusDefinition}
                      onEdit={(d) =>
                        openSheet({
                          name: d.name,
                          plainEnglish: d.plain_english,
                          expression: d.expression,
                          definitionId: d.id,
                          sourceAnswerId: d.source_answer_id || undefined,
                        })
                      }
                      onNewVersion={(d) =>
                        openSheet({ name: d.name, definitionId: d.id })
                      }
                      empty={
                        <p className="px-4 py-8 text-center text-ui text-secondary">
                          {tab === "contested"
                            ? "Nothing contested. A definition lands here when two ratified readings of the same word overlap."
                            : "Nothing ratified yet. Ratify a proposal and it will appear here."}
                        </p>
                      }
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </SurfaceBody>

      {/* Mounted only while open, so each opening is a fresh, unseeded form. */}
      {sheet ? (
        <RatifySheet
          open
          onClose={() => setSheet(null)}
          name={sheet.name}
          plainEnglish={sheet.plainEnglish}
          expression={sheet.expression}
          definitionId={sheet.definitionId}
          sourceAnswerId={sheet.sourceAnswerId}
          onRatified={() => {
            const proposalId = sheet.proposalId;
            if (proposalId) setResolved((prev) => [...prev, proposalId]);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
