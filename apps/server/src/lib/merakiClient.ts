import { tracedFetch } from "./outboundTrace.js";

const MERAKI_BASE = "https://api.meraki.com/api/v1";

const merakiHeaders = (apiKey: string) => ({
  Accept: "application/json",
  "X-Cisco-Meraki-API-Key": apiKey,
});

export async function merakiFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await tracedFetch(
    `${MERAKI_BASE}${path}`,
    {
      ...init,
      headers: {
        ...merakiHeaders(apiKey),
        ...init?.headers,
      },
    },
    { provider: "meraki" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meraki ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

/** Parse `Link: <url>; rel=next` from Meraki paginated responses. */
function parseMerakiNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(",")) {
    const section = part.trim();
    const m = section.match(/^<([^>]+)>\s*;\s*rel=next$/i);
    if (m) {
      return m[1];
    }
  }
  return null;
}

async function merakiFetchAllPages<T>(apiKey: string, pathWithLeadingSlash: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${MERAKI_BASE}${pathWithLeadingSlash}`;
  while (url) {
    const res = await tracedFetch(
      url,
      { headers: merakiHeaders(apiKey) },
      { provider: "meraki", note: "paginated" },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meraki ${res.status}: ${text.slice(0, 500)}`);
    }
    const chunk = (await res.json()) as unknown;
    if (Array.isArray(chunk)) {
      out.push(...(chunk as T[]));
    }
    url = parseMerakiNextUrl(res.headers.get("Link"));
  }
  return out;
}

export type MerakiOrg = { id: string; name: string };
export type MerakiNetwork = { id: string; name: string; organizationId: string };
export type MerakiDevice = {
  serial: string;
  name: string;
  model: string;
  networkId: string;
  lat?: number;
  lng?: number;
  address?: string;
  /** Often absent on `GET /networks/.../devices`; prefer availabilities endpoint. */
  status?: string;
};

/** Row from `GET /organizations/{id}/devices/availabilities` */
export type MerakiDeviceAvailability = {
  serial?: string;
  status?: string;
  name?: string;
  network?: { id?: string };
};

export async function listOrganizations(apiKey: string): Promise<MerakiOrg[]> {
  return merakiFetch<MerakiOrg[]>(apiKey, "/organizations");
}

export async function listNetworks(apiKey: string, orgId: string): Promise<MerakiNetwork[]> {
  return merakiFetch<MerakiNetwork[]>(apiKey, `/organizations/${orgId}/networks`);
}

export async function listNetworkDevices(apiKey: string, networkId: string): Promise<MerakiDevice[]> {
  return merakiFetch<MerakiDevice[]>(apiKey, `/networks/${networkId}/devices`);
}

/** MX/Z appliance WAN uplink live status (active / ready / failed / …). See Meraki: getOrganizationApplianceUplinkStatuses */
export type MerakiApplianceUplinkStatusItem = {
  networkId: string;
  serial: string;
  model?: string;
  lastReportedAt?: string;
  highAvailability?: { enabled?: boolean; role?: string };
  uplinks: Array<{
    interface: string; // wan1 | wan2 | wan3 | cellular
    status: string;
    ip?: string;
    gateway?: string;
    publicIp?: string;
    primaryDns?: string;
    secondaryDns?: string;
    ipAssignedBy?: string;
  }>;
};

export type ApplianceUplinkQuery = {
  networkIds?: string[];
  serials?: string[];
};

/**
 * All pages of organization appliance uplink statuses (MX / Z / MG telemetry).
 * Requires API key scope such as **sdwan:telemetry:read** (see Meraki API docs).
 */
export async function getOrganizationApplianceUplinkStatuses(
  apiKey: string,
  organizationId: string,
  filters: ApplianceUplinkQuery,
): Promise<MerakiApplianceUplinkStatusItem[]> {
  const networkIds = filters.networkIds ?? [];
  const serials = filters.serials ?? [];
  if (networkIds.length === 0 && serials.length === 0) {
    return [];
  }
  const qs = new URLSearchParams();
  // Meraki requires bracket notation for array params (see API query-parameters docs).
  for (const id of networkIds) {
    qs.append("networkIds[]", id);
  }
  for (const s of serials) {
    qs.append("serials[]", s);
  }
  qs.set("perPage", "1000");
  return merakiFetchAllPages<MerakiApplianceUplinkStatusItem>(
    apiKey,
    `/organizations/${organizationId}/appliance/uplink/statuses?${qs.toString()}`,
  );
}

/**
 * Device online / offline / alerting / dormant (updated ~every 5 minutes per Meraki).
 * `GET /networks/.../devices` usually does not include `status`; merge this map by serial.
 */
export async function getOrganizationDevicesAvailabilitiesForNetworks(
  apiKey: string,
  organizationId: string,
  networkIds: string[],
): Promise<Map<string, string>> {
  const statusBySerial = new Map<string, string>();
  if (networkIds.length === 0) {
    return statusBySerial;
  }
  const chunkSize = 35;
  for (let i = 0; i < networkIds.length; i += chunkSize) {
    const chunk = networkIds.slice(i, i + chunkSize);
    const qs = new URLSearchParams();
    qs.set("perPage", "1000");
    for (const id of chunk) {
      qs.append("networkIds[]", id);
    }
    const rows = await merakiFetchAllPages<MerakiDeviceAvailability>(
      apiKey,
      `/organizations/${organizationId}/devices/availabilities?${qs.toString()}`,
    );
    for (const row of rows) {
      const serial = row.serial;
      const st = row.status;
      if (serial && st) {
        statusBySerial.set(serial, st);
      }
    }
  }
  return statusBySerial;
}

/** Row from `GET /networks/{networkId}/alerts/history` (Meraki Dashboard alert history). */
export type MerakiNetworkAlertHistoryItem = {
  occurredAt?: string;
  alertTypeId?: string;
  alertType?: string;
  device?: { serial?: string };
  alertData?: Record<string, unknown>;
};

/**
 * First page of network alert history (newest first per Meraki).
 * Requires scope such as **dashboard:general:telemetry:read** on the API key.
 */
export async function getNetworkAlertsHistory(
  apiKey: string,
  networkId: string,
  perPage = 100,
): Promise<MerakiNetworkAlertHistoryItem[]> {
  const n = Math.min(1000, Math.max(3, Math.floor(perPage)));
  const qs = new URLSearchParams();
  qs.set("perPage", String(n));
  return merakiFetch<MerakiNetworkAlertHistoryItem[]>(
    apiKey,
    `/networks/${networkId}/alerts/history?${qs.toString()}`,
  );
}

/** Response from `GET /devices/{serial}/camera/videoLink`. Requires camera read scope on the API key. */
export type MerakiCameraVideoLink = {
  url?: string;
  visionUrl?: string;
};

/**
 * Live / Vision links for an MV camera. OAuth equivalent scope: **camera:config:read**.
 * Stream `url` values can be short-lived; refresh periodically for continuous viewing.
 */
export async function getDeviceCameraVideoLink(
  apiKey: string,
  serial: string,
  timestamp?: string,
): Promise<MerakiCameraVideoLink> {
  const enc = encodeURIComponent(serial);
  const q =
    timestamp && timestamp.trim()
      ? `?timestamp=${encodeURIComponent(timestamp.trim())}`
      : "";
  return merakiFetch<MerakiCameraVideoLink>(apiKey, `/devices/${enc}/camera/videoLink${q}`);
}

/** Organization inventory row (tags are Dashboard device tags). */
export type MerakiInventoryDevice = {
  serial?: string;
  name?: string;
  model?: string;
  networkId?: string;
  mac?: string;
  tags?: string[];
};

export async function listOrganizationInventoryDevices(
  apiKey: string,
  organizationId: string,
): Promise<MerakiInventoryDevice[]> {
  return merakiFetchAllPages<MerakiInventoryDevice>(
    apiKey,
    `/organizations/${organizationId}/inventory/devices?perPage=1000`,
  );
}

export async function getNetworkDevice(
  apiKey: string,
  networkId: string,
  serial: string,
): Promise<Record<string, unknown>> {
  return merakiFetch<Record<string, unknown>>(
    apiKey,
    `/networks/${encodeURIComponent(networkId)}/devices/${encodeURIComponent(serial)}`,
  );
}

/** Dashboard API: update device (e.g. `{ tags: string[] }` replaces tags when provided). */
export async function updateNetworkDevice(
  apiKey: string,
  networkId: string,
  serial: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return merakiFetch<Record<string, unknown>>(
    apiKey,
    `/networks/${encodeURIComponent(networkId)}/devices/${encodeURIComponent(serial)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Row from `GET /networks/{networkId}/appliance/uplinks/usageHistory` */
export type MerakiApplianceUplinkUsageHistoryRow = {
  startTime: string;
  endTime: string;
  byInterface: Array<{
    interface: string;
    sent: number;
    received: number;
  }>;
};

/**
 * Historical byte counters per uplink (sent + received) for charting throughput.
 * Requires **sdwan:telemetry:read** (or equivalent) on the API key.
 */
export async function getNetworkApplianceUplinksUsageHistory(
  apiKey: string,
  networkId: string,
  opts: { timespan: number; resolution: number },
): Promise<MerakiApplianceUplinkUsageHistoryRow[]> {
  const qs = new URLSearchParams();
  qs.set("timespan", String(opts.timespan));
  qs.set("resolution", String(opts.resolution));
  return merakiFetch<MerakiApplianceUplinkUsageHistoryRow[]>(
    apiKey,
    `/networks/${encodeURIComponent(networkId)}/appliance/uplinks/usageHistory?${qs.toString()}`,
  );
}

/** Row from `GET /devices/{serial}/lossAndLatencyHistory` */
export type MerakiDeviceLossLatencyHistoryRow = {
  startTime: string;
  endTime: string;
  lossPercent: number;
  latencyMs: number;
  goodput?: number;
  jitter?: number;
};

/**
 * Loss, latency, and goodput time series for MX / MG / Z.
 * `ip` is the connectivity-test destination (e.g. 8.8.8.8). Requires **dashboard:general:telemetry:read**.
 */
export async function getDeviceLossAndLatencyHistory(
  apiKey: string,
  serial: string,
  opts: {
    timespan: number;
    resolution: number;
    uplink: "wan1" | "wan2" | "wan3" | "wan4" | "cellular";
    ip: string;
  },
): Promise<MerakiDeviceLossLatencyHistoryRow[]> {
  const enc = encodeURIComponent(serial);
  const qs = new URLSearchParams();
  qs.set("timespan", String(opts.timespan));
  qs.set("resolution", String(opts.resolution));
  qs.set("uplink", opts.uplink);
  qs.set("ip", opts.ip);
  return merakiFetch<MerakiDeviceLossLatencyHistoryRow[]>(
    apiKey,
    `/devices/${enc}/lossAndLatencyHistory?${qs.toString()}`,
  );
}
