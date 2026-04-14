/**
 * In-memory ring buffer of outbound HTTP calls from this server to external APIs (Meraki, ThousandEyes,
 * OpenWeather, etc.) for operator troubleshooting. Not persisted; capped size; secrets redacted in logs.
 */

export type OutboundProvider = "meraki" | "thousandeyes" | "openweather" | string;

export type OutboundTraceEntry = {
  id: string;
  ts: string;
  provider: OutboundProvider;
  method: string;
  /** URL with query secrets redacted; optional note after · */
  urlDisplay: string;
  status: number | null;
  durationMs: number;
  ok: boolean;
  errorMessage?: string;
  /** Present when HTTP status indicates failure */
  responsePreview?: string;
};

const MAX_ENTRIES = 250;
const buffer: OutboundTraceEntry[] = [];
let seq = 0;

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["appid", "apikey", "api_key", "access_token"]) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, "***");
      }
    }
    let s = u.toString();
    if (s.length > 700) {
      s = `${s.slice(0, 697)}...`;
    }
    return s;
  } catch {
    return url
      .slice(0, 500)
      .replace(/([?&](?:appid|apikey|api_key|access_token)=)[^&]*/gi, "$1***");
  }
}

function sanitizeBodySnippet(text: string, max: number): string {
  return text
    .replace(/\bBearer\s+[\w.-]+\b/gi, "Bearer ***")
    .replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"***"')
    .replace(/([?&]appid=)[^&\s"']+/gi, "$1***")
    .slice(0, max);
}

function push(entry: Omit<OutboundTraceEntry, "id" | "ts">): void {
  const e: OutboundTraceEntry = {
    id: `${Date.now()}-${++seq}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  buffer.push(e);
  while (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

export function listOutboundTraces(): OutboundTraceEntry[] {
  return [...buffer].reverse();
}

export function clearOutboundTraces(): void {
  buffer.length = 0;
}

/**
 * Wraps `fetch` and records one trace row. On success, response body is not read. On !ok, clones and reads a short error snippet.
 */
export async function tracedFetch(
  url: string,
  init: RequestInit | undefined,
  meta: { provider: OutboundProvider; note?: string },
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  let urlDisplay = sanitizeUrl(url);
  if (meta.note) {
    urlDisplay = `${urlDisplay} · ${meta.note}`;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    const durationMs = Date.now() - t0;
    let responsePreview: string | undefined;
    if (!res.ok) {
      try {
        const t = await res.clone().text();
        responsePreview = sanitizeBodySnippet(t, 1500);
      } catch {
        responsePreview = "(unreadable error body)";
      }
    }
    push({
      provider: meta.provider,
      method,
      urlDisplay,
      status: res.status,
      durationMs,
      ok: res.ok,
      responsePreview,
    });
    return res;
  } catch (e) {
    const durationMs = Date.now() - t0;
    push({
      provider: meta.provider,
      method,
      urlDisplay,
      status: null,
      durationMs,
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
