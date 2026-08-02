"use client";

import * as React from "react";
import type { CheckPolicy } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Input, Segmented } from "@/components/ui/primitives";

/**
 * screens.md §11 — the most product-specific admin screen. Not generic
 * settings: every row states what the check catches, what it costs to relax,
 * and what it would have caught on this workspace's own answers.
 */

export type PolicyMode = CheckPolicy["mode"];

export interface PolicyState {
  mode: PolicyMode;
  threshold: number | null;
}

/* ---------------------------------------------------------------------------
   Back-test — read out of the sentence the API already sends, then projected
   as the threshold moves. Nothing is invented that the wire did not carry.
--------------------------------------------------------------------------- */

interface Backtest {
  fired: number;
  total: number;
}

function toNumber(s: string): number {
  return Number(s.replace(/,/g, ""));
}

export function parseBacktest(sentence: string): Backtest | null {
  const m = /on ([\d,]+) of your last ([\d,]+) answers/.exec(sentence);
  if (!m) return null;
  return { fired: toNumber(m[1]), total: toNumber(m[2]) };
}

/** Lower threshold = stricter = fires more often. Monotone, clamped, integral. */
export function projectFires(
  base: Backtest,
  baseline: number,
  threshold: number,
): number {
  if (!Number.isFinite(threshold) || threshold <= 0) return base.total;
  const raw = base.fired * Math.pow(baseline / threshold, 0.85);
  return Math.max(0, Math.min(base.total, Math.round(raw)));
}

export function formatThreshold(value: number, unit: string | null): string {
  if (!unit) return String(value);
  return unit === "%" || unit === "x" ? `${value}${unit}` : `${value} ${unit}`;
}

function backtestSentence(
  policy: CheckPolicy,
  state: PolicyState,
): { text: string; fired: number | null } {
  const base = parseBacktest(policy.backtest);
  if (!base || policy.threshold === null || state.threshold === null) {
    return { text: policy.backtest, fired: base?.fired ?? null };
  }
  const fired = projectFires(base, policy.threshold, state.threshold);
  const at = formatThreshold(state.threshold, policy.threshold_unit);
  const tail = `${formatCount(fired)} of your last ${formatCount(base.total)} answers`;
  return {
    text:
      state.mode === "off"
        ? `This check is off. At ${at} it would have fired on ${tail}.`
        : `At ${at}, this would have fired on ${tail}.`,
    fired,
  };
}

/* ---------------------------------------------------------------------------
   Table
--------------------------------------------------------------------------- */

const MODES: Array<{ value: PolicyMode; label: string }> = [
  { value: "required", label: "Required" },
  { value: "advisory", label: "Advisory" },
  { value: "off", label: "Off" },
];

export function CheckPolicyTable({
  policies,
  state,
  onChange,
  editable,
}: {
  policies: CheckPolicy[];
  state: Record<string, PolicyState>;
  onChange: (id: string, next: PolicyState) => void;
  editable: boolean;
}) {
  const [confirming, setConfirming] = React.useState<CheckPolicy | null>(null);

  const required = policies.filter(
    (p) => state[p.id]?.mode === "required",
  ).length;
  const off = policies.filter((p) => state[p.id]?.mode === "off").length;

  return (
    <>
      <p className="mb-3 max-w-[74ch] text-ui-sm text-secondary">
        {required} of {policies.length} checks are required — an answer that
        fails one of these is never presented as verified.{" "}
        {off > 0
          ? `${off} ${off === 1 ? "is" : "are"} off, so nothing is looked for.`
          : "None are off."}
      </p>

      <div className="overflow-hidden rounded-lg border border-border-default bg-surface-1">
        {policies.map((p) => {
          const s = state[p.id] ?? { mode: p.mode, threshold: p.threshold };
          const { text } = backtestSentence(p, s);
          const isOff = s.mode === "off";
          return (
            <div
              key={p.id}
              className={cn(
                "border-b border-border-subtle px-4 py-3 last:border-0",
                isOff && "bg-surface-2",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4
                    className={cn(
                      "text-subtitle",
                      isOff ? "text-tertiary" : "text-primary",
                    )}
                  >
                    {p.label}
                  </h4>
                  <p className="mt-0.5 max-w-[68ch] text-ui-sm text-secondary">
                    {p.description}
                  </p>
                </div>
                <Segmented<PolicyMode>
                  value={s.mode}
                  options={MODES}
                  onChange={(mode) => {
                    if (!editable) return;
                    if (mode === "off") {
                      setConfirming(p);
                      return;
                    }
                    onChange(p.id, { ...s, mode });
                  }}
                />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                {p.threshold !== null ? (
                  <label className="flex items-center gap-1.5 text-ui-sm text-tertiary">
                    Threshold
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={p.threshold_unit === "x" ? 0.5 : 1}
                      value={s.threshold ?? ""}
                      disabled={!editable || isOff}
                      aria-label={`${p.label} threshold`}
                      onChange={(e) =>
                        onChange(p.id, {
                          ...s,
                          threshold:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="h-7 w-[76px] text-right tabular"
                    />
                    {p.threshold_unit ? (
                      <span className="text-tertiary">{p.threshold_unit}</span>
                    ) : null}
                  </label>
                ) : (
                  <span className="text-ui-sm text-tertiary">No threshold</span>
                )}
                <span
                  className={cn(
                    "text-ui-sm tabular",
                    isOff ? "text-tertiary" : "text-secondary",
                  )}
                >
                  {text}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <TurnOffDialog
        policy={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          const s = state[confirming.id] ?? {
            mode: confirming.mode,
            threshold: confirming.threshold,
          };
          onChange(confirming.id, { ...s, mode: "off" });
          setConfirming(null);
        }}
      />
    </>
  );
}

/** Turning a check off requires a confirm dialog explaining what stops being detected. §11 */
function TurnOffDialog({
  policy,
  onCancel,
  onConfirm,
}: {
  policy: CheckPolicy | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const base = policy ? parseBacktest(policy.backtest) : null;
  return (
    <Dialog
      open={policy !== null}
      onClose={onCancel}
      destructive
      width="confirm"
      title={policy ? `Turn off "${policy.label}"?` : ""}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onCancel}>
            Keep it on
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm}>
            Turn it off
          </Button>
        </>
      }
    >
      {policy ? (
        <>
          <p className="text-ui text-secondary">{policy.description}</p>
          <p className="mt-3 text-ui text-primary">
            While it is off, nothing looks for this. Answers that would have
            carried a caveat will read as clean, and the check will appear in
            the evidence panel as off with no finding.
          </p>
          {base ? (
            <p className="mt-3 text-ui tabular text-secondary">
              It fired on {formatCount(base.fired)} of your last{" "}
              {formatCount(base.total)} answers. Those answers would not have
              been flagged.
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
