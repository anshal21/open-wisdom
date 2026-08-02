import { NextResponse } from "next/server";
import { BACKEND_ORIGIN } from "@/lib/api/config";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for the transport selector. The contract has no health
 * endpoint, so we probe a cheap read (`GET /sources`) instead.
 */
export async function GET() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 900);
    const res = await fetch(`${BACKEND_ORIGIN}/api/v1/sources`, {
      signal: ctl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    return NextResponse.json({ up: res.ok, origin: BACKEND_ORIGIN });
  } catch {
    return NextResponse.json({ up: false, origin: BACKEND_ORIGIN });
  }
}
