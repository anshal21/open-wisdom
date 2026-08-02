"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import type { Definition, User } from "@/lib/api/types";
import { Segmented } from "@/components/ui/primitives";

/**
 * §4.5 — export sits at the top of its section, never behind a menu. The
 * research is explicit: never require our own spec and never trap the work.
 *
 * Every line below is generated from the definition record; nothing here knows
 * the name of a table, a column, or a warehouse.
 */

type Target = "dbt" | "cube";

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "metric"
  );
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function dbtMetricYaml(def: Definition, ratifier?: string): string {
  const lines = [
    "version: 2",
    "",
    "metrics:",
    `  - name: ${slug(def.name)}`,
    `    label: ${yamlString(def.name)}`,
  ];
  if (def.plain_english) {
    lines.push(`    description: ${yamlString(def.plain_english)}`);
  }
  lines.push("    calculation_method: expression", "    expression: |");
  for (const line of def.expression.split("\n")) lines.push(`      ${line}`);
  lines.push("    meta:", `      version: ${def.version}`);
  if (ratifier) lines.push(`      ratified_by: ${yamlString(ratifier)}`);
  if (def.ratified_at) lines.push(`      ratified_at: ${def.ratified_at}`);
  if (def.precedence) lines.push(`      precedence: ${def.precedence}`);
  if (def.scope) lines.push(`      scope: ${def.scope}`);
  return lines.join("\n");
}

function cubeSchema(def: Definition, ratifier?: string): string {
  const key = slug(def.name);
  const cubeName = def.name.replace(/[^A-Za-z0-9]+/g, "");
  const lines = [
    `cube(\`${cubeName || "Metric"}\`, {`,
    "  measures: {",
    `    ${key}: {`,
    `      title: \`${def.name}\`,`,
  ];
  if (def.plain_english) {
    lines.push(`      description: \`${def.plain_english}\`,`);
  }
  const expr = def.expression.split("\n");
  if (expr.length === 1) {
    lines.push(`      sql: \`${expr[0]}\`,`);
  } else {
    lines.push("      sql: `");
    for (const line of expr) lines.push(`        ${line}`);
    lines.push("      `,");
  }
  lines.push("      type: `number`,", "      meta: {", `        version: ${def.version},`);
  if (ratifier) lines.push(`        ratified_by: \`${ratifier}\`,`);
  if (def.precedence) lines.push(`        precedence: \`${def.precedence}\`,`);
  lines.push("      },", "    },", "  },", "});");
  return lines.join("\n");
}

export function DefinitionExport({
  definition,
  users,
}: {
  definition: Definition;
  users: Record<string, User>;
}) {
  const [target, setTarget] = React.useState<Target>("dbt");
  const [copied, setCopied] = React.useState(false);
  const ratifier = users[definition.ratified_by]?.name;

  const text = React.useMemo(
    () =>
      target === "dbt"
        ? dbtMetricYaml(definition, ratifier)
        : cubeSchema(definition, ratifier),
    [target, definition, ratifier],
  );

  const filename =
    target === "dbt" ? `${slug(definition.name)}.yml` : `${slug(definition.name)}.js`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Target>
          value={target}
          onChange={setTarget}
          options={[
            { value: "dbt", label: "dbt metric YAML" },
            { value: "cube", label: "Cube schema" },
          ]}
        />
        <span className="font-mono text-mono-sm text-tertiary">{filename}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border-default bg-surface-2 px-2.5 text-ui font-medium text-primary transition-colors duration-100 hover:border-border-hover"
        >
          {copied ? (
            <Check size={13} className="text-verified" aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="mt-2 text-ui-sm text-tertiary">
        Paste it into your own repository. The ratification record travels with
        it as metadata.
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-inset">
        <CodeBlock text={text} />
      </div>
    </div>
  );
}

/** SqlBlock geometry, without SQL tokenisation — this is YAML and JavaScript. */
function CodeBlock({ text }: { text: string }) {
  const lines = text.replace(/\s+$/, "").split("\n");
  return (
    <div className="overflow-x-auto">
      <pre className="p-3 font-mono text-mono leading-5">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="mr-3 inline-block w-6 shrink-0 text-right text-disabled select-none">
                {i + 1}
              </span>
              <span className="whitespace-pre text-secondary">{line}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
