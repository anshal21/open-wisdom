import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A deliberately small markdown renderer — headings, paragraphs, lists,
 * emphasis and inline code. It builds React nodes, never raw HTML.
 */

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    i += 1;
    if (token.startsWith("**")) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-primary">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded-xs bg-surface-2 px-1 font-mono text-mono-sm text-secondary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = React.useMemo(() => source.split(/\n{2,}/), [source]);

  return (
    <div className={cn("prose-measure flex flex-col gap-2.5", className)}>
      {blocks.map((raw, bi) => {
        const block = raw.trim();
        if (!block) return null;

        if (block.startsWith("### ")) {
          return (
            <h3 key={bi} className="text-subtitle text-primary">
              {inline(block.slice(4), `h${bi}`)}
            </h3>
          );
        }
        if (block.startsWith("## ")) {
          return (
            <h2 key={bi} className="text-title text-primary">
              {inline(block.slice(3), `h${bi}`)}
            </h2>
          );
        }
        if (block.startsWith("# ")) {
          return (
            <h2 key={bi} className="text-title-lg text-primary">
              {inline(block.slice(2), `h${bi}`)}
            </h2>
          );
        }

        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="flex flex-col gap-1 pl-4">
              {lines.map((l, li) => (
                <li key={li} className="list-disc text-body text-secondary">
                  {inline(l.replace(/^\s*[-*]\s+/, ""), `l${bi}-${li}`)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className="text-body text-secondary">
            {inline(block, `p${bi}`)}
          </p>
        );
      })}
    </div>
  );
}
