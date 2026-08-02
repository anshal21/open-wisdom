"use client";

import * as React from "react";
import type { Settings, Source } from "@/lib/api/types";
import { ApiFailure, getSettings, getSources } from "@/lib/api/client";
import { Field, Input, Segmented } from "@/components/ui/primitives";
import { Select } from "./select";
import type { DemoState } from "./demo";
import { canEdit, canOpen, type SpecRole } from "./roles";
import {
  Group,
  PermissionEmpty,
  SaveRow,
  SectionError,
  SectionShell,
  SectionSkeleton,
} from "./section-frame";

/** IANA zones offered in the picker. The current setting is always included. */
const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

type ThemeDefault = Settings["theme_default"];

export function WorkspaceSection({
  role,
  demo,
}: {
  role: SpecRole;
  demo: DemoState;
}) {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  const [name, setName] = React.useState("");
  const [sourceId, setSourceId] = React.useState("");
  const [zone, setZone] = React.useState("");
  const [theme, setTheme] = React.useState<ThemeDefault>("system");
  const [saved, setSaved] = React.useState(false);

  const seed = React.useCallback((s: Settings) => {
    setName(s.workspace_name);
    setSourceId(s.default_source_id);
    setZone(s.timezone);
    setTheme(s.theme_default);
  }, []);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // Reset inside the async body, not in the effect itself: a
      // synchronous set here commits a render purely to blank the
      // screen, then commits again the moment data arrives.
      setSettings(null);
      setError(null);
      try {
        const [s, list] = await Promise.all([getSettings(), getSources()]);
        if (!alive) return;
        setSettings(s);
        setSources(list);
        seed(s);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The workspace settings did not load.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads, seed]);

  if (!canOpen("workspace", role))
    return <PermissionEmpty section="workspace" role={role} />;
  if (demo === "error" || error)
    return (
      <SectionError
        section="workspace"
        message={
          demo === "error"
            ? "The settings service did not answer in time."
            : (error as string)
        }
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  if (demo === "loading" || !settings) return <SectionSkeleton rows={4} />;

  const zones = ZONES.includes(settings.timezone)
    ? ZONES
    : [settings.timezone, ...ZONES];
  const editable = canEdit(role);
  const dirty =
    name !== settings.workspace_name ||
    sourceId !== settings.default_source_id ||
    zone !== settings.timezone ||
    theme !== settings.theme_default;

  return (
    <SectionShell section="workspace">
      <div className="space-y-4">
        <Group title="Identity">
          <div className="space-y-4">
            <Field label="Workspace name" required>
              <Input
                value={name}
                disabled={!editable}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                className="max-w-[320px]"
              />
            </Field>
            <Field
              label="Default source"
              hint="Questions that do not name a source run against this one."
            >
              <Select
                value={sourceId}
                disabled={!editable}
                ariaLabel="Default source"
                onChange={(v) => {
                  setSourceId(v);
                  setSaved(false);
                }}
                options={sources.map((s) => ({ value: s.id, label: s.name }))}
                className="max-w-[320px]"
              />
            </Field>
          </div>
        </Group>

        <Group
          title="Time zone"
          hint="This is the single most consequential setting on this page."
        >
          <Field label="Default time zone">
            <Select
              value={zone}
              disabled={!editable}
              ariaLabel="Default time zone"
              onChange={(v) => {
                setZone(v);
                setSaved(false);
              }}
              options={zones.map((z) => ({
                value: z,
                label: z.replace(/_/g, " "),
              }))}
              className="max-w-[320px]"
            />
          </Field>
          <p className="mt-3 max-w-[74ch] text-ui-sm text-secondary">
            Every date bucket in the product is computed in this zone — every
            day, week, month and quarter, in every answer, dashboard tile, watch
            and investigation. Changing it re-buckets dated answers on their
            next run, so a figure can legitimately move without the underlying
            data changing.
          </p>
          {zone !== settings.timezone ? (
            <p className="mt-2 max-w-[74ch] text-ui-sm text-qualified">
              Moving from {settings.timezone.replace(/_/g, " ")} to{" "}
              {zone.replace(/_/g, " ")} shifts every day boundary. Recorded
              answers keep the figures they were recorded with; re-running one
              may return a different number.
            </p>
          ) : null}
        </Group>

        <Group
          title="Appearance"
          hint="The theme people get before they choose one for themselves."
        >
          <Field label="Theme default">
            <Segmented<ThemeDefault>
              value={theme}
              onChange={(v) => {
                setTheme(v);
                setSaved(false);
              }}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
          </Field>
        </Group>
      </div>

      {editable ? (
        <SaveRow
          dirty={dirty}
          saved={saved}
          onSave={() => {
            setSettings({
              ...settings,
              workspace_name: name,
              default_source_id: sourceId,
              timezone: zone,
              theme_default: theme,
            });
            setSaved(true);
          }}
          onReset={() => {
            seed(settings);
            setSaved(false);
          }}
        />
      ) : null}
    </SectionShell>
  );
}
