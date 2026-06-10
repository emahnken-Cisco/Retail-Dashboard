/**
 * In-memory TTL cache for the per-AP wireless connection log served by
 * `GET /api/dashboard/sites/:siteId/wireless/:serial/connection-log`.
 *
 * Each entry caches a single (site, serial, window) tuple. Short TTL (30 s)
 * because the underlying Meraki events feed is updated continuously and users
 * triaging connectivity issues expect "fresh enough" data when they reopen
 * the sidecar — but we still want to dedupe the inevitable double-click /
 * rapid-toggle traffic.
 */

import type { MerakiNetworkEvent } from "./merakiClient.js";

export type WirelessConnectionLogWindow = "1h" | "12h" | "24h" | "7d";

export const WIRELESS_CONNECTION_LOG_WINDOW_SECONDS: Record<WirelessConnectionLogWindow, number> = {
  "1h": 3_600,
  "12h": 12 * 3_600,
  "24h": 24 * 3_600,
  "7d": 7 * 24 * 3_600,
};

export type WirelessConnectionLogEntry = {
  serial: string;
  deviceName: string | null;
  networkId: string;
  window: WirelessConnectionLogWindow;
  windowSeconds: number;
  capturedAt: string;
  events: MerakiNetworkEvent[];
  /** Set when the Meraki call returned with a non-empty `message` field (rate-limit hints, etc.) */
  note?: string;
};

const TTL_MS = Number.parseInt(process.env.WIRELESS_CONN_LOG_CACHE_TTL_MS ?? "30000", 10) || 30_000;
const MAX_ENTRIES =
  Number.parseInt(process.env.WIRELESS_CONN_LOG_CACHE_MAX_ENTRIES ?? "300", 10) || 300;

const store = new Map<string, { expiresAt: number; value: WirelessConnectionLogEntry }>();

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

export function wirelessConnectionLogCacheKey(
  siteId: string,
  serial: string,
  window: WirelessConnectionLogWindow,
): string {
  return `wcl\x1e${siteId}\x1e${serial}\x1e${window}`;
}

export function getWirelessConnectionLogFromCache(key: string): WirelessConnectionLogEntry | null {
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

export function setWirelessConnectionLogCache(key: string, value: WirelessConnectionLogEntry): void {
  evictIfOverCapacity();
  store.set(key, { expiresAt: Date.now() + TTL_MS, value });
}
