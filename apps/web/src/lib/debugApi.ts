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
 * Performs a same-origin API request and returns the full response for debugging (including non-2xx bodies).
 */
export async function fetchApiDebug(path: string, init?: RequestInit): Promise<ApiDebugResult> {
  const url = normalizePath(path);
  const method = (init?.method ?? "GET").toUpperCase();
  const t0 = performance.now();
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(method !== "GET" && method !== "HEAD" ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const durationMs = Math.round(performance.now() - t0);
  const contentType = res.headers.get("content-type");
  const bodyText = await res.text();
  let bodyJson: unknown | null = null;
  if (contentType?.includes("application/json")) {
    try {
      bodyJson = JSON.parse(bodyText) as unknown;
    } catch {
      bodyJson = null;
    }
  }
  return {
    url,
    method,
    status: res.status,
    ok: res.ok,
    durationMs,
    contentType,
    bodyText,
    bodyJson,
  };
}
