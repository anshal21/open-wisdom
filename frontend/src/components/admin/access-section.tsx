"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import type { Settings, Source } from "@/lib/api/types";
import { ApiFailure, getSettings, getSources } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { Input, RadioRow } from "@/components/ui/primitives";
import type { DemoState } from "./demo";
import { canEdit, canOpen, ROLES, ROLE_BY_ID, type SpecRole } from "./roles";
import {
  Group,
  PermissionEmpty,
  SaveRow,
  SectionError,
  SectionShell,
  SectionSkeleton,
} from "./section-frame";

/**
 * Which sources a role may query, and the credential it executes under, are not
 * on the wire (contract §12 carries only `pii_masked`). They are modelled here
 * as a client-side derivation seeded from the sources the API returns — no
 * field is smuggled onto the wire.
 */

type AnswerPolicy = "excluded" | "on_request";
type SamplePolicy = "masked" | "privileged";

interface RoleAccess {
  sources: string[];
  credential: string;
}

function seedAccess(sources: Source[]): Record<SpecRole, RoleAccess> {
  const all = sources.map((s) => s.id);
  const first = all.slice(0, 1);
  return {
    owner: { sources: all, credential: "analytics_admin" },
    admin: { sources: all, credential: "analytics_admin" },
    editor: { sources: all, credential: "analytics_ro" },
    viewer: { sources: first, credential: "analytics_ro" },
  };
}

export function AccessSection({
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

  const [access, setAccess] = React.useState<Record<
    SpecRole,
    RoleAccess
  > | null>(null);
  const [answerPolicy, setAnswerPolicy] =
    React.useState<AnswerPolicy>("excluded");
  const [samplePolicy, setSamplePolicy] =
    React.useState<SamplePolicy>("masked");
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

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
        setAccess(seedAccess(list));
        setSamplePolicy(s.pii_masked ? "masked" : "privileged");
        setAnswerPolicy("excluded");
        setDirty(false);
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The access policy did not load.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads]);

  if (!canOpen("access", role))
    return <PermissionEmpty section="access" role={role} />;
  if (demo === "error" || error)
    return (
      <SectionError
        section="access"
        message={
          demo === "error"
            ? "The access policy could not be read from the settings service."
            : (error as string)
        }
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  if (demo === "loading" || !settings || !access)
    return <SectionSkeleton rows={5} />;

  const editable = canEdit(role);

  const toggleSource = (r: SpecRole, sourceId: string) => {
    setAccess((cur) => {
      if (!cur) return cur;
      const has = cur[r].sources.includes(sourceId);
      return {
        ...cur,
        [r]: {
          ...cur[r],
          sources: has
            ? cur[r].sources.filter((s) => s !== sourceId)
            : [...cur[r].sources, sourceId],
        },
      };
    });
    setDirty(true);
    setSaved(false);
  };

  const piiLabel = (r: SpecRole): string => {
    if (answerPolicy === "excluded") {
      return samplePolicy === "privileged" && (r === "owner" || r === "admin")
        ? "Excluded from answers · unmasked in samples"
        : "Excluded from answers · masked in samples";
    }
    return samplePolicy === "privileged" && (r === "owner" || r === "admin")
      ? "Readable when the question names them"
      : "Readable when named · masked in samples";
  };

  return (
    <SectionShell section="access">
      <div className="space-y-4">
        <Group
          title="What each role can query"
          hint="A role can only reach a source that is switched on here. Everything else is invisible to it — not refused at query time, but absent from the schema it can see."
        >
          <div className="overflow-hidden rounded-lg border border-border-default">
            <table className="w-full border-collapse text-ui">
              <thead className="bg-surface-2">
                <tr className="h-9 border-b border-border-default">
                  <th
                    scope="col"
                    className="px-3 text-left text-label text-tertiary uppercase"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="px-3 text-left text-label text-tertiary uppercase"
                  >
                    Can query
                  </th>
                  <th
                    scope="col"
                    className="px-3 text-left text-label text-tertiary uppercase"
                  >
                    Executes under
                  </th>
                  <th
                    scope="col"
                    className="px-3 text-left text-label text-tertiary uppercase"
                  >
                    Personal data
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border-subtle last:border-0"
                  >
                    <td className="px-3 py-2 align-top">
                      <span className="text-ui font-medium text-primary">
                        {r.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1.5">
                        {sources.map((s) => {
                          const on = access[r.id].sources.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={!editable}
                              aria-pressed={on}
                              onClick={() => toggleSource(r.id, s.id)}
                              className={cn(
                                "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-ui-sm transition-colors duration-100",
                                on
                                  ? "border-border-accent bg-accent-tint text-accent"
                                  : "border-border-default bg-surface-1 text-tertiary",
                                editable && "hover:border-border-hover",
                                !editable && "cursor-not-allowed",
                              )}
                            >
                              {on ? (
                                <Check
                                  size={11}
                                  strokeWidth={2.5}
                                  aria-hidden="true"
                                />
                              ) : (
                                <Minus
                                  size={11}
                                  strokeWidth={2.5}
                                  aria-hidden="true"
                                />
                              )}
                              {s.name}
                            </button>
                          );
                        })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={access[r.id].credential}
                        disabled={!editable}
                        aria-label={`Credential for ${r.label}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAccess((cur) =>
                            cur
                              ? {
                                  ...cur,
                                  [r.id]: { ...cur[r.id], credential: v },
                                }
                              : cur,
                          );
                          setDirty(true);
                          setSaved(false);
                        }}
                        className="max-w-[180px] font-mono text-mono-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-ui-sm text-secondary">
                      {piiLabel(r.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-[74ch] text-ui-sm text-tertiary">
            Every query is issued under the credential shown here, never under
            the asker&apos;s own. The audit record keeps both: the person who
            asked and the credential the warehouse saw.
          </p>
        </Group>

        <Group
          id="pii"
          title="Personal data"
          hint="Columns the introspection detected as personal data carry a pii badge in the schema browser, and this is the policy that badge links to."
        >
          <fieldset>
            <legend className="text-ui font-medium text-secondary">
              In answers
            </legend>
            <div className="mt-1.5 space-y-0.5">
              <RadioRow
                name="pii-answers"
                value="excluded"
                checked={answerPolicy === "excluded"}
                onChange={(v) => {
                  setAnswerPolicy(v as AnswerPolicy);
                  setDirty(true);
                  setSaved(false);
                }}
                label="Excluded by default"
                description="Personal-data columns are not read, grouped by, or returned unless this policy is changed."
              />
              <RadioRow
                name="pii-answers"
                value="on_request"
                checked={answerPolicy === "on_request"}
                onChange={(v) => {
                  setAnswerPolicy(v as AnswerPolicy);
                  setDirty(true);
                  setSaved(false);
                }}
                label="Readable when the question names them"
                description="An answer may use a personal-data column if the question asks for it. The column is named in the answer's evidence."
              />
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-ui font-medium text-secondary">
              In sample rows and exports
            </legend>
            <div className="mt-1.5 space-y-0.5">
              <RadioRow
                name="pii-samples"
                value="masked"
                checked={samplePolicy === "masked"}
                onChange={(v) => {
                  setSamplePolicy(v as SamplePolicy);
                  setDirty(true);
                  setSaved(false);
                }}
                label="Masked for everyone"
                description="Values render as dots in the schema browser and in any export."
              />
              <RadioRow
                name="pii-samples"
                value="privileged"
                checked={samplePolicy === "privileged"}
                onChange={(v) => {
                  setSamplePolicy(v as SamplePolicy);
                  setDirty(true);
                  setSaved(false);
                }}
                label="Unmasked for Owners and Admins"
                description="Show unmasked appears in the schema browser for those roles only. Every unmask is recorded in the audit."
              />
            </div>
          </fieldset>

          <p className="mt-4 max-w-[74ch] text-ui-sm text-tertiary">
            {ROLE_BY_ID[role].label}s currently{" "}
            {samplePolicy === "privileged" &&
            (role === "owner" || role === "admin")
              ? "can unmask sample rows."
              : "cannot unmask sample rows."}
          </p>
        </Group>
      </div>

      {editable ? (
        <SaveRow
          dirty={dirty}
          saved={saved}
          onSave={() => {
            setSettings({ ...settings, pii_masked: samplePolicy === "masked" });
            setDirty(false);
            setSaved(true);
          }}
          onReset={() => {
            setAccess(seedAccess(sources));
            setSamplePolicy(settings.pii_masked ? "masked" : "privileged");
            setAnswerPolicy("excluded");
            setDirty(false);
            setSaved(false);
          }}
        />
      ) : null}
    </SectionShell>
  );
}
