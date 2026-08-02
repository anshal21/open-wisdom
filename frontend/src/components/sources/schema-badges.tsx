"use client";

import * as React from "react";
import Link from "next/link";
import { Calendar, KeyRound, Lock, Sigma, Tag } from "lucide-react";
import type { CatalogRelationship, ColumnRole } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/overlays";
import { TriangleAlertFilled } from "@/components/seal/glyphs";

/**
 * Inferred column roles. The glyph is the second, colour-independent channel —
 * these badges read correctly in greyscale (design-system.md §11.16).
 */

const ROLE_GLYPH: Record<ColumnRole, React.ComponentType<{ size?: number; className?: string }>> = {
  measure: Sigma,
  dimension: Tag,
  date: Calendar,
  key: KeyRound,
  pii: Lock,
};

const ROLE_TITLE: Record<ColumnRole, string> = {
  measure: "Inferred as a measure — summable at its native grain.",
  dimension: "Inferred as a dimension — used to group and filter.",
  date: "Inferred as a date column — available for time buckets.",
  key: "Inferred as a key — used to join to other tables.",
  pii: "Detected as personal data. Excluded from answers by default.",
};

const PILL =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border px-1.5 text-label uppercase";

export function RoleBadge({ role }: { role: ColumnRole }) {
  const Glyph = ROLE_GLYPH[role];

  if (role === "pii") {
    // The admin setting that governs this is linked directly from the badge. §10.4
    return (
      <Tooltip label="Excluded from answers by default. Governed by the PII exposure policy.">
        <Link
          href="/settings/access#pii"
          className={cn(
            PILL,
            "border-border-strong bg-surface-2 text-secondary transition-colors duration-100 hover:border-border-accent hover:text-accent",
          )}
        >
          <Glyph size={10} />
          pii
        </Link>
      </Tooltip>
    );
  }

  return (
    <span
      title={ROLE_TITLE[role]}
      className={cn(PILL, "border-border-subtle bg-surface-2 text-tertiary")}
    >
      <Glyph size={10} />
      {role}
    </span>
  );
}

/**
 * `N:N` gets a qualified badge — the fan-out risk is surfaced at the schema
 * level, before anyone asks a question. §10.4
 */
export function CardinalityBadge({
  cardinality,
}: {
  cardinality: CatalogRelationship["cardinality"];
}) {
  if (cardinality === "N:N") {
    return (
      <Tooltip label="Joins through this can multiply rows">
        <span
          className={cn(
            PILL,
            "border-qualified-border bg-qualified-bg text-qualified normal-case",
          )}
        >
          <TriangleAlertFilled size={10} />
          N:N
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cn(PILL, "border-border-subtle bg-surface-2 text-tertiary normal-case")}>
      {cardinality}
    </span>
  );
}
