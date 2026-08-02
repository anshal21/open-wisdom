"use client";

import { useParams } from "next/navigation";
import { WatchDetail } from "@/components/watches/watch-detail";

export default function WatchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");
  // Keyed on the id so a route change resets every piece of surface state.
  return <WatchDetail key={id} id={id} />;
}
