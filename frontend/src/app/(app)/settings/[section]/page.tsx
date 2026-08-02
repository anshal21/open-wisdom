"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Compass } from "lucide-react";
import type { User } from "@/lib/api/types";
import { getUsers } from "@/lib/api/client";
import { SurfaceBody } from "@/components/shell/app-shell";
import { SurfaceHeader } from "@/components/shell/surface-header";
import { AccessSection } from "@/components/admin/access-section";
import { AuditSection } from "@/components/admin/audit-section";
import { useDemoState } from "@/components/admin/demo";
import { MembersSection } from "@/components/admin/members-section";
import { ModelSection } from "@/components/admin/model-section";
import { resolveCurrentUser, ROLE_BY_ID, type SpecRole } from "@/components/admin/roles";
import { isSectionId, SECTION_BY_ID, SECTIONS } from "@/components/admin/sections";
import { SettingsNav } from "@/components/admin/settings-nav";
import { UsageSection } from "@/components/admin/usage-section";
import { WorkspaceSection } from "@/components/admin/workspace-section";

/** The person looking at the screen. */

export default function SettingsSectionPage() {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const params = useParams<{ section: string }>();
  const demo = useDemoState();

  const [me, setMe] = React.useState<User | null>(null);
  const [role, setRole] = React.useState<SpecRole>("owner");

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const users = await getUsers();
        if (!alive) return;
        const current = resolveCurrentUser(users);
        setMe(current.user);
        setRole(current.role);
      } catch {
        // The role gate fails closed: an unknown viewer sees the least.
        if (alive) setRole("viewer");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // `?demo=empty` views the whole surface as a Viewer, which is what a
  // role-specific empty state means here.
  const effectiveRole: SpecRole = demo === "empty" ? "viewer" : role;
  const sectionDemo = demo === "empty" ? null : demo;

  const raw = params.section;
  const valid = isSectionId(raw);
  const section = valid ? raw : null;

  return (
    <>
      <SurfaceHeader
        crumbs={[
          { label: "Settings", href: "/settings/workspace" },
          { label: section ? SECTION_BY_ID[section].label : "Not found" },
        ]}
        scrollRef={scrollRef}
        actions={
          me ? (
            <span className="text-ui-sm text-tertiary">
              Signed in as {me.name} · {ROLE_BY_ID[effectiveRole].label}
            </span>
          ) : null
        }
      />

      <SurfaceBody scrollRef={scrollRef}>
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <SettingsNav active={section} role={effectiveRole} />

          <div className="min-w-0 flex-1">
            {section === "workspace" ? (
              <WorkspaceSection role={effectiveRole} demo={sectionDemo} />
            ) : section === "members" ? (
              <MembersSection role={effectiveRole} demo={sectionDemo} />
            ) : section === "access" ? (
              <AccessSection role={effectiveRole} demo={sectionDemo} />
            ) : section === "model" ? (
              <ModelSection role={effectiveRole} demo={sectionDemo} />
            ) : section === "audit" ? (
              <AuditSection role={effectiveRole} demo={sectionDemo} />
            ) : section === "usage" ? (
              <UsageSection role={effectiveRole} demo={sectionDemo} />
            ) : (
              <UnknownSection name={raw} />
            )}
          </div>
        </div>
      </SurfaceBody>
    </>
  );
}

function UnknownSection({ name }: { name: string | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border-default bg-surface-1 px-6 py-16 text-center">
      <span className="mb-4 text-tertiary">
        <Compass size={20} strokeWidth={1.75} />
      </span>
      <h2 className="text-subtitle text-primary">
        There is no settings section called{" "}
        <span className="font-mono text-mono">{name ?? "—"}</span>
      </h2>
      <p className="mt-1.5 max-w-[48ch] text-ui-sm text-secondary">
        The link may be from an older build. These are the sections this workspace has.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            href={`/settings/${s.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-ui font-medium text-primary transition-colors duration-100 hover:bg-overlay-hover"
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
