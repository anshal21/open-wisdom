import { BACKEND_ORIGIN } from "@/lib/api/config";

export const dynamic = "force-dynamic";

/**
 * Same-origin proxy to the backend. The browser never talks to :8080 directly,
 * which removes CORS from the picture and keeps SSE on one origin.
 *
 * Headers are forwarded wholesale and only the few that must be replaced are
 * stripped — never an allowlist.
 */
const STRIP = new Set(["host", "connection", "content-length"]);

async function forward(req: Request, path: string[]) {
  const url = new URL(req.url);
  const target = `${BACKEND_ORIGIN}/api/v1/${path.join("/")}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) headers.set(key, value);
  });

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // @ts-expect-error — required by undici when streaming a request body
      duplex: "half",
      cache: "no-store",
    });

    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(res.body, { status: res.status, headers: out });
  } catch {
    return Response.json(
      {
        error: {
          code: "source_unreachable",
          message: `Can't reach the analyst service at ${BACKEND_ORIGIN}.`,
        },
      },
      { status: 503 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PUT(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PATCH(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
