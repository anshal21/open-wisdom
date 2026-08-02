"use client";

import * as React from "react";
import Link from "next/link";
import { Boxes, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

/**
 * §4.6. The empty state of a semantic layer is normally a shameful backlog;
 * here it is the promise, so the copy is verbatim.
 */
export function DefinitionsEmpty({ onAsk }: { onAsk: () => void }) {
  return (
    <EmptyState
      icon={<Boxes size={20} aria-hidden="true" />}
      headline="No definitions yet — and that's fine"
      body="Definitions accumulate as you ask questions. When a question is ambiguous, you'll pick a reading and can ratify it in one click."
      action={
        <Button size="lg" variant="primary" onClick={onAsk}>
          Ask a question
        </Button>
      }
      secondary={
        <Link
          href="/sources"
          className="rounded-sm text-ui font-medium text-accent transition-colors duration-100 hover:text-primary"
        >
          Import from dbt or Cube ›
        </Link>
      }
    />
  );
}

/** §9.13 — a cause, a plain reason, and a way back. No stack traces. */
export function RetryBanner({
  headline,
  reason,
  onRetry,
  retrying = false,
}: {
  headline: string;
  reason: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-contested-border bg-contested-bg p-4"
    >
      <CircleAlert
        size={15}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-contested"
      />
      <div className="min-w-0 flex-1">
        <p className="text-subtitle text-contested">{headline}</p>
        <p className="mt-1 text-ui text-secondary">{reason}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
        Retry
      </Button>
    </div>
  );
}

/** The real 404 for `/definitions/:id`. */
export function DefinitionNotFound({ message }: { message?: string }) {
  return (
    <EmptyState
      icon={<Boxes size={20} aria-hidden="true" />}
      headline="This definition no longer exists"
      body={
        message ??
        "It was removed, or the link is from a workspace you no longer have access to. The answers that used it are still in the ledger."
      }
      action={
        <Link
          href="/definitions"
          className="inline-flex h-8 items-center rounded-md bg-accent-solid px-3 text-ui font-medium text-white transition-colors duration-100 hover:bg-accent-solid-hover"
        >
          Back to definitions
        </Link>
      }
    />
  );
}
