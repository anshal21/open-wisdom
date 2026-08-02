"use client";

import * as React from "react";
import type { Definition, User } from "@/lib/api/types";
import { formatAbsolute, isoTitle } from "@/lib/format";
import { ProvenanceStamp } from "@/components/ui/primitives";
import { SqlBlock, SqlDiff } from "@/components/ui/sql-viewer";

/**
 * §4.5 + §9.15. Every adjacent pair of versions is diffed, and every diff
 * carries its plain-English summary above it — the summary is what a business
 * reader checks; the diff is the receipt.
 */
export function VersionHistory({
  definition,
  users,
}: {
  definition: Definition;
  users: Record<string, User>;
}) {
  const versions = definition.versions ?? [];

  if (versions.length === 0) {
    return (
      <p className="text-ui text-secondary">
        One version, ratified{" "}
        {definition.ratified_at ? (
          <time dateTime={definition.ratified_at} title={isoTitle(definition.ratified_at)}>
            {formatAbsolute(definition.ratified_at, false)}
          </time>
        ) : (
          "but not yet recorded"
        )}
        . Nothing has changed since.
      </p>
    );
  }

  const oldest = versions[versions.length - 1];

  return (
    <ol className="space-y-5">
      {versions.slice(0, -1).map((after, i) => {
        const before = versions[i + 1];
        const user = users[after.ratified_by];
        return (
          <li key={after.version}>
            <VersionHeading
              from={before.version}
              to={after.version}
              current={after.version === definition.version}
              name={user?.name}
              initials={user?.initials}
              at={after.ratified_at}
            />
            <SqlDiff
              className="mt-2"
              before={before.expression}
              after={after.expression}
              summary={after.summary}
            />
            {after.plain_english && after.plain_english !== before.plain_english ? (
              <p className="mt-2 text-ui-sm text-tertiary">
                Plain English now reads: {after.plain_english}
              </p>
            ) : null}
          </li>
        );
      })}

      <li>
        <VersionHeading
          to={oldest.version}
          current={oldest.version === definition.version}
          name={users[oldest.ratified_by]?.name}
          initials={users[oldest.ratified_by]?.initials}
          at={oldest.ratified_at}
        />
        <p className="mt-2 text-ui text-secondary">{oldest.summary}</p>
        <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface-inset">
          <SqlBlock sql={oldest.expression} />
        </div>
      </li>
    </ol>
  );
}

function VersionHeading({
  from,
  to,
  current,
  name,
  initials,
  at,
}: {
  from?: number;
  to: number;
  current: boolean;
  name?: string;
  initials?: string;
  at: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-mono-sm text-primary">
        {from !== undefined ? `v${from} → v${to}` : `v${to}`}
      </span>
      {current ? (
        <span className="inline-flex h-5 items-center rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 text-label text-accent uppercase">
          Current
        </span>
      ) : null}
      <span className="flex-1" />
      <ProvenanceStamp
        name={name ?? "a workspace member"}
        initials={initials}
        at={isoTitle(at)}
        atLabel={formatAbsolute(at, false)}
      />
    </div>
  );
}
