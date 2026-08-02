"use client";

import * as React from "react";
import { LedgerSurface } from "@/components/ledger/ledger-surface";
import { LedgerSkeleton } from "@/components/ledger/ledger-skeleton";

/**
 * screens.md §5 — the Answer ledger. Durable, searchable, permalinkable
 * answers; not chat messages, not a history list.
 */
export default function LedgerPage() {
  return (
    <React.Suspense fallback={<LedgerSkeleton />}>
      <LedgerSurface />
    </React.Suspense>
  );
}
