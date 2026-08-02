"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { ROLE_BY_ID, type SpecRole } from "./roles";
import { SECTION_BY_ID, type SectionId } from "./sections";

/* ---------------------------------------------------------------------------
   Section shell
--------------------------------------------------------------------------- */

export function SectionShell({
  section,
  actions,
  children,
}: {
  section: SectionId;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const meta = SECTION_BY_ID[section];
  return (
    <section aria-labelledby={`settings-${section}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`settings-${section}`} className="text-title text-primary">
            {meta.label}
          </h2>
          <p className="mt-1 max-w-[70ch] text-ui-sm text-secondary">
            {meta.description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Group({
  title,
  hint,
  children,
  className,
  id,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-lg border border-border-default bg-surface-1 px-5 py-4",
        className,
      )}
    >
      <h3 className="text-subtitle text-primary">{title}</h3>
      {hint ? (
        <p className="mt-1 max-w-[74ch] text-ui-sm text-tertiary">{hint}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Per-section states — §14 requires all of them, per section
--------------------------------------------------------------------------- */

export function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-1.5 h-3 w-[52ch] max-w-full" />
      <div className="mt-5 rounded-lg border border-border-default bg-surface-1 px-5 py-4">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 space-y-4">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[132px_1fr] items-center gap-4"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-full max-w-[320px] rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SectionTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-1.5 h-3 w-[52ch] max-w-full" />
      <div className="mt-5 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        <div className="h-9 border-b border-border-default bg-surface-2" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex h-8 items-center gap-4 border-b border-border-subtle px-3 last:border-0"
          >
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionError({
  section,
  message,
  onRetry,
}: {
  section: SectionId;
  message: string;
  onRetry: () => void;
}) {
  return (
    <SectionShell section={section}>
      <div className="rounded-lg border border-contested-border bg-contested-bg px-5 py-4">
        <h3 className="text-subtitle text-contested">
          {SECTION_BY_ID[section].label} settings could not be read
        </h3>
        <p className="mt-1 max-w-[64ch] text-ui-sm text-secondary">{message}</p>
        <p className="mt-1 text-ui-sm text-tertiary">
          Nothing was changed. Other sections are unaffected.
        </p>
        <div className="mt-4">
          <Button size="sm" onClick={onRetry}>
            <RotateCw size={13} strokeWidth={2.25} />
            Retry
          </Button>
        </div>
      </div>
    </SectionShell>
  );
}

/** The empty state a section shows to a role that may not open it. */
export function PermissionEmpty({
  section,
  role,
}: {
  section: SectionId;
  role: SpecRole;
}) {
  const meta = SECTION_BY_ID[section];
  const roleMeta = ROLE_BY_ID[role];
  return (
    <SectionShell section={section}>
      <div className="flex flex-col items-center justify-center rounded-lg border border-border-default bg-surface-1 px-6 py-14 text-center">
        <span className="mb-4 text-tertiary">
          <Lock size={20} strokeWidth={1.75} />
        </span>
        <h3 className="text-subtitle text-primary">
          {meta.label} is managed by an Owner or Admin
        </h3>
        <p className="mt-1.5 max-w-[52ch] text-ui-sm text-secondary">
          You are a {roleMeta.label}. {roleMeta.description} Ask an Owner to
          change anything on this page.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link
            href="/settings/members"
            className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-ui font-medium text-primary transition-colors duration-100 hover:bg-overlay-hover"
          >
            See who can
          </Link>
          <Link
            href="/settings/usage"
            className="text-ui font-medium text-accent transition-colors duration-100 hover:underline"
          >
            Your usage
          </Link>
        </div>
      </div>
    </SectionShell>
  );
}

/* ---------------------------------------------------------------------------
   Inline save affordance — a toast for something you are looking at is
   duplicated feedback (§9.10), so saving reports inline.
--------------------------------------------------------------------------- */

export function SaveRow({
  dirty,
  onSave,
  onReset,
  saved,
  disabled,
  note,
}: {
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
  saved: boolean;
  disabled?: boolean;
  note?: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex items-center gap-3">
      <Button
        variant="primary"
        size="md"
        disabled={!dirty || disabled}
        onClick={onSave}
      >
        Save changes
      </Button>
      {dirty ? (
        <Button variant="ghost" size="md" onClick={onReset}>
          Discard
        </Button>
      ) : null}
      {saved && !dirty ? (
        <span className="ds-fade text-ui text-verified">Saved</span>
      ) : null}
      {note ? <span className="text-ui-sm text-tertiary">{note}</span> : null}
    </div>
  );
}
