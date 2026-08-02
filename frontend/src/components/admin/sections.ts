/**
 * Admin sections — screens.md §11. `/settings` redirects to the first one.
 */

export const SECTION_IDS = [
  "workspace",
  "members",
  "access",
  "model",
  "audit",
  "usage",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionMeta {
  id: SectionId;
  label: string;
  /** One line under the section title. States what the section governs. */
  description: string;
}

export const SECTIONS: SectionMeta[] = [
  {
    id: "workspace",
    label: "Workspace",
    description: "Name, the source questions default to, the time zone every date bucket uses.",
  },
  {
    id: "members",
    label: "Members",
    description: "Who is in the workspace, what they can do, and who can ratify.",
  },
  {
    id: "access",
    label: "Access",
    description: "What each role can query, the credential it executes under, and how personal data is exposed.",
  },
  {
    id: "model",
    label: "Model",
    description: "The model behind answers, what an answer may cost, and which checks are required.",
  },
  {
    id: "audit",
    label: "Audit",
    description: "Every query this workspace has issued, with its principal and its answer.",
  },
  {
    id: "usage",
    label: "Usage",
    description: "Questions asked, answers verified, fork rate and coverage — over time and per person.",
  },
];

export const SECTION_BY_ID: Record<SectionId, SectionMeta> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, SectionMeta>;

export function isSectionId(v: string | undefined): v is SectionId {
  return SECTION_IDS.includes(v as SectionId);
}
