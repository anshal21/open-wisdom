"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Definition, User } from "@/lib/api/types";
import { EMPTY, formatCount, formatRelative, isoTitle } from "@/lib/format";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Avatar } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { DataTable, RowActions, type Column } from "@/components/ui/table";

/**
 * screens.md §4.2. Name · Definition · Confidence · Version · Ratified by ·
 * Used in · Updated. `Used in` links to the ledger — the link between the two
 * surfaces is the point of the column.
 */
export function DefinitionsTable({
  definitions,
  users,
  loading = false,
  selectedId,
  onOpen,
  onFocusRow,
  onEdit,
  onNewVersion,
  empty,
}: {
  definitions: Definition[];
  users: Record<string, User>;
  loading?: boolean;
  selectedId?: string | null;
  onOpen: (def: Definition) => void;
  onFocusRow?: (def: Definition) => void;
  onEdit: (def: Definition) => void;
  onNewVersion: (def: Definition) => void;
  empty?: React.ReactNode;
}) {
  const columns = React.useMemo<Column<Definition>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        width: "184px",
        render: (d) => (
          <span className="flex items-center gap-2">
            {/* Born from a fork, versus imported. §4.2 */}
            {d.earned ? (
              <span
                aria-hidden="true"
                title="Born from a resolved ambiguity"
                className="absolute top-0 left-0 h-full w-0.5 bg-accent-solid"
              />
            ) : null}
            <span className="truncate font-medium text-primary">{d.name}</span>
            {d.earned ? <span className="sr-only">Born from a fork</span> : null}
          </span>
        ),
      },
      {
        key: "plain_english",
        header: "Definition",
        render: (d) =>
          d.plain_english ? (
            <span className="block max-w-[300px] truncate text-secondary">
              {d.plain_english}
            </span>
          ) : (
            <span className="text-disabled" title="No plain English yet">
              {EMPTY}
            </span>
          ),
      },
      {
        key: "confidence",
        header: "Confidence",
        width: "96px",
        render: (d) => <ConfidenceSeal state={d.confidence} size="inline" />,
      },
      {
        key: "version",
        header: "Version",
        width: "72px",
        render: (d) => (
          <span className="font-mono text-mono-sm text-tertiary">v{d.version}</span>
        ),
      },
      {
        key: "ratified_by",
        header: "Ratified by",
        width: "148px",
        render: (d) => {
          const user = users[d.ratified_by];
          if (!user) return <span className="text-disabled">{EMPTY}</span>;
          return (
            <span className="flex items-center gap-1.5">
              <Avatar initials={user.initials} />
              <span className="truncate text-secondary">{user.name}</span>
            </span>
          );
        },
      },
      {
        key: "usage_count",
        header: "Used in",
        width: "88px",
        numeric: true,
        render: (d) => (
          <Link
            href={`/ledger?definition_id=${encodeURIComponent(d.id)}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xs text-secondary tabular transition-colors duration-100 hover:text-accent"
            title={`Answers that used ${d.name}`}
          >
            {formatCount(d.usage_count)}
          </Link>
        ),
      },
      {
        key: "updated_at",
        header: "Updated",
        width: "116px",
        render: (d) => (
          <time
            dateTime={d.updated_at}
            title={isoTitle(d.updated_at)}
            className="text-tertiary"
          >
            {formatRelative(d.updated_at)}
          </time>
        ),
      },
      {
        key: "actions",
        header: <span className="sr-only">Actions</span>,
        width: "236px",
        className: "text-right",
        render: (d) => (
          <RowActions>
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(d);
              }}
            >
              Edit
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onNewVersion(d);
              }}
            >
              New version
            </Button>
            <Link
              href={`/ledger?definition_id=${encodeURIComponent(d.id)}`}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex h-6 items-center rounded-sm px-1.5 text-ui-sm font-medium text-secondary",
                "transition-colors duration-100 hover:bg-overlay-hover hover:text-primary",
              )}
            >
              View usage
            </Link>
          </RowActions>
        ),
      },
    ],
    [users, onEdit, onNewVersion],
  );

  return (
    <DataTable
      columns={columns}
      rows={definitions}
      getKey={(d) => d.id}
      loading={loading}
      skeletonRows={8}
      selectedKey={selectedId ?? null}
      onRowActivate={onOpen}
      onRowFocus={onFocusRow}
      empty={empty}
    />
  );
}
