"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { getAnswer, getThread, ApiFailure } from "@/lib/api/client";
import { STAGES } from "@/lib/api/types";
import { useAsk, type Turn } from "@/state/ask";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import AskPage from "../page";

/**
 * A stored thread rehydrated into the live ask surface, so a recorded thread
 * and a fresh one are the same surface with the same affordances.
 */
export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  // Keyed so switching threads remounts rather than resetting state in an effect.
  return <Thread key={threadId} threadId={threadId} />;
}

function Thread({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const thread = await getThread(threadId);
        const answers = await Promise.all(
          thread.turns.map((t) => getAnswer(t.answer_id).catch(() => null)),
        );
        if (!alive) return;

        const turns: Turn[] = thread.turns.map((t, i) => {
          const a = answers[i];
          const done = Object.fromEntries(STAGES.map((s) => [s, "done" as const]));
          return {
            id: `turn_${t.answer_id}`,
            question: t.question,
            status: "done",
            stages: done as Turn["stages"],
            stageDetail: {},
            chips: [],
            checks: a?.report?.checks ?? [],
            expected: [],
            report: a?.report ?? undefined,
            narrative: a?.narrative ?? "",
            ambiguity: a?.ambiguity,
            startedAt: Date.parse(t.created_at),
            elapsedMs: a?.cost?.elapsed_ms,
            chart: a?.chart ?? undefined,
            interpretation: a
              ? {
                  restated: a.restated ?? "",
                  assumptions: [],
                  definition_used: {
                    id: a.definition_used?.id ?? "",
                    name: a.definition_used?.name ?? "",
                  },
                }
              : undefined,
            result: a
              ? {
                  answer_id: a.id,
                  value: a.value,
                  unit: a.unit,
                  format_hint: a.format_hint,
                  columns: a.columns,
                  rows: a.rows,
                  row_count: a.row_count,
                  scanned_rows: a.scanned_rows,
                }
              : undefined,
            cost: a?.cost ?? undefined,
          };
        });

        useAsk.setState({
          threadId: thread.id,
          title: thread.title,
          turns,
          context: thread.context,
          focusedTurnId: turns[turns.length - 1]?.id ?? null,
          draft: "",
        });
        setReady(true);
      } catch (e) {
        if (alive)
          setError(
            e instanceof ApiFailure ? e.message : "This thread could not be loaded.",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [threadId]);

  if (error) {
    return (
      <>
        <SurfaceHeader crumbs={[{ label: "Ask", href: "/ask" }, { label: "Thread" }]} />
        <SurfaceBody>
          <EmptyState
            icon={<ConfidenceGlyph state="unverified" size={20} />}
            headline="This thread no longer exists"
            body={error}
            action={
              <Button variant="primary" onClick={() => router.push("/ask")}>
                Ask something new
              </Button>
            }
          />
        </SurfaceBody>
      </>
    );
  }

  if (!ready) {
    return (
      <>
        <SurfaceHeader crumbs={[{ label: "Ask", href: "/ask" }, { label: "Thread" }]} />
        <SurfaceBody>
          <div className="space-y-6">
            <Skeleton className="h-6 w-[52ch]" />
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-24" />
            </div>
            <Skeleton className="h-11 w-64" />
            <Skeleton className="h-[240px] w-full" />
          </div>
        </SurfaceBody>
      </>
    );
  }

  return <AskPage />;
}
