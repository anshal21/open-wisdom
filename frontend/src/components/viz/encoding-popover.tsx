"use client";

/**
 * The encoding editor. Every row is GENERATED — channel rows from the form's
 * declared channels, option rows from its options schema — so a form that
 * declares an x/y/colour triple gets a colour row here with no edit to this
 * file, and a form with no series channel (pie) simply has no series row.
 *
 * Built on the shared `Popover`: portaled, Escape-closing, animated, and never
 * clipped by the chart frame that owns the trigger.
 */

import * as React from "react";
import type { ResultColumn } from "@/lib/api/types";
import { getMeta, type Channel, type OptionDef, type VizTable } from "@/lib/viz/registry";
import type { ResolvedSpec, Voice, VizOverride } from "@/lib/viz/resolve";
import { explain } from "@/lib/viz/explain";
import type { PivotResult } from "@/lib/viz/series";
import { Popover } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

const NONE = "__none__";

const VOICE_LABEL: Record<Voice, string> = {
  user: "you chose",
  suggested: "suggested",
  default: "default",
};

export function EncodingPopover({
  open,
  onClose,
  anchorRef,
  table,
  spec,
  pivotResult,
  override,
  onOverride,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  table: VizTable;
  spec: ResolvedSpec;
  pivotResult: PivotResult | null;
  override?: VizOverride | null;
  onOverride: (next: VizOverride) => void;
}) {
  const meta = getMeta(spec.type);
  const id = React.useId();
  if (!meta) return null;

  const columnsFor = (ch: Channel): ResultColumn[] =>
    table.columns.filter((c) => ch.accepts.includes(c.type));

  const valueFor = (ch: Channel): string => {
    if (ch.id === "x") return spec.xIdx >= 0 ? table.columns[spec.xIdx].name : NONE;
    if (ch.id === "y") return spec.yIdxs.length ? table.columns[spec.yIdxs[0]].name : NONE;
    return spec.seriesIdx >= 0 ? table.columns[spec.seriesIdx].name : NONE;
  };

  const setChannel = (ch: Channel, v: string) => {
    if (ch.id === "x") onOverride({ ...override, x: v });
    else if (ch.id === "y") onOverride({ ...override, y: [v] });
    else onOverride({ ...override, series: v === NONE ? null : v });
  };

  const setOption = (key: string, v: unknown) =>
    onOverride({ ...override, options: { ...(override?.options ?? {}), [key]: v } });

  const sentence = explain(table, spec, pivotResult);

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} align="end" width={272}>
      <div className="space-y-2.5 p-2">
        {meta.channels.length ? (
          <div className="space-y-1.5">
            {meta.channels.map((ch) => {
              const opts = columnsFor(ch);
              const rowId = `${id}-${ch.id}`;
              return (
                <Row
                  key={ch.id}
                  htmlFor={rowId}
                  label={ch.label}
                  voice={VOICE_LABEL[spec.why[ch.id] ?? "default"]}
                >
                  <Select
                    id={rowId}
                    value={valueFor(ch)}
                    onChange={(v) => setChannel(ch, v)}
                    options={[
                      // A required channel cannot be emptied — the form would
                      // stop being able to draw itself.
                      ...(ch.required ? [] : [{ value: NONE, label: "None" }]),
                      ...opts.map((c) => ({ value: c.name, label: c.label ?? c.name })),
                    ]}
                  />
                </Row>
              );
            })}
          </div>
        ) : null}

        {meta.options.length ? (
          <div className="space-y-1.5 border-t border-border-subtle pt-2">
            {meta.options
              .filter((o) => !o.showIf || o.showIf(spec.options))
              .map((o) => (
                <OptionRow
                  key={o.key}
                  id={`${id}-opt-${o.key}`}
                  def={o}
                  value={spec.options[o.key]}
                  voice={VOICE_LABEL[spec.why.options?.[o.key] ?? "default"]}
                  onChange={(v) => setOption(o.key, v)}
                />
              ))}
          </div>
        ) : null}

        {/* Why this chart looks the way it does. An answer explains its
            number; a chart explains its shape. (roadmap D3) */}
        {sentence ? (
          <p className="border-t border-border-subtle pt-2 text-ui-sm text-tertiary">
            {sentence}
          </p>
        ) : null}
      </div>
    </Popover>
  );
}

function Row({
  htmlFor,
  label,
  voice,
  children,
}: {
  htmlFor: string;
  label: string;
  voice: string;
  children: React.ReactNode;
}) {
  return (
    // A control whose label reads "ORIENT…" explains nothing. The label
    // column sizes to its content and the value column gives way instead.
    <div className="flex items-center gap-2">
      <label
        htmlFor={htmlFor}
        className="shrink-0 whitespace-nowrap text-label uppercase text-tertiary"
      >
        {label}
      </label>
      <div className="ml-auto min-w-0">{children}</div>
      <span className="w-14 shrink-0 text-right text-ui-sm text-tertiary">{voice}</span>
    </div>
  );
}

function OptionRow({
  id,
  def,
  value,
  voice,
  onChange,
}: {
  id: string;
  def: OptionDef;
  value: unknown;
  voice: string;
  onChange: (v: unknown) => void;
}) {
  if (def.kind === "toggle") {
    return (
      <Row htmlFor={id} label={def.label} voice={voice}>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          className={cn(
            "inline-flex h-5 w-9 items-center rounded-full border transition-colors duration-100",
            value ? "border-border-accent bg-accent/25" : "border-border-default bg-surface-2",
          )}
        >
          <span
            className={cn(
              "h-3.5 w-3.5 rounded-full transition-transform duration-100",
              value ? "translate-x-[18px] bg-accent" : "translate-x-[2px] bg-tertiary",
            )}
          />
        </button>
      </Row>
    );
  }

  if (def.kind === "number") {
    return (
      <Row htmlFor={id} label={def.label} voice={voice}>
        <input
          id={id}
          type="number"
          value={typeof value === "number" ? value : def.default}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-6 w-full rounded-sm border border-border-default bg-surface-1 px-1.5 text-ui-sm tabular text-primary focus:border-border-accent focus:outline-none"
        />
      </Row>
    );
  }

  return (
    <Row htmlFor={id} label={def.label} voice={voice}>
      <Select
        id={id}
        value={typeof value === "string" ? value : def.default}
        onChange={onChange}
        options={def.values}
      />
    </Row>
  );
}

/**
 * A styled native select. Native is the right call inside a popover: it gets
 * keyboard, type-ahead and mobile pickers for free, and its own listbox is
 * never clipped. What was wrong before was the popover around it, not this.
 */
function Select({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-full rounded-sm border border-border-default bg-surface-1 px-1 text-ui-sm text-primary focus:border-border-accent focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
