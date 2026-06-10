/**
 * In-memory TTL cache for the per-site DHCP scope health response served by
 * `GET /api/dashboard/sites/:siteId/dhcp-scope-health`. Live Meraki API
 * (`/devices/{serial}/appliance/dhcp/subnets` + `/networks/{id}/appliance/vlans`)
 * is rate-limited; this cache shields it on rapid sidecar reopen.
 */

export type DhcpScopeEntry = {
  vlanId: number;
  name: string;
  subnet: string;
  applianceIp: string;
  used: number;
  capacity: number;
  utilizationPct: number | null;
  /** "Run DHCP server" | "Relay DHCP" | "Disabled" — normalized from Meraki strings. */
  mode: string;
  leaseTime: string | null;
  /** Either `["upstream"]` (Meraki resolves) or explicit IP list. */
  dnsServers: string[];
  /** DHCP option 15 — null when not configured. */
  domainName: string | null;
  fixedAssignments: number;
  reservedRanges: number;
  mandatoryDhcp: boolean;
  /** Custom DHCP options the dashboard surfaces as pills (opt 42 / 43 / 66 / 119 / 121 / 150). */
  extraOptions: Array<{ code: number; name: string; value: string }>;
};

export type DhcpScopeHealthCacheEntry = {
  networkId: string;
  capturedAt: string;
  scopes: DhcpScopeEntry[];
  totalUsed: number;
  totalCapacity: number;
  totalUtilizationPct: number | null;
  /** Populated when one or more upstream Meraki calls failed but partial data is still useful. */
  note?: string;
};

const TTL_MS = Number.parseInt(process.env.DHCP_SCOPE_HEALTH_CACHE_TTL_MS ?? "60000", 10) || 60_000;
const MAX_ENTRIES = Number.parseInt(process.env.DHCP_SCOPE_HEALTH_CACHE_MAX_ENTRIES ?? "200", 10) || 200;

const store = new Map<string, { expiresAt: number; value: DhcpScopeHealthCacheEntry }>();

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

export function dhcpScopeHealthCacheKey(siteId: string): string {
  return `dhcp\x1e${siteId}`;
}

export function getDhcpScopeHealthFromCache(key: string): DhcpScopeHealthCacheEntry | null {
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

export function setDhcpScopeHealthCache(key: string, value: DhcpScopeHealthCacheEntry): void {
  evictIfOverCapacity();
  store.set(key, { expiresAt: Date.now() + TTL_MS, value });
}
