"use client";

import * as React from "react";
import type { Settings } from "@/lib/api/types";
import { ApiFailure, getSettings } from "@/lib/api/client";
import { Field, Input, Segmented } from "@/components/ui/primitives";
import { CheckPolicyTable, type PolicyState } from "./check-policy-table";
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

type Speed = Settings["model_speed"];
type Strictness = Settings["verification_strictness"];

const PROVIDERS = ["anthropic", "openai", "google"];

const SPEED_NOTE: Record<Speed, string> = {
  fast: "One derivation path. Answers land sooner and more of them come back unverified, because there is nothing to cross-check against.",
  balanced:
    "A second derivation path when the question supports one. This is what makes an answer verified rather than unverified.",
  thorough:
    "A second path plus filter-sensitivity sweeps on every answer. Slower, and the most likely to refuse rather than pick for you.",
};

const STRICTNESS_NOTE: Record<Strictness, string> = {
  lenient:
    "Only failures are surfaced. Warnings are recorded in the evidence but do not qualify the answer.",
  standard:
    "A warning qualifies the answer and its caveat is shown beside the figure.",
  strict:
    "A warning qualifies the answer and a failed required check refuses it outright.",
};

export function ModelSection({
  role,
  demo,
}: {
  role: SpecRole;
  demo: DemoState;
}) {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  const [provider, setProvider] = React.useState("");
  const [model, setModel] = React.useState("");
  const [speed, setSpeed] = React.useState<Speed>("balanced");
  const [strictness, setStrictness] = React.useState<Strictness>("standard");
  const [ceiling, setCeiling] = React.useState("");
  const [policy, setPolicy] = React.useState<Record<string, PolicyState>>({});
  const [saved, setSaved] = React.useState(false);
  const [policyDirty, setPolicyDirty] = React.useState(false);

  const seed = React.useCallback((s: Settings) => {
    setProvider(s.model_provider);
    setModel(s.model);
    setSpeed(s.model_speed);
    setStrictness(s.verification_strictness);
    setCeiling(String(s.cost_ceiling_usd));
    setPolicy(
      Object.fromEntries(
        s.check_policy.map((p) => [
          p.id,
          { mode: p.mode, threshold: p.threshold },
        ]),
      ),
    );
    setPolicyDirty(false);
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
        const s = await getSettings();
        if (!alive) return;
        setSettings(s);
        seed(s);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The model settings did not load.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads, seed]);

  if (!canOpen("model", role))
    return <PermissionEmpty section="model" role={role} />;
  if (demo === "error" || error)
    return (
      <SectionError
        section="model"
        message={
          demo === "error"
            ? "The model configuration could not be read. Answers continue to run on the last configuration the service accepted."
            : (error as string)
        }
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  if (demo === "loading" || !settings) return <SectionSkeleton rows={4} />;

  const editable = canEdit(role);
  const providers = PROVIDERS.includes(settings.model_provider)
    ? PROVIDERS
    : [settings.model_provider, ...PROVIDERS];

  const dirty =
    policyDirty ||
    provider !== settings.model_provider ||
    model !== settings.model ||
    speed !== settings.model_speed ||
    strictness !== settings.verification_strictness ||
    ceiling !== String(settings.cost_ceiling_usd);

  return (
    <SectionShell section="model">
      <div className="space-y-4">
        <Group title="Provider">
          <div className="space-y-4">
            <Field label="Provider">
              <Select
                value={provider}
                disabled={!editable}
                ariaLabel="Model provider"
                onChange={(v) => {
                  setProvider(v);
                  setSaved(false);
                }}
                options={providers.map((p) => ({ value: p, label: p }))}
                className="max-w-[220px]"
              />
            </Field>
            <Field
              label="Model"
              hint="Passed through to the provider exactly as written. An unknown id fails at the first question, not silently."
            >
              <Input
                value={model}
                disabled={!editable}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSaved(false);
                }}
                className="max-w-[320px] font-mono text-mono-sm"
              />
            </Field>
          </div>
        </Group>

        <Group title="How hard to work">
          <div className="space-y-4">
            <Field label="Speed">
              <Segmented<Speed>
                value={speed}
                onChange={(v) => {
                  setSpeed(v);
                  setSaved(false);
                }}
                options={[
                  { value: "fast", label: "Fast" },
                  { value: "balanced", label: "Balanced" },
                  { value: "thorough", label: "Thorough" },
                ]}
              />
              <p className="mt-2 max-w-[70ch] text-ui-sm text-secondary">
                {SPEED_NOTE[speed]}
              </p>
            </Field>
            <Field label="Strictness">
              <Segmented<Strictness>
                value={strictness}
                onChange={(v) => {
                  setStrictness(v);
                  setSaved(false);
                }}
                options={[
                  { value: "lenient", label: "Lenient" },
                  { value: "standard", label: "Standard" },
                  { value: "strict", label: "Strict" },
                ]}
              />
              <p className="mt-2 max-w-[70ch] text-ui-sm text-secondary">
                {STRICTNESS_NOTE[strictness]}
              </p>
            </Field>
            <Field
              label="Cost ceiling"
              hint="Per answer. An answer that would exceed this stops and reports what it spent and how far it got, rather than returning a cheaper number."
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="text-ui text-tertiary">$</span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={ceiling}
                  disabled={!editable}
                  aria-label="Per-answer cost ceiling in dollars"
                  onChange={(e) => {
                    setCeiling(e.target.value);
                    setSaved(false);
                  }}
                  className="w-[110px] text-right tabular"
                />
              </span>
            </Field>
          </div>
        </Group>

        <Group
          title="Check policy"
          hint="Which checks must pass before an answer counts as verified, which only annotate it, and the thresholds each one uses."
        >
          <CheckPolicyTable
            policies={settings.check_policy}
            state={policy}
            editable={editable}
            onChange={(id, next) => {
              setPolicy((cur) => ({ ...cur, [id]: next }));
              setPolicyDirty(true);
              setSaved(false);
            }}
          />
        </Group>
      </div>

      {editable ? (
        <SaveRow
          dirty={dirty}
          saved={saved}
          note="Applies to answers run from now on. Recorded answers keep the policy they were checked under."
          onSave={() => {
            setSettings({
              ...settings,
              model_provider: provider,
              model,
              model_speed: speed,
              verification_strictness: strictness,
              cost_ceiling_usd: Number(ceiling) || 0,
              check_policy: settings.check_policy.map((p) => ({
                ...p,
                mode: policy[p.id]?.mode ?? p.mode,
                threshold: policy[p.id]?.threshold ?? p.threshold,
              })),
            });
            setPolicyDirty(false);
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
