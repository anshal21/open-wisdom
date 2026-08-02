"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { Segmented } from "./primitives";
import { formatCount, formatDuration } from "@/lib/format";

/**
 * SQL / code viewer. design-system.md §9.9.
 * Exactly four inks. A seven-colour SQL block fights the confidence palette.
 */

const KEYWORDS = new Set(
  `select from where group by order having limit offset join inner left right full outer on as and or not in is null case when then else end union all distinct with sum count avg min max cast over partition between asc desc coalesce date_trunc extract interval filter using values insert update delete create table view exists`.split(
    " ",
  ),
);

type TokenKind = "keyword" | "string" | "number" | "comment" | "ident";

const INK: Record<TokenKind, string> = {
  keyword: "text-accent",
  string: "text-verified",
  number: "text-primary",
  comment: "text-tertiary",
  ident: "text-tertiary",
};

function tokenize(line: string): Array<{ text: string; kind: TokenKind }> {
  const out: Array<{ text: string; kind: TokenKind }> = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w.]*)|(\s+)|([^\s\w]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const [text, comment, str, num, word] = m;
    if (comment) out.push({ text, kind: "comment" });
    else if (str) out.push({ text, kind: "string" });
    else if (num) out.push({ text, kind: "number" });
    else if (word)
      out.push({
        text,
        kind: KEYWORDS.has(word.toLowerCase()) ? "keyword" : "ident",
      });
    else out.push({ text, kind: "ident" });
  }
  return out;
}

export function SqlBlock({
  sql,
  className,
  showLineNumbers = true,
  maxHeight,
}: {
  sql: string;
  className?: string;
  showLineNumbers?: boolean;
  maxHeight?: number;
}) {
  const lines = sql.replace(/\s+$/, "").split("\n");
  return (
    <div
      className={cn("overflow-x-auto", className)}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <pre className="p-3 font-mono text-mono leading-5">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {showLineNumbers ? (
                <span className="mr-3 inline-block w-6 shrink-0 text-right text-disabled select-none">
                  {i + 1}
                </span>
              ) : null}
              <span className="whitespace-pre">
                {tokenize(line).map((t, j) => (
                  <span key={j} className={INK[t.kind]}>
                    {t.text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function SqlViewer({
  paths,
  rowCount,
  elapsedMs,
  className,
  maxHeight = 300,
}: {
  /** One entry renders bare; two render as Path A / Path B tabs. */
  paths: Array<{ label: string; sql: string }>;
  rowCount?: number;
  elapsedMs?: number;
  className?: string;
  maxHeight?: number;
}) {
  const [tab, setTab] = React.useState(paths[0]?.label ?? "");
  const [copied, setCopied] = React.useState(false);
  const active = paths.find((p) => p.label === tab) ?? paths[0];

  if (!active) return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border-default bg-surface-inset",
        className,
      )}
    >
      <div className="flex h-9 items-center gap-3 border-b border-border-default px-2.5">
        {paths.length > 1 ? (
          <Segmented
            size="xs"
            value={tab}
            onChange={setTab}
            options={paths.map((p) => ({ value: p.label, label: p.label }))}
          />
        ) : (
          <span className="text-label text-tertiary uppercase">SQL</span>
        )}
        <span className="flex-1" />
        {typeof elapsedMs === "number" ? (
          <span className="text-ui-sm text-tertiary tabular">{formatDuration(elapsedMs)}</span>
        ) : null}
        {typeof rowCount === "number" ? (
          <span className="text-ui-sm text-tertiary tabular">
            {formatCount(rowCount)} {rowCount === 1 ? "row" : "rows"}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(active.sql);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          aria-label="Copy SQL"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-tertiary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary"
        >
          {copied ? <Check size={13} className="text-verified" /> : <Copy size={13} />}
        </button>
      </div>
      <SqlBlock sql={active.sql} maxHeight={maxHeight} />
    </div>
  );
}

/** Diff rendering for definition versions. §9.15 */
export function SqlDiff({
  before,
  after,
  summary,
  className,
}: {
  before: string;
  after: string;
  summary?: string;
  className?: string;
}) {
  const a = before.split("\n");
  const b = after.split("\n");
  const setA = new Set(a);
  const setB = new Set(b);
  const merged: Array<{ text: string; kind: "same" | "add" | "remove" }> = [];
  a.forEach((l) => merged.push({ text: l, kind: setB.has(l) ? "same" : "remove" }));
  b.forEach((l) => {
    if (!setA.has(l)) merged.push({ text: l, kind: "add" });
  });

  return (
    <div className={className}>
      {summary ? <p className="mb-2 text-ui text-secondary">{summary}</p> : null}
      <div className="overflow-hidden rounded-lg border border-border-default bg-surface-inset">
        <pre className="overflow-x-auto p-3 font-mono text-mono leading-5">
          <code>
            {merged.map((l, i) => (
              <div
                key={i}
                className={cn(
                  "-mx-1 flex px-1",
                  l.kind === "add" && "bg-verified-bg",
                  l.kind === "remove" && "bg-contested-bg",
                )}
              >
                <span
                  className={cn(
                    "mr-2 w-3 shrink-0 select-none",
                    l.kind === "add"
                      ? "text-verified"
                      : l.kind === "remove"
                        ? "text-contested"
                        : "text-disabled",
                  )}
                >
                  {l.kind === "add" ? "+" : l.kind === "remove" ? "−" : " "}
                </span>
                <span className="whitespace-pre text-secondary">{l.text}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
