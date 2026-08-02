"use client";

import * as React from "react";
import type { Answer } from "@/lib/api/types";
import { CONFIDENCE, type ConfidenceState } from "@/lib/confidence";
import { AnswerChart } from "@/components/charts/answer-chart";
import {
  Bold,
  SlackActions,
  SlackContext,
  SlackImage,
  SlackMessage,
  SlackSection,
  SlackStateRow,
} from "./blocks";
import { SLACK_EMOJI } from "./emoji";
import { contextLine, heroValue, readLine } from "./payload";

/**
 * screens.md §12.1. The state word is spelled out, the caveat is in the body
 * rather than behind a button, there is one image, one context line, and at
 * most three buttons.
 */
export function SlackAnswerCard({
  answer,
  provenance,
}: {
  answer: Answer;
  /** `Revenue v3 · ratified by Priya Nair · 4 Mar` */
  provenance: string | null;
}) {
  const report = answer.report;
  const state = (report?.confidence ?? "refused") as ConfidenceState;
  const meta = CONFIDENCE[state];

  return (
    <>
      <SlackMessage at={answer.created_at}>
        <SlackSection>
          <Bold>{heroValue(answer)}</Bold>
        </SlackSection>
        <SlackSection className="text-secondary">{readLine(answer)}</SlackSection>

        <SlackStateRow
          emoji={SLACK_EMOJI[state]}
          word={meta.label}
          passed={report?.passed}
          total={report?.total}
        />

        {report?.headline ? (
          <SlackSection className="text-secondary">{report.headline}</SlackSection>
        ) : null}

        {answer.chart && report ? (
          <SlackImage
            alt={`${readLine(answer)} — ${report.passed} of ${report.total} checks passed`}
          >
            <AnswerChart
              spec={answer.chart}
              columns={answer.columns}
              rows={answer.rows}
              confidenceState={state}
              checks={report.checks}
              passed={report.passed}
              total={report.total}
              caveat={report.headline}
              unit={answer.unit}
              formatHint={answer.format_hint}
              title={readLine(answer)}
            />
          </SlackImage>
        ) : null}

        {provenance ? (
          <SlackContext>
            <em>{provenance}</em>
          </SlackContext>
        ) : null}

        <SlackActions
          buttons={[
            { label: "View evidence" },
            { label: "Ask a follow-up" },
            { label: "Re-run" },
          ]}
        />
      </SlackMessage>

      {/* §12.4 — threaded replies inherit the chip context, so it becomes text. */}
      <SlackMessage at={answer.created_at} reply>
        <SlackContext>
          <em>{contextLine(answer)}</em>
        </SlackContext>
        <SlackSection className="text-secondary">
          Ask a follow-up in this thread and it keeps that context. Change any part of
          it and this line is rewritten, so the reading is never invisible.
        </SlackSection>
      </SlackMessage>
    </>
  );
}
