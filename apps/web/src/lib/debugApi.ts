export type ApiDebugResult = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  durationMs: number;
  contentType: string | null;
  bodyText: string;
  bodyJson: unknown | null;
};

const PROXY_ENDPOINT = "/api/debug/proxy";

function normalizePath(path: string): string {
  const trimmed = path.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!withSlash.startsWith("/api/")) {
    throw new Error("Only paths under /api/ are allowed.");
  }
  if (withSlash.length > 512) {
    throw new Error("Path too long.");
  }
  if (/[\r\n]/.test(withSlash)) {
    throw new Error("Invalid path.");
  }
  return withSlash;
}

/**
 * Performs an API request for debugging via the server-side proxy. The proxy re-issues the request
 * with the caller's session and redacts secrets (API keys, tokens, passwords) from the body before
 * returning it, so the raw key never reaches the browser — masking here is not just cosmetic.
 */
export async function fetchApiDebug(path: string, init?: RequestInit): Promise<ApiDebugResult> {
  const url = normalizePath(path);
  const method = (init?.method ?? "GET").toUpperCase();
  const rawBody = init?.body;
  const t0 = performance.now();
  const res = await fetch(PROXY_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: url,
      method: method === "POST" ? "POST" : "GET",
      ...(method === "POST" && typeof rawBody === "string" ? { body: rawBody } : {}),
    }),
  });
  const durationMs = Math.round(performance.now() - t0);

  const proxyContentType = res.headers.get("content-type");
  const proxyText = await res.text();

  // The proxy itself returns JSON envelope { status, ok, contentType, bodyText, bodyJson }. If the
  // proxy request failed (e.g. 401/403/400 from the proxy route), surface that directly.
  if (!res.ok || !proxyContentType?.includes("application/json")) {
    return {
      url,
      method,
      status: res.status,
      ok: false,
      durationMs,
      contentType: proxyContentType,
      bodyText: proxyText,
      bodyJson: null,
    };
  }

  let envelope: Partial<ApiDebugResult> & { status?: number; ok?: boolean } = {};
  try {
    envelope = JSON.parse(proxyText) as typeof envelope;
  } catch {
    envelope = {};
  }

  return {
    url,
    method,
    status: envelope.status ?? res.status,
    ok: envelope.ok ?? false,
    durationMs,
    contentType: envelope.contentType ?? null,
    bodyText: envelope.bodyText ?? "",
    bodyJson: envelope.bodyJson ?? null,
  };
}
