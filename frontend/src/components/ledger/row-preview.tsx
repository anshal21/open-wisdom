"use client";

import * as React from "react";
import { ArrowUpRight, RotateCw } from "lucide-react";
import type { Answer } from "@/lib/api/types";
import { CONFIDENCE, sortChecks } from "@/lib/confidence";
import { EMPTY, formatAbsolute, formatValue, isoTitle } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Kbd, SectionLabel, Skeleton } from "@/components/ui/primitives";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { CheckRow } from "@/components/evidence/check-row";
import type { LedgerGroup } from "./model";

/**
 * §5.3 — `Space` on a focused row. Tier 1 + Tier 2 without navigation, so a
 * head of data can audit 30 answers a minute.
 */
export function RowPreview({
  group,
  answer,
  loading,
  onClose,
  onOpen,
  onRerun,
  nameOf,
}: {
  group: LedgerGroup | null;
  answer: Answer | null;
  loading: boolean;
  onClose: () => void;
  onOpen: (group: LedgerGroup) => void;
  onRerun: (group: LedgerGroup) => void;
  nameOf: (userId: string) => string;
}) {
  if (!group) return null;

  const lead = group.lead;
  const state = group.state;
  const meta = CONFIDENCE[state];
  const report = answer?.report;
  const checks = report ? sortChecks(report.checks) : [];
  const headline = report?.headline;
  const showsNumber = meta.showsNumber && lead.value !== null;

  return (
    <Dialog
      open
      onClose={onClose}
      width="form"
      title={lead.question}
      description={`Asked by ${nameOf(lead.created_by)} · ${formatAbsolute(lead.created_at)}`}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={() => onRerun(group)}>
            <RotateCw size={13} aria-hidden="true" />
            Re-run
            <Kbd className="ml-1">R</Kbd>
          </Button>
          <Button size="sm" variant="primary" onClick={() => onOpen(group)}>
            <ArrowUpRight size={13} aria-hidden="true" />
            Open
            <Kbd className="ml-1">↵</Kbd>
          </Button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.target instanceof HTMLButtonElement) return;
          if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            onRerun(group);
          } else if (e.key === "Enter") {
            e.preventDefault();
            onOpen(group);
          }
        }}
      >
        {/* Tier 1 — the figure and its seal, never one without the other. */}
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="text-hero-sm tabular text-primary"
            aria-label={`${showsNumber ? formatValue(lead.value, lead.format_hint, { unit: lead.unit }) : "No single figure"}. ${meta.label}.`}
          >
            {showsNumber
              ? formatValue(lead.value, lead.format_hint, { unit: lead.unit })
              : EMPTY}
          </span>
          <ConfidenceSeal
            state={state}
            size="standard"
            passed={report?.passed ?? lead.passed}
            total={report?.total ?? lead.total}
          />
        </div>

        {headline ? (
          <div className="mt-3">
            <ConfidenceSeal size="banner" state={state} headline={headline} />
          </div>
        ) : null}

        {group.runCount > 1 ? (
          <p className="mt-3 text-ui-sm tabular text-tertiary">
            {group.runCount} runs recorded for this question
            {group.diverged ? " · two of them disagree" : ""}
          </p>
        ) : null}

        {lead.definition_used ? (
          <p className="mt-3 text-ui-sm text-tertiary">
            Definition:{" "}
            <span className="text-secondary">
              {lead.definition_used.name} v{lead.definition_used.version}
            </span>
          </p>
        ) : null}

        {/* Tier 2 — the checks themselves. */}
        <SectionLabel className="mt-5" count={checks.length || undefined}>
          Checks
        </SectionLabel>
        <div className="mt-1.5 overflow-hidden rounded-lg border border-border-default bg-surface-1">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-border-subtle px-3 py-2.5 last:border-0"
              >
                <Skeleton className="mt-0.5 h-3.5 w-3.5 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="mt-1.5 h-3 w-full max-w-[380px]" />
                </div>
              </div>
            ))
          ) : checks.length > 0 ? (
            checks.map((check, i) => (
              <CheckRow key={check.id} check={check} index={i} />
            ))
          ) : (
            <p className="px-3 py-3 text-ui-sm text-tertiary">
              The full check record for this answer is not loaded. It recorded{" "}
              <span className="tabular text-secondary">
                {lead.passed} of {lead.total} checks
              </span>{" "}
              passing — open the answer to read every finding.
            </p>
          )}
        </div>

        <p className="mt-3 text-ui-sm text-tertiary">
          Recorded{" "}
          <time dateTime={lead.created_at} title={isoTitle(lead.created_at)}>
            {formatAbsolute(lead.created_at)}
          </time>
          .
        </p>
      </div>
    </Dialog>
  );
}
