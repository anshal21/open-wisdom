"use client";

import { useParams } from "next/navigation";
import { InvestigationDetail } from "@/components/investigations/investigation-detail";

export default function InvestigationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");
  // Keyed on the id so a route change resets every piece of surface state.
  return <InvestigationDetail key={id} id={id} />;
}
