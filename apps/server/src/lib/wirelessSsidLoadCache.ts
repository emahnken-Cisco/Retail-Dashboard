/**
 * In-memory TTL cache for per-SSID load-share data served by
 * `GET /api/dashboard/sites/:siteId/wireless-health/ssid-load/:ssidNumber`.
 *
 * Each entry represents a single (site, SSID, timespan) tuple and aggregates
 * `clientCountHistory` + `usageHistory` for that SSID across all wireless APs.
 * The fan-out is 2 * N_APs Meraki calls per entry, so a longer TTL than the
 * main wireless cache (5 min vs 60 s) keeps repeat opens cheap while still
 * reflecting "current shape" of the network within a session.
 */

export type WirelessSsidLoadEntry = {
  /** Meraki SSID slot number, 0–14. */
  ssidNumber: number;
  /** Display name resolved from `wireless/ssids` (passed in by the caller). */
  ssidName: string;
  /** Average concurrent clients on this SSID across the timespan (sum across APs of per-AP avg). */
  avgClients: number;
  /** Average throughput in kbps across the timespan (sum across APs of per-AP avg). */
  avgKbps: number;
  /** Number of APs included in the aggregate. */
  apsAggregated: number;
  /** ISO timestamp of when the data was computed. */
  capturedAt: string;
  /** Timespan in seconds the aggregate is over. */
  timespanSeconds: number;
  /** Populated when one or more per-AP calls failed; partial data is returned regardless. */
  note?: string;
};

const TTL_MS =
  Number.parseInt(process.env.WIRELESS_SSID_LOAD_CACHE_TTL_MS ?? "300000", 10) || 300_000;
const MAX_ENTRIES =
  Number.parseInt(process.env.WIRELESS_SSID_LOAD_CACHE_MAX_ENTRIES ?? "500", 10) || 500;

const store = new Map<string, { expiresAt: number; value: WirelessSsidLoadEntry }>();

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

export function wirelessSsidLoadCacheKey(
  siteId: string,
  ssidNumber: number,
  timespanSeconds: number,
): string {
  return `wssid\x1e${siteId}\x1e${ssidNumber}\x1e${timespanSeconds}`;
}

export function getWirelessSsidLoadFromCache(key: string): WirelessSsidLoadEntry | null {
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

export function setWirelessSsidLoadCache(key: string, value: WirelessSsidLoadEntry): void {
  evictIfOverCapacity();
  store.set(key, { expiresAt: Date.now() + TTL_MS, value });
}

/** Exposed for the route to expose cache-age metadata to the UI. */
export function getWirelessSsidLoadEntryAgeMs(key: string): number | null {
  const row = store.get(key);
  if (!row) return null;
  return Date.now() - (row.expiresAt - TTL_MS);
}
