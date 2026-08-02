import type { Check, Definition } from "@/lib/api/types";
import type { EvidenceSubject } from "@/state/evidence";
import { tally } from "@/lib/confidence";
import { formatAbsolute, formatCount } from "@/lib/format";

/**
 * A definition is not an answer, so it carries no run checks. What it does
 * carry is a ratification record and, sometimes, a detected overlap — and both
 * of those are exactly two of the checks in the taxonomy (§3.4). Every string
 * below is read off the definition record; nothing is invented.
 */
export function definitionEvidence(
  def: Definition,
  ratifierName?: string,
): EvidenceSubject {
  const checks: Check[] = [];

  if (def.status === "ratified" && def.ratified_at) {
    checks.push({
      id: "definition_source",
      label: "Uses a ratified definition",
      status: "pass",
      finding: `${def.name} v${def.version} — ratified by ${
        ratifierName ?? "a workspace member"
      }, ${formatAbsolute(def.ratified_at, false)}`,
    });
  } else {
    checks.push({
      id: "definition_source",
      label: "Uses a ratified definition",
      status: "fail",
      finding: `No ratified reading of "${def.name}". It has been used ${formatCount(
        def.usage_count,
      )} times without one.`,
    });
  }

  for (const conflict of def.conflicts ?? []) {
    checks.push({
      id: "precedent",
      label: "Consistent with what we said before",
      status: "fail",
      finding: conflict.reason,
    });
  }

  const { passed, total } = tally(checks);
  const conflict = def.conflicts?.[0];

  return {
    id: def.id,
    label: `definition · ${def.name}`,
    title: def.name,
    state: def.confidence,
    headline: conflict?.reason ?? def.plain_english ?? undefined,
    checks,
    passed,
    total,
    definitions: [
      {
        id: def.id,
        name: def.name,
        version: def.version,
        ratifiedBy: ratifierName,
        ratifiedAt: def.ratified_at ?? undefined,
        inferred: def.status !== "ratified",
      },
    ],
  };
}
