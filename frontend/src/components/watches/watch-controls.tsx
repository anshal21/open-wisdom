"use client";

/**
 * Snooze and threshold controls for a watch.
 *
 * Both of these previously existed as buttons that set local state and toasted
 * success while calling nothing — "Threshold saved" over a value the server
 * never received. They were removed for that, and this is the version with an
 * endpoint behind it.
 *
 * Every mutation here awaits the server and reports what actually happened.
 * Optimism is fine; asserting an outcome that has not landed is not.
 */

import * as React from "react";
import { BellOff, Bell, SlidersHorizontal } from "lucide-react";
import type { Watch, WatchCondition } from "@/lib/api/types";
import { ApiFailure, updateWatch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";

const SNOOZE_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "1 hour", hours: 1 },
  { label: "Until tomorrow", hours: 24 },
  { label: "1 week", hours: 24 * 7 },
];

export function WatchControls({
  watch,
  onChanged,
}: {
  watch: Watch;
  /** Receives the server's copy — never a locally-assumed one. */
  onChanged: (next: Watch) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [tuning, setTuning] = React.useState(false);

  const snoozed = watch.status === "snoozed";

  const apply = React.useCallback(
    async (
      body: { condition?: WatchCondition; snoozed_until?: string },
      success: (next: Watch) => string,
    ) => {
      setBusy(true);
      try {
        const next = await updateWatch(watch.id, body);
        onChanged(next);
        toast({ kind: "success", message: success(next) });
        return true;
      } catch (e: unknown) {
        toast({
          kind: "error",
          message:
            e instanceof ApiFailure ? e.message : "That change could not be saved.",
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [watch.id, onChanged, toast],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {snoozed ? (
        <Button
          variant="secondary"
          size="md"
          loading={busy}
          onClick={() =>
            void apply({ snoozed_until: "" }, () => `${watch.name} is watching again.`)
          }
        >
          <Bell size={14} />
          Wake
        </Button>
      ) : (
        SNOOZE_OPTIONS.map((opt) => (
          <Button
            key={opt.hours}
            variant="ghost"
            size="md"
            disabled={busy}
            onClick={() => {
              const until = new Date(Date.now() + opt.hours * 3600_000).toISOString();
              void apply(
                { snoozed_until: until },
                (next) =>
                  next.snoozed_until
                    ? `Snoozed until ${formatRelative(next.snoozed_until)}.`
                    : "Snoozed.",
              );
            }}
          >
            <BellOff size={14} />
            {opt.label}
          </Button>
        ))
      )}

      <Button variant="ghost" size="md" disabled={busy} onClick={() => setTuning(true)}>
        <SlidersHorizontal size={14} />
        Adjust threshold
      </Button>

      {tuning ? (
        <ThresholdDialog
          watch={watch}
          busy={busy}
          onClose={() => setTuning(false)}
          onSave={async (condition) => {
            const ok = await apply(
              { condition },
              () => `Threshold saved for ${watch.name}.`,
            );
            if (ok) setTuning(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ThresholdDialog({
  watch,
  busy,
  onClose,
  onSave,
}: {
  watch: Watch;
  busy: boolean;
  onClose: () => void;
  onSave: (c: WatchCondition) => void | Promise<void>;
}) {
  // Seeded once, on open, rather than synced from the prop through an effect:
  // a poll landing mid-edit would otherwise overwrite what the user is typing.
  const [value, setValue] = React.useState(String(watch.condition.value));
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      width="confirm"
      title="Adjust threshold"
      description={
        watch.condition.kind === "change_pct"
          ? "Alert when the metric moves by at least this percentage."
          : "Alert when the metric reaches this value."
      }
    >
      <label className="block text-ui-sm text-secondary" htmlFor="watch-threshold">
        {watch.condition.kind === "change_pct" ? "Change (%)" : "Value"}
      </label>
      <Input
        id="watch-threshold"
        className="mt-1.5"
        value={value}
        inputMode="decimal"
        autoFocus
        onChange={(e) => setValue(e.target.value)}
      />
      {!valid && value.trim() !== "" ? (
        <p className="mt-1.5 text-ui-sm text-contested">
          Enter a positive number.
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={busy}
          disabled={!valid}
          onClick={() => void onSave({ ...watch.condition, value: parsed })}
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}
