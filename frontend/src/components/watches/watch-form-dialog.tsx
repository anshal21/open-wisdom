"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Definition, Watch, WatchCondition } from "@/lib/api/types";
import { formatValue } from "@/lib/format";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Field, Input, RadioRow, Segmented } from "@/components/ui/primitives";
import { backtest, type HistoryPoint } from "./backtest";

/**
 * Creating a watch. screens.md §9.3.
 *
 * The form is deliberately short — metric, grain, condition, sensitivity,
 * recipients, quiet hours — and the live back-test preview is required, not
 * optional. It recomputes against real history on every slider move.
 */

type ConditionKind = "outside_normal_range" | "above" | "below" | "change_pct";

const CONDITIONS: Array<{ kind: ConditionKind; label: string; description: string }> = [
  {
    kind: "outside_normal_range",
    label: "Outside normal range",
    description: "Fires when the value leaves the band its own history describes.",
  },
  {
    kind: "above",
    label: "Above a value",
    description: "Fires when the value crosses a fixed ceiling.",
  },
  {
    kind: "below",
    label: "Below a value",
    description: "Fires when the value crosses a fixed floor.",
  },
  {
    kind: "change_pct",
    label: "Changes by more than",
    description: "Fires on a period-over-period move larger than a percentage.",
  },
];

function Select({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-sm border border-border-default bg-surface-1 px-2 text-ui text-primary transition-colors duration-100 outline-none focus:border-border-accent"
    >
      {children}
    </select>
  );
}

/** 90 ticks: which periods this threshold would have fired on. */
function BacktestStrip({
  history,
  fires,
}: {
  history: HistoryPoint[];
  fires: number[];
}) {
  const firing = new Set(fires);
  return (
    <div
      role="img"
      aria-label={`${fires.length} of ${history.length} periods would have fired`}
      className="flex h-6 w-full items-end gap-px overflow-hidden rounded-xs bg-surface-2 p-1"
    >
      {history.map((p, i) => (
        <span
          key={p.t}
          className={cn(
            "min-w-px flex-1 rounded-[1px]",
            p.incomplete ? "hatch-unverified text-disabled" : "",
          )}
          style={{
            height: firing.has(i) ? "100%" : "45%",
            backgroundColor: p.incomplete
              ? "transparent"
              : firing.has(i)
                ? "var(--viz-status-qualified)"
                : "var(--c-border-strong)",
          }}
        />
      ))}
    </div>
  );
}

export interface WatchFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "create" | "adjust";
  /** Prefill for `adjust`. */
  watch?: Watch | null;
  definitions: Definition[];
  /** Source of real history for the back-test. */
  watches: Watch[];
  onSubmit: (watch: Watch) => void;
}

/**
 * The form only mounts while it is open, so its initial state is computed
 * once from props instead of being pushed in by an effect.
 */
export function WatchFormDialog(props: WatchFormDialogProps) {
  if (!props.open) return null;
  return <WatchForm {...props} />;
}

function WatchForm({
  onClose,
  mode,
  watch,
  definitions,
  watches,
  onSubmit,
}: WatchFormDialogProps) {
  const ratified = React.useMemo(
    () => definitions.filter((d) => d.status === "ratified"),
    [definitions],
  );

  const [definitionId, setDefinitionId] = React.useState(
    () =>
      watch?.definition_id ??
      watches.find((w) => w.history?.length)?.definition_id ??
      definitions.find((d) => d.status === "ratified")?.id ??
      "",
  );
  const [grain, setGrain] = React.useState(() => watch?.grain ?? "day");
  const [kind, setKind] = React.useState<ConditionKind>(() => {
    const c = watch?.condition;
    if (!c || c.kind === "outside_normal_range") return "outside_normal_range";
    if (c.kind === "change_pct") return "change_pct";
    return c.direction === "above" ? "above" : "below";
  });
  const [sensitivity, setSensitivity] = React.useState(() =>
    watch?.condition.kind === "outside_normal_range" ? watch.condition.value : 1.5,
  );
  const [amount, setAmount] = React.useState(() =>
    watch && watch.condition.kind !== "outside_normal_range" ? watch.condition.value : 10,
  );
  const [recipients, setRecipients] = React.useState<string[]>(
    () => watch?.recipients ?? [],
  );
  const [draft, setDraft] = React.useState("");
  const [quiet, setQuiet] = React.useState(true);
  const [quietFrom, setQuietFrom] = React.useState("19:00");
  const [quietTo, setQuietTo] = React.useState("08:00");

  const definition = ratified.find((d) => d.id === definitionId);

  const condition: WatchCondition = React.useMemo(() => {
    if (kind === "outside_normal_range")
      return { kind: "outside_normal_range", value: sensitivity, direction: "either" };
    if (kind === "change_pct")
      return { kind: "change_pct", value: amount, direction: "either" };
    return { kind: "threshold", value: amount, direction: kind === "above" ? "above" : "below" };
  }, [kind, sensitivity, amount]);

  /** Real history for this definition, when the workspace has any. */
  const history = React.useMemo<HistoryPoint[]>(
    () => watches.find((w) => w.definition_id === definitionId && w.history?.length)?.history ?? [],
    [watches, definitionId],
  );

  const result = React.useMemo(
    () => backtest(history, condition),
    [history, condition],
  );

  const sample = watches.find((w) => w.definition_id === definitionId);
  const hint = sample ?? watches.find((w) => w.history?.length);

  const submit = () => {
    const created: Watch = {
      id: watch?.id ?? `wat_${Date.now().toString(36)}`,
      name: `${definition?.name ?? "Metric"} — ${grain}ly`,
      definition_id: definitionId,
      definition_name: definition?.name ?? "Metric",
      schedule: `${grain}ly`,
      grain,
      condition,
      status: watch?.status ?? "watching",
      last_fired_at: watch?.last_fired_at ?? null,
      recipients,
      unit: hint?.unit ?? "",
      format_hint: hint?.format_hint ?? "number",
      backtest_fire_count: result.fires.length,
      history: watch?.history,
      normal_range: watch?.normal_range,
      current_value: watch?.current_value,
      pre_alert_checks: watch?.pre_alert_checks,
      held_reason: watch?.held_reason,
      held_hours: watch?.held_hours,
    };
    onSubmit(created);
    onClose();
  };

  const addRecipient = () => {
    const value = draft.trim().replace(/,$/, "");
    if (!value || recipients.includes(value)) return;
    setRecipients((r) => [...r, value]);
    setDraft("");
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width="form"
      title={mode === "create" ? "New watch" : "Adjust threshold"}
      description={
        mode === "create"
          ? "A watch turns a ratified definition into a standing question."
          : "The back-test recomputes as you move the slider."
      }
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" disabled={!definitionId} onClick={submit}>
            {mode === "create" ? "Create watch" : "Save threshold"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Metric" required>
          <Select value={definitionId} onChange={setDefinitionId} label="Metric">
            {ratified.length === 0 ? <option value="">No ratified definitions</option> : null}
            {ratified.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {definition ? (
            <p className="mt-1.5 text-ui-sm text-tertiary">{definition.plain_english}</p>
          ) : null}
        </Field>

        <Field label="Grain">
          <Segmented
            value={grain}
            onChange={setGrain}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        </Field>

        <Field label="Condition">
          <div className="space-y-0.5">
            {CONDITIONS.map((c) => (
              <RadioRow
                key={c.kind}
                name="watch-condition"
                value={c.kind}
                checked={kind === c.kind}
                onChange={(v) => setKind(v as ConditionKind)}
                label={c.label}
                description={c.description}
              />
            ))}
          </div>
        </Field>

        {kind === "outside_normal_range" ? (
          <Field label="Sensitivity" hint="Wider is quieter. The band is drawn from the metric's own history.">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={sensitivity}
                aria-label="Sensitivity"
                onChange={(e) => setSensitivity(Number(e.target.value))}
                className="h-1.5 w-full accent-[var(--c-accent-solid)]"
              />
              <span className="w-16 shrink-0 text-right text-ui tabular text-primary">
                ±{sensitivity.toFixed(1)}×
              </span>
            </div>
          </Field>
        ) : (
          <Field
            label={kind === "change_pct" ? "Change" : "Value"}
            hint={
              kind === "change_pct"
                ? "Period-over-period move, in percent."
                : hint
                  ? `Compared against ${formatValue(hint.current_value ?? 0, hint.format_hint, { unit: hint.unit })} at the last read.`
                  : undefined
            }
          >
            <Input
              type="number"
              value={amount}
              aria-label={kind === "change_pct" ? "Change percentage" : "Threshold value"}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
        )}

        {/* The live back-test. Required. §9.3 */}
        <Field label="Back-test">
          {history.length > 1 ? (
            <div>
              <p className="text-ui text-primary tabular">
                Would have fired {result.fires.length}{" "}
                {result.fires.length === 1 ? "time" : "times"} in the last{" "}
                {history.length} {grain}s
              </p>
              <div className="mt-2">
                <BacktestStrip history={history} fires={result.fires} />
              </div>
              <p className="mt-1.5 text-ui-sm text-tertiary">
                {result.evaluated} {grain}s evaluated
                {result.heldIncomplete > 0
                  ? ` · ${result.heldIncomplete} held as still in progress`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="text-ui-sm text-tertiary">
              No history has loaded for this definition yet, so the back-test cannot run.
              The first {grain === "day" ? "30 days" : `30 ${grain}s`} of readings will
              establish the band before this watch can fire.
            </p>
          )}
        </Field>

        <Field label="Recipients">
          <div className="flex flex-wrap items-center gap-1.5">
            {recipients.map((r) => (
              <span
                key={r}
                className="inline-flex h-6 items-center gap-1 rounded-sm border border-border-subtle bg-surface-2 pr-0.5 pl-2 text-ui-sm text-primary"
              >
                {r}
                <IconButton
                  label={`Remove ${r}`}
                  size="xs"
                  onClick={() => setRecipients((list) => list.filter((x) => x !== r))}
                >
                  <X size={11} />
                </IconButton>
              </span>
            ))}
          </div>
          <Input
            className={recipients.length ? "mt-1.5" : undefined}
            value={draft}
            placeholder="name@example.com"
            aria-label="Add a recipient"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={addRecipient}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addRecipient();
              }
              if (e.key === "Backspace" && !draft) {
                setRecipients((list) => list.slice(0, -1));
              }
            }}
          />
        </Field>

        <Field label="Quiet hours" hint="Firings inside quiet hours are held until the window closes.">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-ui text-secondary">
              <input
                type="checkbox"
                checked={quiet}
                onChange={(e) => setQuiet(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--c-accent-solid)]"
              />
              Hold overnight
            </label>
            <Input
              type="time"
              value={quietFrom}
              aria-label="Quiet hours start"
              disabled={!quiet}
              onChange={(e) => setQuietFrom(e.target.value)}
              className="w-28"
            />
            <span className="text-ui-sm text-tertiary">to</span>
            <Input
              type="time"
              value={quietTo}
              aria-label="Quiet hours end"
              disabled={!quiet}
              onChange={(e) => setQuietTo(e.target.value)}
              className="w-28"
            />
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
