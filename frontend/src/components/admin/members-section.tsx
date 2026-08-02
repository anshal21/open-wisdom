"use client";

import * as React from "react";
import type { User } from "@/lib/api/types";
import { ApiFailure, getUsers } from "@/lib/api/client";
import { formatCount, formatRelative, isoTitle } from "@/lib/format";
import { ShieldCheckFilled } from "@/components/seal/glyphs";
import { Avatar } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/table";
import { Select } from "./select";
import type { DemoState } from "./demo";
import {
  assignRoles,
  canEdit,
  canOpen,
  ROLES,
  ROLE_BY_ID,
  type SpecRole,
} from "./roles";
import {
  Group,
  PermissionEmpty,
  SectionError,
  SectionShell,
  SectionTableSkeleton,
} from "./section-frame";

export function MembersSection({
  role,
  demo,
}: {
  role: SpecRole;
  demo: DemoState;
}) {
  const [users, setUsers] = React.useState<User[] | null>(null);
  const [roles, setRoles] = React.useState<Record<string, SpecRole>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      // Reset inside the async body, not in the effect itself: a
      // synchronous set here commits a render purely to blank the
      // screen, then commits again the moment data arrives.
      setUsers(null);
      setError(null);
      try {
        const list = await getUsers();
        if (!alive) return;
        setUsers(list);
        setRoles(assignRoles(list));
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof ApiFailure
            ? err.message
            : "The member list did not load.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads]);

  const editable = canEdit(role);

  const columns: Column<User>[] = React.useMemo(
    () => [
      {
        key: "person",
        header: "Person",
        render: (u) => (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar initials={u.initials} size={20} />
            <span className="min-w-0">
              <span className="block truncate text-ui text-primary">
                {u.name}
              </span>
            </span>
            <span className="truncate text-ui-sm text-tertiary">{u.email}</span>
          </span>
        ),
      },
      {
        key: "role",
        header: "Role",
        width: "132px",
        render: (u) =>
          editable ? (
            <Select
              size="sm"
              value={roles[u.id] ?? "viewer"}
              ariaLabel={`Role for ${u.name}`}
              onChange={(v) => setRoles((r) => ({ ...r, [u.id]: v }))}
              options={ROLES.map((r) => ({ value: r.id, label: r.label }))}
            />
          ) : (
            <span className="text-ui text-secondary">
              {ROLE_BY_ID[roles[u.id] ?? "viewer"].label}
            </span>
          ),
      },
      {
        key: "ratify",
        header: "Can ratify",
        width: "116px",
        render: (u) => {
          const can = ROLE_BY_ID[roles[u.id] ?? "viewer"].canRatify;
          return can ? (
            <span className="inline-flex items-center gap-1.5 text-ui text-verified">
              <ShieldCheckFilled size={13} />
              Yes
            </span>
          ) : (
            <span className="text-ui text-tertiary">No</span>
          );
        },
      },
      {
        key: "last_active",
        header: "Last active",
        width: "148px",
        render: (u) => (
          <time
            dateTime={u.last_active_at}
            title={isoTitle(u.last_active_at)}
            className="text-ui text-secondary"
          >
            {formatRelative(u.last_active_at)}
          </time>
        ),
      },
      {
        key: "answers",
        header: "Answers asked",
        numeric: true,
        width: "128px",
        render: (u) => (
          <span className="text-secondary">{formatCount(u.answers_asked)}</span>
        ),
      },
    ],
    [editable, roles],
  );

  if (!canOpen("members", role))
    return <PermissionEmpty section="members" role={role} />;
  if (demo === "error" || error)
    return (
      <SectionError
        section="members"
        message={
          demo === "error"
            ? "The member list could not be read."
            : (error as string)
        }
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  if (demo === "loading" || !users) return <SectionTableSkeleton rows={5} />;

  const ratifiers = users.filter(
    (u) => ROLE_BY_ID[roles[u.id] ?? "viewer"].canRatify,
  ).length;

  return (
    <SectionShell section="members">
      <p className="mb-4 max-w-[74ch] text-ui-sm text-secondary">
        <span className="text-primary">Ratification is a permission.</span> A
        ratified definition becomes the default reading for everyone and carries
        the name of the person who ratified it — which is exactly why not
        everyone has it. {ratifiers} of {users.length} people here can ratify.
      </p>

      <DataTable
        columns={columns}
        rows={users}
        getKey={(u) => u.id}
        density="comfortable"
        empty={
          <p className="px-3 py-6 text-ui-sm text-tertiary">
            You are the only person in this workspace. Invite someone and they
            will appear here with the role you give them.
          </p>
        }
      />

      {!editable ? (
        <p className="mt-3 text-ui-sm text-tertiary">
          You can see who is in the workspace. Only an Owner or Admin can change
          a role.
        </p>
      ) : null}

      <Group title="What each role can do" className="mt-5">
        <dl className="space-y-2.5">
          {ROLES.map((r) => (
            <div
              key={r.id}
              className="grid gap-1 sm:grid-cols-[132px_1fr] sm:gap-4"
            >
              <dt className="flex items-center gap-1.5 text-ui font-medium text-primary">
                {r.label}
                {r.canRatify ? (
                  <ShieldCheckFilled size={12} className="text-verified" />
                ) : null}
              </dt>
              <dd className="text-ui-sm text-secondary">{r.description}</dd>
            </div>
          ))}
        </dl>
      </Group>
    </SectionShell>
  );
}
