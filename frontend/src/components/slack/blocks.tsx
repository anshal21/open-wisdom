"use client";

import * as React from "react";
import { Hash, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Slack surfaces, screens.md §12. Block Kit shapes rendered with our own
 * tokens — a section is body-sized, a context row is small and grey, an
 * actions row is a row of buttons, and nothing here uses a font Slack does not
 * have. The constraint being illustrated is the medium's, not ours.
 */

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SlackChannel({
  channel,
  children,
}: {
  channel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface-1">
      <div className="flex items-center gap-1.5 border-b border-border-default bg-surface-2 px-4 py-2">
        <Hash size={13} className="text-tertiary" aria-hidden="true" />
        <span className="text-subtitle text-primary">
          {channel.replace(/^#/, "")}
        </span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

export function SlackMessage({
  at,
  children,
  reply = false,
}: {
  at: string;
  children: React.ReactNode;
  reply?: boolean;
}) {
  return (
    <div className={cn("flex gap-2.5", reply && "mt-3 border-l border-border-subtle pl-4")}>
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-solid text-white"
      >
        <Sparkles size={17} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-subtitle text-primary">Analyst</span>
          <span className="rounded-xs bg-surface-2 px-1 py-px text-label text-tertiary uppercase">
            App
          </span>
          <span className="text-ui-sm tabular text-tertiary">{clock(at)}</span>
        </div>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}

/** A `section` block. Body type, primary ink. */
export function SlackSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("text-body text-primary", className)}>{children}</div>;
}

/** A `context` block. Small and grey, exactly as Slack renders it. */
export function SlackContext({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("text-ui-sm text-tertiary", className)}>{children}</div>;
}

export function SlackDivider() {
  return <hr className="my-2 border-0 border-t border-border-subtle" />;
}

export function Bold({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
}

/** The `image` block. Slack renders a server-side PNG; this is the real chart. */
export function SlackImage({
  alt,
  children,
}: {
  alt: string;
  children: React.ReactNode;
}) {
  return (
    <figure
      role="img"
      aria-label={alt}
      className="max-w-[800px] overflow-hidden rounded-md border border-border-default bg-surface-1"
    >
      {children}
    </figure>
  );
}

export interface SlackButton {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

/** An `actions` block. */
export function SlackActions({ buttons }: { buttons: SlackButton[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {buttons.map((b) => (
        <Button
          key={b.label}
          size="md"
          variant={b.primary ? "primary" : "secondary"}
          onClick={b.onClick}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The state row. The emoji is the medium's requirement; the word is ours.
 * §12.1 — an emoji alone does not survive a screenshot or a screen reader.
 */
export function SlackStateRow({
  emoji,
  word,
  passed,
  total,
  className,
}: {
  emoji: string;
  word: string;
  passed?: number;
  total?: number;
  className?: string;
}) {
  return (
    <SlackSection className={className}>
      <span aria-hidden="true" className="mr-1.5">
        {emoji}
      </span>
      <Bold>{word}</Bold>
      {typeof passed === "number" && typeof total === "number" && total > 0 ? (
        <span className="text-secondary"> · {passed} of {total} checks passed</span>
      ) : null}
    </SlackSection>
  );
}
