"use client";

import { Skeleton } from "@/components/ui/primitives";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { SurfaceBody } from "@/components/shell/app-shell";
import { LedgerTable } from "./ledger-table";
import { DEFAULT_SORT } from "./model";

const noop = () => {};

/**
 * The loading state, §14: a skeleton toolbar, a skeleton filter row, and eight
 * skeleton rows at the exact loaded row height. Never a spinner — a spinner
 * collapses the layout and then re-expands it.
 */
export function LedgerSkeleton() {
  return (
    <>
      <SurfaceHeader
        crumbs={[{ label: "Ledger" }]}
        actions={
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-7 w-[248px] rounded-sm" />
            <Skeleton className="h-7 w-[84px] rounded-sm" />
            <Skeleton className="h-7 w-7 rounded-sm" />
          </div>
        }
      />
      <SurfaceBody wide>
        <div className="mb-3 flex items-center gap-1.5">
          <Skeleton className="h-7 w-[64px] rounded-sm" />
          <Skeleton className="h-7 w-[84px] rounded-sm" />
          <Skeleton className="h-7 w-[124px] rounded-sm" />
          <Skeleton className="h-7 w-[112px] rounded-sm" />
          <span className="flex-1" />
          <Skeleton className="h-3 w-24" />
        </div>
        <LedgerTable
          groups={[]}
          loading
          density="compact"
          sort={DEFAULT_SORT}
          onSortChange={noop}
          selected={new Set()}
          onToggleSelect={noop}
          onSelectAll={noop}
          onClearSelection={noop}
          expanded={new Set()}
          onToggleExpand={noop}
          runsFor={() => []}
          focusedKey={null}
          onFocusRow={noop}
          onOpen={noop}
          onPreview={noop}
          onRerun={noop}
          onOpenDiff={noop}
          running={new Set()}
          flashing={new Set()}
          errors={new Map()}
          initialsOf={() => "··"}
          nameOf={() => "Unknown"}
          empty={null}
        />
      </SurfaceBody>
    </>
  );
}
