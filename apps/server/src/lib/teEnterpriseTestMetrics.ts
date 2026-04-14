import { teFetch, teFetchAbsolute, type TeAccountScope } from "./thousandEyesClient.js";

export type TeMetricPoint = { t: string; v: number | null };

/** Max TE result pages per request (each page = one API call). Lower = fewer 429 risks; chart still spans the window. */
export const TE_TEST_RESULTS_MAX_PAGES = Math.min(
  40,
  Math.max(4, Number.parseInt(process.env.TE_TEST_RESULTS_MAX_PAGES ?? "12", 10) || 12),
);

/** Stop accumulating rows after this many (defense in depth vs huge tests). */
const TE_TEST_RESULTS_MAX_ROWS = Math.min(
  25_000,
  Math.max(2000, Number.parseInt(process.env.TE_TEST_RESULTS_MAX_ROWS ?? "6000", 10) || 6000),
);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Map TE test `type` from snapshot to Test Results API resource segment (v7). */
export function teTestResultsResourceForType(testType: string): string {
  const t = testType.trim().toLowerCase();
  if (t === "agent-to-server" || t === "agent-to-agent") {
    return "network";
  }
  if (t === "page-load") {
    return "page-load";
  }
  if (t === "api") {
    return "api";
  }
  if (t.includes("http")) {
    return "http-server";
  }
  return "network";
}

function timespanToWindowParam(timespanSec: number): string {
  const capped = Math.min(Math.max(300, timespanSec), 7 * 24 * 3600);
  if (capped >= 24 * 3600) {
    const d = Math.max(1, Math.round(capped / (24 * 3600)));
    return `${d}d`;
  }
  if (capped >= 3600) {
    const h = Math.max(1, Math.round(capped / 3600));
    return `${h}h`;
  }
  const m = Math.max(1, Math.round(capped / 60));
  return `${m}m`;
}

function normalizeTePaginationTarget(href: string): string {
  const h = href.trim();
  if (h.startsWith("http")) {
    return h;
  }
  if (h.startsWith("/v7")) {
    return h.slice(3) || "/";
  }
  return h.startsWith("/") ? h : `/${h}`;
}

async function fetchAllResultRows(
  token: string,
  testId: string,
  resource: string,
  windowStr: string,
  scope?: TeAccountScope,
): Promise<unknown[]> {
  const qs = new URLSearchParams();
  qs.set("window", windowStr);
  const a = scope?.aid?.trim();
  if (a) {
    qs.set("aid", a);
  }
  let path: string | null = `/test-results/${encodeURIComponent(testId)}/${resource}?${qs.toString()}`;
  const out: unknown[] = [];
  let pages = 0;
  while (path && pages < TE_TEST_RESULTS_MAX_PAGES && out.length < TE_TEST_RESULTS_MAX_ROWS) {
    pages += 1;
    const data: Record<string, unknown> = path.startsWith("http")
      ? await teFetchAbsolute<Record<string, unknown>>(token, path)
      : await teFetch<Record<string, unknown>>(token, path);
    const batch = Array.isArray(data.results) ? data.results : [];
    out.push(...batch);
    const links = data._links;
    if (!isRecord(links)) {
      break;
    }
    const next = links.next;
    if (!isRecord(next) || typeof next.href !== "string") {
      break;
    }
    const raw = next.href.trim();
    path = raw === "" ? null : normalizeTePaginationTarget(raw);
  }
  return out;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) {
    return null;
  }
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Group TE network-style rows (per agent per round) into one point per round. */
export function aggregateNetworkLikeResults(rows: unknown[]): {
  latencyMs: TeMetricPoint[];
  lossPercent: TeMetricPoint[];
} {
  type Bucket = { lat: number[]; loss: number[]; date?: string };
  const byRound = new Map<number, Bucket>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const ridRaw = row.roundId;
    const rid =
      typeof ridRaw === "number" && Number.isFinite(ridRaw)
        ? ridRaw
        : typeof ridRaw === "string"
          ? Number.parseInt(ridRaw, 10)
          : NaN;
    if (!Number.isFinite(rid)) {
      continue;
    }
    const latRaw = row.avgLatency;
    const lossRaw = row.loss;
    const lat = typeof latRaw === "number" && Number.isFinite(latRaw) ? latRaw : null;
    const loss = typeof lossRaw === "number" && Number.isFinite(lossRaw) ? lossRaw : null;
    const date = typeof row.date === "string" ? row.date : undefined;
    let b = byRound.get(rid);
    if (!b) {
      b = { lat: [], loss: [], date };
      byRound.set(rid, b);
    } else if (date && !b.date) {
      b.date = date;
    }
    if (lat != null) {
      b.lat.push(lat);
    }
    if (loss != null) {
      b.loss.push(loss);
    }
  }
  const sorted = [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  const latencyMs: TeMetricPoint[] = sorted.map(([rid, b]) => ({
    t: b.date && b.date.trim() !== "" ? b.date : new Date(rid * 1000).toISOString(),
    v: mean(b.lat),
  }));
  const lossPercent: TeMetricPoint[] = sorted.map(([rid, b]) => ({
    t: b.date && b.date.trim() !== "" ? b.date : new Date(rid * 1000).toISOString(),
    v: mean(b.loss),
  }));
  return { latencyMs, lossPercent };
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return null;
}

/** HTTP / API / page-load style rows: latency from timing fields; loss when present. */
export function aggregateHttpLikeResults(rows: unknown[]): {
  latencyMs: TeMetricPoint[];
  lossPercent: TeMetricPoint[];
} {
  type Bucket = { lat: number[]; loss: number[]; date?: string };
  const byRound = new Map<number, Bucket>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const ridRaw = row.roundId;
    const rid =
      typeof ridRaw === "number" && Number.isFinite(ridRaw)
        ? ridRaw
        : typeof ridRaw === "string"
          ? Number.parseInt(ridRaw, 10)
          : NaN;
    if (!Number.isFinite(rid)) {
      continue;
    }
    const lat =
      firstNumber(row, [
        "responseTime",
        "totalTime",
        "waitTime",
        "avgLatency",
        "connectTime",
        "receiveTime",
        "dnsTime",
      ]) ?? null;
    const loss = firstNumber(row, ["loss", "errorPercentage", "transactionErrorPercentage"]) ?? null;
    const date = typeof row.date === "string" ? row.date : undefined;
    let b = byRound.get(rid);
    if (!b) {
      b = { lat: [], loss: [], date };
      byRound.set(rid, b);
    } else if (date && !b.date) {
      b.date = date;
    }
    if (lat != null) {
      b.lat.push(lat);
    }
    if (loss != null) {
      b.loss.push(loss);
    }
  }
  const sorted = [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  const latencyMs: TeMetricPoint[] = sorted.map(([rid, b]) => ({
    t: b.date && b.date.trim() !== "" ? b.date : new Date(rid * 1000).toISOString(),
    v: mean(b.lat),
  }));
  const lossPercent: TeMetricPoint[] = sorted.map(([rid, b]) => ({
    t: b.date && b.date.trim() !== "" ? b.date : new Date(rid * 1000).toISOString(),
    v: b.loss.length > 0 ? mean(b.loss) : null,
  }));
  return { latencyMs, lossPercent };
}

export async function fetchEnterpriseTestLatencyLossSeries(
  token: string,
  testId: string,
  testType: string,
  timespanSec: number,
  scope?: TeAccountScope,
): Promise<{
  latencyMs: TeMetricPoint[];
  lossPercent: TeMetricPoint[];
  resource: string;
  window: string;
}> {
  const resource = teTestResultsResourceForType(testType);
  const windowStr = timespanToWindowParam(timespanSec);
  const rows = await fetchAllResultRows(token, testId, resource, windowStr, scope);
  if (resource === "network") {
    return { ...aggregateNetworkLikeResults(rows), resource, window: windowStr };
  }
  return { ...aggregateHttpLikeResults(rows), resource, window: windowStr };
}
