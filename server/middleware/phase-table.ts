import { ladderResponse, proxyPhase, shouldProxyPhase } from "../../scripts/phase-table.mjs";

interface PhaseEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

function requestHost(event: PhaseEvent): string {
  return (
    event.req.headers.get("x-forwarded-host") ??
    event.req.headers.get("host") ??
    event.url.host
  );
}

export default async function phaseTableMiddleware(
  event: PhaseEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (event.url.searchParams.get("install") === "1") return next();
  const method = (event.req.method ?? "GET").toUpperCase();
  const path = event.url.pathname;

  if (path.startsWith("/__ladder")) {
    let raw = "";
    if (method === "POST") {
      const req = event.req as { text?: () => Promise<string> };
      if (typeof req.text === "function") raw = await req.text();
    }
    const out = await ladderResponse(method, path, raw);
    if (!out) return next();
    return new Response(typeof out.body === "string" ? out.body : out.body, {
      status: out.status,
      headers: out.headers as Record<string, string>,
    });
  }

  if ((method !== "GET" && method !== "HEAD") || !shouldProxyPhase(path)) return next();

  try {
    const out = await proxyPhase(path + event.url.search, requestHost(event));
    return new Response(out.body as BodyInit, {
      status: out.status,
      headers: out.headers as Record<string, string>,
    });
  } catch (err) {
    console.error("[phase-table]", err);
    return next();
  }
}
