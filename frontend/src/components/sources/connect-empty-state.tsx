"use client";

import * as React from "react";
import { Database } from "lucide-react";
import { enginesFor } from "./engines";
import type { SourceKind } from "@/lib/api/types";
import { EngineTile } from "./connection-state";

/**
 * screens.md §10.2 — the most important empty state in the product. The middle
 * sentence is the positioning; it belongs here, not only on a marketing page.
 * Copy is verbatim.
 */
export function ConnectEmptyState({
  kinds,
  onPick,
}: {
  /**
   * The connectors this build registers, from `GET /sources/kinds`. This used
   * to be a hardcoded four while the binary supported one, so three of the
   * buttons below led to a source that failed the first time it was used.
   */
  kinds: SourceKind[];
  onPick: (engine: SourceKind) => void;
}) {
  const engines = enginesFor(kinds);
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <span className="mb-4 text-tertiary">
        <Database size={20} strokeWidth={1.75} />
      </span>
      <h2 className="text-title text-primary">Connect a warehouse to get started</h2>
      <p className="mt-2 max-w-[46ch] text-body text-secondary">
        We introspect your schema automatically. There&apos;s no modeling step — you
        can ask a question as soon as the connection is live.
      </p>
      <p className="mt-3 text-ui-sm text-tertiary">
        Read-only credentials are enough.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {engines.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onPick(e.id)}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-transparent px-4 text-ui font-medium text-primary transition-colors duration-100 hover:bg-overlay-hover"
          >
            <EngineTile monogram={e.monogram} size={20} />
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}
