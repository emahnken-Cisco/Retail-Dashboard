/**
 * In-memory TTL cache for ThousandEyes enterprise test metrics (dashboard uplink sidecar).
 * Reduces repeated TE API pagination when users reopen the same test/window.
 */

export type TeEnterpriseMetricsCacheEntry = {
  testId: string;
  testName: string;
  testType: string;
  timespanSeconds: number;
  teWindow: string;
  teResource: string;
  latencyMs: Array<{ t: string; v: number | null }>;
  lossPercent: Array<{ t: string; v: number | null }>;
};

/** Default 2 minutes — enough to avoid hammering TE on navigation; metrics stay “live enough” for charts. */
const TTL_MS = Number.parseInt(process.env.TE_ENTERPRISE_METRICS_CACHE_TTL_MS ?? "120000", 10) || 120_000;

const MAX_ENTRIES = Number.parseInt(process.env.TE_ENTERPRISE_METRICS_CACHE_MAX_ENTRIES ?? "200", 10) || 200;

const store = new Map<string, { expiresAt: number; value: TeEnterpriseMetricsCacheEntry }>();

function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) {
      store.delete(k);
    }
  }
}

function evictIfOverCapacity(): void {
  evictExpired();
  if (store.size < MAX_ENTRIES) {
    return;
  }
  const keys = [...store.keys()];
  const drop = Math.max(1, keys.length - MAX_ENTRIES + 1);
  for (let i = 0; i < drop; i++) {
    store.delete(keys[i]);
  }
}

export function teEnterpriseMetricsCacheKey(
  siteId: string,
  testId: string,
  timespanSeconds: number,
  thousandEyesAid?: string | null,
): string {
  const aidSeg = thousandEyesAid?.trim() ? thousandEyesAid.trim() : "";
  return `${siteId}\x1e${testId}\x1e${timespanSeconds}\x1e${aidSeg}`;
}

export function getTeEnterpriseMetricsFromCache(key: string): TeEnterpriseMetricsCacheEntry | null {
  evictExpired();
  const row = store.get(key);
  if (!row || row.expiresAt <= Date.now()) {
    if (row) {
      store.delete(key);
    }
    return null;
  }
  return row.value;
}

export function setTeEnterpriseMetricsCache(key: string, value: TeEnterpriseMetricsCacheEntry): void {
  evictIfOverCapacity();
  store.set(key, { expiresAt: Date.now() + TTL_MS, value });
}
