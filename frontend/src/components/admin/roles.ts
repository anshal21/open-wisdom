import type { User } from "@/lib/api/types";
import type { SectionId } from "./sections";

/**
 * screens.md §11 names four roles. The wire carries three (`admin | analyst |
 * viewer`), so Owner is a client-side derivation: exactly one workspace owner,
 * taken as the first admin the API returns. Nothing is smuggled onto the wire.
 *
 * **Ratification is a permission.** That is what makes a ratified definition
 * mean something, so it is a visible column, not a footnote.
 */

export type SpecRole = "owner" | "admin" | "editor" | "viewer";

export interface RoleMeta {
  id: SpecRole;
  label: string;
  canRatify: boolean;
  description: string;
}

export const ROLES: RoleMeta[] = [
  {
    id: "owner",
    label: "Owner",
    canRatify: true,
    description:
      "Full control, including billing, connecting sources and the check policy. One per workspace.",
  },
  {
    id: "admin",
    label: "Admin",
    canRatify: true,
    description: "Everything an Owner can do except billing and transferring ownership.",
  },
  {
    id: "editor",
    label: "Editor",
    canRatify: true,
    description:
      "Can ask, and can ratify a definition — which makes it the default reading for everyone.",
  },
  {
    id: "viewer",
    label: "Viewer",
    canRatify: false,
    description: "Can ask and read every answer and its evidence. Cannot ratify.",
  },
];

export const ROLE_BY_ID: Record<SpecRole, RoleMeta> = Object.fromEntries(
  ROLES.map((r) => [r.id, r]),
) as Record<SpecRole, RoleMeta>;

/**
 * Who is at the keyboard. There is no auth in this build: the workspace is
 * local and single-seat, so the caller is its owner — the first admin when one
 * exists, the first user otherwise, and the implicit owner of an empty
 * workspace. Never resolve against a fixture id: live ids are generated and a
 * hardcoded match locks every real workspace to Viewer.
 */
export function resolveCurrentUser(users: User[]): { user: User | null; role: SpecRole } {
  const user = users.find((u) => u.role === "admin") ?? users[0] ?? null;
  if (!user) return { user: null, role: "owner" };
  return { user, role: assignRoles(users)[user.id] ?? "owner" };
}

/** The first admin the API returns is the workspace owner. */
export function assignRoles(users: User[]): Record<string, SpecRole> {
  const ownerId = users.find((u) => u.role === "admin")?.id;
  const out: Record<string, SpecRole> = {};
  for (const u of users) {
    out[u.id] =
      u.id === ownerId
        ? "owner"
        : u.role === "admin"
          ? "admin"
          : u.role === "analyst"
            ? "editor"
            : "viewer";
  }
  return out;
}

/** Which roles may open which section. Denied roles get a role-specific empty. */
export const SECTION_ACCESS: Record<SectionId, SpecRole[]> = {
  workspace: ["owner", "admin"],
  members: ["owner", "admin", "editor", "viewer"],
  access: ["owner", "admin"],
  model: ["owner", "admin"],
  audit: ["owner", "admin"],
  usage: ["owner", "admin", "editor", "viewer"],
};

export function canOpen(section: SectionId, role: SpecRole): boolean {
  return SECTION_ACCESS[section].includes(role);
}

/** Editing anything in settings is an Owner/Admin action. */
export function canEdit(role: SpecRole): boolean {
  return role === "owner" || role === "admin";
}
