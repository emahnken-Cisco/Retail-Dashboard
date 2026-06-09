/**
 * In-memory TTL cache for the per-site wireless health response served by
 * `GET /api/dashboard/sites/:siteId/wireless-health`. Aggregates multiple
 * Meraki endpoints per AP (radio settings, channel utilization, connection
 * stats) plus per-SSID usage / client counts — easily 20+ upstream calls,
 * so a short cache prevents thrash on sidecar reopen / tab switches.
 */

export type WirelessBand = "2.4 GHz" | "5 GHz" | "6 GHz";

export type WirelessApBandEntry = {
  band: WirelessBand;
  channel: number | null;
  channelWidthMhz: number | null;
  /** Average total airtime utilization across the timespan, 0–100. */
  airtimePct: number | null;
  /** Average non-802.11 (noise) utilization, 0–100. */
  nonWifiPct: number | null;
  /** TX power in dBm — null when MR returns rfProfileId only. */
  txPowerDbm: number | null;
};

export type WirelessApEntry = {
  name: string;
  model: string;
  serial: string;
  clientCount: number;
  /** Configured "healthy design" capacity for this model (from MerakiModelClientCapacity). */
  clientCapacity: number;
  /** Average RSSI of associated clients as seen by the AP, dBm. Null when Meraki returns no data. */
  avgClientRssiDbm: number | null;
  bands: WirelessApBandEntry[];
};

export type WirelessChannelEntry = {
  band: WirelessBand;
  channel: number;
  apsOnChannel: number;
  avgAirtimePct: number | null;
  avgNonWifiPct: number | null;
};

export type WirelessSsidEntry = {
  /** Meraki numeric SSID slot, 0–14. */
  number: number;
  name: string;
  enabled: boolean;
  /** Average client count over the timespan. */
  avgClientCount: number | null;
  /** Total traffic in Mbps (sent + received) averaged over the timespan. */
  avgMbps: number | null;
  /** This SSID's share of total wireless client count, 0–100. */
  clientSharePct: number | null;
  /** This SSID's share of total wireless traffic, 0–100. */
  trafficSharePct: number | null;
};

export type WirelessHealthCacheEntry = {
  networkId: string;
  capturedAt: string;
  timespanSeconds: number;
  channels: WirelessChannelEntry[];
  aps: WirelessApEntry[];
  ssids: WirelessSsidEntry[];
  /** Populated when one or more upstream Meraki calls failed; partial data is returned regardless. */
  note?: string;
};

const TTL_MS = Number.parseInt(process.env.WIRELESS_HEALTH_CACHE_TTL_MS ?? "60000", 10) || 60_000;
const MAX_ENTRIES = Number.parseInt(process.env.WIRELESS_HEALTH_CACHE_MAX_ENTRIES ?? "200", 10) || 200;

const store = new Map<string, { expiresAt: number; value: WirelessHealthCacheEntry }>();

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

export function wirelessHealthCacheKey(siteId: string, timespanSeconds: number): string {
  return `wireless\x1e${siteId}\x1e${timespanSeconds}`;
}

export function getWirelessHealthFromCache(key: string): WirelessHealthCacheEntry | null {
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

export function setWirelessHealthCache(key: string, value: WirelessHealthCacheEntry): void {
  evictIfOverCapacity();
  store.set(key, { expiresAt: Date.now() + TTL_MS, value });
}
