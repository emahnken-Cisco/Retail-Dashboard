/** Circuit rows returned with dashboard locations (Circuits management). */
export type DashboardCircuit = {
  id: string;
  siteId: string;
  connectivityKind: string;
  providerName: string;
  carrierCircuitId: string;
  merakiInterface: string;
  merakiApplianceSerial: string | null;
  isSynchronous: boolean;
  customSpeedLabel: string | null;
  /** When set, local contact fields are resolved from the location (Locations tab). */
  siteLocalContactSlot?: "PRIMARY" | "SECONDARY" | null;
  localContactName: string | null;
  localContactPhone: string | null;
  localContactEmail: string | null;
  notes: string | null;
  speedPreset: {
    id: string;
    label: string;
    downloadMbps: number;
    uploadMbps: number | null;
  } | null;
};

export type DashboardLocation = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Latest Meraki snapshot device position (read-only reference). */
  merakiLat?: number | null;
  merakiLng?: number | null;
  /** When true, `lat`/`lng` are user-set; otherwise they prefer Meraki geo from snapshot. */
  locationLatLngManual?: boolean;
  /** Optional "City" or "City, ST" for weather summary (see Locations tab). */
  city?: string | null;
  merakiNetworkId: string | null;
  thousandEyesTag: string | null;
  /** Require WAN2 active/ready for green (secondary wired). */
  expectWan2Healthy?: boolean;
  /** Require cellular active/ready for green (secondary or tertiary backup). */
  expectCellularHealthy?: boolean;
  latestMeraki: { capturedAt: string; payload: unknown } | null;
  latestThousandEyes: { capturedAt: string; payload: unknown } | null;
  /** Carrier circuits linked to this location (from Circuits page). */
  circuits?: DashboardCircuit[];
};

export function formatDashboardCircuitSpeed(c: DashboardCircuit): string {
  if (c.customSpeedLabel?.trim()) {
    return c.customSpeedLabel.trim();
  }
  const p = c.speedPreset;
  if (p) {
    if (p.uploadMbps == null) {
      return `${p.label} (${p.downloadMbps}/${p.downloadMbps} Mbps)`;
    }
    return `${p.label} (${p.downloadMbps}/${p.uploadMbps} Mbps)`;
  }
  return "—";
}

/** Maps Meraki uplink / interface labels (circuit or snapshot) to API `uplink` query values. */
export function normalizeMerakiUplinkParam(iface: string): "wan1" | "wan2" | "wan3" | "wan4" | "cellular" | null {
  const x = iface.trim().toLowerCase();
  if (x === "wan1" || x === "internet 1") {
    return "wan1";
  }
  if (x === "wan2" || x === "internet 2") {
    return "wan2";
  }
  if (x === "wan3") {
    return "wan3";
  }
  if (x === "wan4") {
    return "wan4";
  }
  if (x === "cellular" || x.includes("cell")) {
    return "cellular";
  }
  return null;
}

/** Circuits mapped to this Meraki WAN interface for a given appliance serial. */
export function circuitsMatchingWan(
  circuits: DashboardCircuit[],
  wan: "wan1" | "wan2",
  applianceSerial: string,
): DashboardCircuit[] {
  return circuitsMatchingUplink(circuits, wan, applianceSerial);
}

/** Circuits mapped to a Meraki uplink (WAN1/WAN2/cellular, …) for a given appliance serial. */
export function circuitsMatchingUplink(
  circuits: DashboardCircuit[],
  uplink: "wan1" | "wan2" | "cellular" | "wan3" | "wan4",
  applianceSerial: string,
): DashboardCircuit[] {
  const iface = uplink.toLowerCase();
  return circuits.filter((c) => {
    if (String(c.merakiInterface).toLowerCase() !== iface) {
      return false;
    }
    if (!c.merakiApplianceSerial?.trim()) {
      return true;
    }
    return c.merakiApplianceSerial.trim() === applianceSerial;
  });
}

export type MerakiDeviceRow = {
  serial: string;
  name: string;
  model: string;
  status: string;
};

export type MerakiWanUplinkDetail = {
  interface: string;
  status: string;
  ip: string | null;
  gateway: string | null;
  publicIp: string | null;
  primaryDns: string | null;
  secondaryDns: string | null;
  ipAssignedBy: string | null;
};

export type MerakiWanAppliance = {
  serial: string;
  model: string;
  lastReportedAt: string | null;
  highAvailability: { enabled: boolean; role: string } | null;
  pathSummary: string;
  activeInterfaces: string[];
  wan1Status: string | null;
  wan2Status: string | null;
  cellularStatus: string | null;
  uplinks: MerakiWanUplinkDetail[];
};

/** Rows from Meraki `GET /networks/.../alerts/history` (latest ingest). */
export type MerakiAlertHistoryRow = {
  occurredAt: string;
  alertTypeId: string;
  alertType: string;
  deviceSerial: string;
};

export type MerakiSnapshot = {
  organizationName: string;
  networkName: string;
  networkId: string;
  deviceCount: number;
  devices: MerakiDeviceRow[];
  wan: { appliances: MerakiWanAppliance[] } | null;
  /** Set when an MX/MG/Z appliance is present but no uplink telemetry was returned. */
  wanNote?: string | null;
  /** Recent Dashboard alerts for this network (tracked locations only in ingest). */
  alerts: MerakiAlertHistoryRow[];
  /** Present when the alerts history API failed (e.g. missing API scope). */
  alertsNote?: string | null;
};

export type TEAgentRow = {
  agentId: string;
  agentName: string;
  agentType: string;
  location: string;
  agentState: string;
};

/**
 * Wi-Fi correlation between a TE Endpoint Agent and a Meraki MR access point,
 * pre-computed during TE ingest. Drives the Wi-Fi tone pill in the endpoint
 * agents table and the "Wi-Fi correlation" section in the endpoint sidecar.
 *
 * `tone` summarizes severity at-a-glance; richer fields let the sidecar
 * display SSID/BSSID/RSSI plus the matched MR serial when present.
 */
export type WirelessEndpointCorrelationTone = "green" | "amber" | "red" | "neutral";
export type WirelessEndpointCorrelationReason =
  | "wired"
  | "no-wireless-data"
  | "no-meraki-match"
  | "weak-rssi"
  | "poor-rssi"
  | "recent-failures"
  | "healthy";

/**
 * Which join produced the matched MR — drives the "matched via BSSID" hint
 * in the sidecar so users understand why this Android endpoint matched even
 * though no client MAC was reported by TE.
 */
export type WirelessEndpointMatchMethod = "client-mac" | "bssid" | "none";

export type WirelessEndpointCorrelation = {
  agentId: string;
  tone: WirelessEndpointCorrelationTone;
  reason: WirelessEndpointCorrelationReason;
  connectionType: "Wireless" | "Wired" | "Unknown";
  ssid: string | null;
  bssid: string | null;
  rssiDbm: number | null;
  signalQualityDb: number | null;
  channel: number | null;
  channelWidthMhz: number | null;
  band: string | null;
  /** 802.11 PHY mode (e.g. "802.11ax"); sourced from TE WirelessProfile.phyMode. */
  phyMode: string | null;
  wirelessMac: string | null;
  matchedMeraki: {
    serial: string;
    name: string | null;
    ssid: string | null;
    lastSeen: string | null;
  } | null;
  matchMethod: WirelessEndpointMatchMethod;
  recentFailureCount: number;
};

/**
 * Tier A inventory fields surfaced from the TE Endpoint Agents v7.0.91
 * root EndpointAgent object. All optional — TE does not contract any of
 * them per platform (e.g. nicModel / nicDriverVersion are typically only
 * present on Windows, batteryMetrics only on mobile/laptop platforms).
 */
export type TEEndpointAgentInventory = {
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  agentVersion: string | null;
  /** TE recommended client version when `expand=targetVersion` was requested. */
  agentTargetVersion: string | null;
  /** "essentials" / "advantage" / "embedded" per AgentLicenseType enum. */
  licenseType: string | null;
  nicModel: string | null;
  nicDriverVersion: string | null;
  totalMemory: string | null;
  /** 0–1 normalized free-disk fraction. */
  freeDiskSpaceNormalized: number | null;
  numberOfClients: number | null;
  tcpDriverAvailable: boolean | null;
  /** Windows-only NPCAP driver version. */
  npcapVersion: string | null;
  /** 0–1 normalized battery health. */
  batteryHealthNormalized: number | null;
  /** 0–1 normalized current battery level. */
  batteryLevelNormalized: number | null;
};

/** ThousandEyes Endpoint Agent (UUID) scoped to location by TE tag or ~80 km of site lat/lng. */
export type TEEndpointAgentRow = {
  id: string;
  hostname: string;
  computerName: string;
  name: string;
  platform: string;
  status: string;
  lastSeen: string;
  publicIP: string;
  lat: number | null;
  lng: number | null;
  /** Tier A inventory enrichment; absent on snapshots from older ingests. */
  inventory?: TEEndpointAgentInventory;
  /**
   * Pre-computed Wi-Fi correlation against the site's Meraki MR fleet. Absent
   * for snapshots taken before the correlator feature shipped or when the
   * site has no Meraki networkId / API key configured.
   */
  wirelessCorrelation?: WirelessEndpointCorrelation;
};

export type TETestRow = {
  testId: string;
  testName: string;
  type: string;
  enabled: boolean;
};

export type TESnapshot = {
  agents: TEAgentRow[];
  httpTests: TETestRow[];
  /** When present, HTTP tests keyed by enterprise agent id (from latest ingest). */
  testsByAgentId?: Record<string, TETestRow[]>;
  agentToServerTests: TETestRow[];
  agentToServerTestsByAgentId?: Record<string, TETestRow[]>;
  agentToAgentTests: TETestRow[];
  agentToAgentTestsByAgentId?: Record<string, TETestRow[]>;
  matchedByTag: boolean;
  endpointAgents: TEEndpointAgentRow[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseTETestRowsFromArray(rawTests: unknown): TETestRow[] {
  const httpTests: TETestRow[] = [];
  if (!Array.isArray(rawTests)) {
    return httpTests;
  }
  for (const t of rawTests) {
    if (!isRecord(t)) {
      continue;
    }
    const tid = t.testId;
    httpTests.push({
      testId: tid != null ? String(tid) : "—",
      testName: String(t.testName ?? "—"),
      type: String(t.type ?? "—"),
      enabled: t.enabled !== false,
    });
  }
  return httpTests;
}

function parseTETestsByAgentFromRecord(rawByAgent: unknown): Record<string, TETestRow[]> | undefined {
  if (!isRecord(rawByAgent)) {
    return undefined;
  }
  const m: Record<string, TETestRow[]> = {};
  for (const [aid, arr] of Object.entries(rawByAgent)) {
    const rows = parseTETestRowsFromArray(arr);
    if (rows.length > 0) {
      m[aid] = rows;
    }
  }
  return Object.keys(m).length > 0 ? m : undefined;
}

function readStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Parse the Tier A inventory blob the TE ingest job attaches to each
 * endpoint row. Returns null when the blob is missing or empty so the
 * sidecar can render a clear "No inventory captured for this snapshot"
 * fallback rather than a wall of dashes.
 */
function parseEndpointInventory(raw: unknown): TEEndpointAgentInventory | null {
  if (!isRecord(raw)) return null;
  const inv: TEEndpointAgentInventory = {
    serialNumber: readStringOrNull(raw.serialNumber),
    manufacturer: readStringOrNull(raw.manufacturer),
    model: readStringOrNull(raw.model),
    osVersion: readStringOrNull(raw.osVersion),
    kernelVersion: readStringOrNull(raw.kernelVersion),
    agentVersion: readStringOrNull(raw.agentVersion),
    agentTargetVersion: readStringOrNull(raw.agentTargetVersion),
    licenseType: readStringOrNull(raw.licenseType),
    nicModel: readStringOrNull(raw.nicModel),
    nicDriverVersion: readStringOrNull(raw.nicDriverVersion),
    totalMemory: readStringOrNull(raw.totalMemory),
    freeDiskSpaceNormalized: readFiniteNumber(raw.freeDiskSpaceNormalized),
    numberOfClients:
      typeof raw.numberOfClients === "number" && Number.isFinite(raw.numberOfClients)
        ? raw.numberOfClients
        : null,
    tcpDriverAvailable: typeof raw.tcpDriverAvailable === "boolean" ? raw.tcpDriverAvailable : null,
    npcapVersion: readStringOrNull(raw.npcapVersion),
    batteryHealthNormalized: readFiniteNumber(raw.batteryHealthNormalized),
    batteryLevelNormalized: readFiniteNumber(raw.batteryLevelNormalized),
  };
  // Drop the blob if literally nothing was captured.
  const hasAnything =
    inv.serialNumber != null ||
    inv.manufacturer != null ||
    inv.model != null ||
    inv.osVersion != null ||
    inv.agentVersion != null ||
    inv.nicModel != null ||
    inv.nicDriverVersion != null ||
    inv.licenseType != null ||
    inv.freeDiskSpaceNormalized != null ||
    inv.batteryHealthNormalized != null ||
    inv.batteryLevelNormalized != null;
  return hasAnything ? inv : null;
}

const WIRELESS_TONES = new Set<WirelessEndpointCorrelationTone>(["green", "amber", "red", "neutral"]);
const WIRELESS_REASONS = new Set<WirelessEndpointCorrelationReason>([
  "wired",
  "no-wireless-data",
  "no-meraki-match",
  "weak-rssi",
  "poor-rssi",
  "recent-failures",
  "healthy",
]);

function parseWirelessCorrelations(raw: unknown): Record<string, WirelessEndpointCorrelation> {
  if (!isRecord(raw)) return {};
  const out: Record<string, WirelessEndpointCorrelation> = {};
  for (const [agentId, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    const toneRaw = String(entry.tone ?? "neutral");
    const tone: WirelessEndpointCorrelationTone = WIRELESS_TONES.has(
      toneRaw as WirelessEndpointCorrelationTone,
    )
      ? (toneRaw as WirelessEndpointCorrelationTone)
      : "neutral";
    const reasonRaw = String(entry.reason ?? "no-wireless-data");
    const reason: WirelessEndpointCorrelationReason = WIRELESS_REASONS.has(
      reasonRaw as WirelessEndpointCorrelationReason,
    )
      ? (reasonRaw as WirelessEndpointCorrelationReason)
      : "no-wireless-data";
    const connTypeRaw = String(entry.connectionType ?? "Unknown");
    const connectionType: WirelessEndpointCorrelation["connectionType"] =
      connTypeRaw === "Wireless" || connTypeRaw === "Wired" ? connTypeRaw : "Unknown";

    const matchedRaw = entry.matchedMeraki;
    let matchedMeraki: WirelessEndpointCorrelation["matchedMeraki"] = null;
    if (isRecord(matchedRaw) && typeof matchedRaw.serial === "string" && matchedRaw.serial) {
      matchedMeraki = {
        serial: matchedRaw.serial,
        name: matchedRaw.name != null ? String(matchedRaw.name) : null,
        ssid: matchedRaw.ssid != null ? String(matchedRaw.ssid) : null,
        lastSeen: matchedRaw.lastSeen != null ? String(matchedRaw.lastSeen) : null,
      };
    }

    const matchMethodRaw = String(entry.matchMethod ?? (matchedMeraki ? "client-mac" : "none"));
    const matchMethod: WirelessEndpointMatchMethod =
      matchMethodRaw === "client-mac" || matchMethodRaw === "bssid" || matchMethodRaw === "none"
        ? matchMethodRaw
        : matchedMeraki
          ? "client-mac"
          : "none";

    out[agentId] = {
      agentId,
      tone,
      reason,
      connectionType,
      ssid: entry.ssid != null ? String(entry.ssid) : null,
      bssid: entry.bssid != null ? String(entry.bssid) : null,
      rssiDbm: readFiniteNumber(entry.rssiDbm),
      signalQualityDb: readFiniteNumber(entry.signalQualityDb),
      channel: readFiniteNumber(entry.channel),
      channelWidthMhz: readFiniteNumber(entry.channelWidthMhz),
      band: entry.band != null ? String(entry.band) : null,
      phyMode: entry.phyMode != null ? String(entry.phyMode) : null,
      wirelessMac: entry.wirelessMac != null ? String(entry.wirelessMac) : null,
      matchedMeraki,
      matchMethod,
      recentFailureCount:
        typeof entry.recentFailureCount === "number" && Number.isFinite(entry.recentFailureCount)
          ? Math.max(0, Math.floor(entry.recentFailureCount))
          : 0,
    };
  }
  return out;
}

export function parseMerakiSnapshot(payload: unknown): MerakiSnapshot | null {
  if (!isRecord(payload)) {
    return null;
  }
  const rawDevices = payload.devices;
  const devices: MerakiDeviceRow[] = [];
  if (Array.isArray(rawDevices)) {
    for (const d of rawDevices) {
      if (!isRecord(d)) {
        continue;
      }
      devices.push({
        serial: String(d.serial ?? "—"),
        name: String(d.name ?? "—"),
        model: String(d.model ?? "—"),
        status: String(d.status ?? "—"),
      });
    }
  }

  let wan: MerakiSnapshot["wan"] = null;
  const rawWan = payload.wan;
  if (isRecord(rawWan)) {
    const rawAps = rawWan.appliances;
    const appliances: MerakiWanAppliance[] = [];
    if (Array.isArray(rawAps)) {
      for (const a of rawAps) {
        if (!isRecord(a)) {
          continue;
        }
        const rawHa = a.highAvailability;
        const ha =
          isRecord(rawHa) && (rawHa.enabled !== undefined || rawHa.role != null)
            ? { enabled: Boolean(rawHa.enabled), role: String(rawHa.role ?? "—") }
            : null;
        const uplinks: MerakiWanUplinkDetail[] = [];
        if (Array.isArray(a.uplinks)) {
          for (const u of a.uplinks) {
            if (!isRecord(u)) {
              continue;
            }
            uplinks.push({
              interface: String(u.interface ?? "—"),
              status: String(u.status ?? "—"),
              ip: u.ip != null ? String(u.ip) : null,
              gateway: u.gateway != null ? String(u.gateway) : null,
              publicIp: u.publicIp != null ? String(u.publicIp) : null,
              primaryDns: u.primaryDns != null ? String(u.primaryDns) : null,
              secondaryDns: u.secondaryDns != null ? String(u.secondaryDns) : null,
              ipAssignedBy: u.ipAssignedBy != null ? String(u.ipAssignedBy) : null,
            });
          }
        }
        const act = a.activeInterfaces;
        appliances.push({
          serial: String(a.serial ?? "—"),
          model: String(a.model ?? "—"),
          lastReportedAt: a.lastReportedAt != null ? String(a.lastReportedAt) : null,
          highAvailability: ha,
          pathSummary: String(a.pathSummary ?? "—"),
          activeInterfaces: Array.isArray(act) ? act.map((x) => String(x)) : [],
          wan1Status: a.wan1Status != null ? String(a.wan1Status) : null,
          wan2Status: a.wan2Status != null ? String(a.wan2Status) : null,
          cellularStatus: a.cellularStatus != null ? String(a.cellularStatus) : null,
          uplinks,
        });
      }
    }
    if (appliances.length > 0) {
      wan = { appliances };
    }
  }

  const wanNoteRaw = payload.wanNote;
  const wanNote =
    wanNoteRaw != null && String(wanNoteRaw).trim() !== "" ? String(wanNoteRaw) : undefined;

  const alerts: MerakiAlertHistoryRow[] = [];
  const rawAlerts = payload.alertsHistory;
  if (Array.isArray(rawAlerts)) {
    for (const a of rawAlerts) {
      if (!isRecord(a)) {
        continue;
      }
      alerts.push({
        occurredAt: String(a.occurredAt ?? "—"),
        alertTypeId: String(a.alertTypeId ?? "—"),
        alertType: String(a.alertType ?? a.alertTypeId ?? "—"),
        deviceSerial: String(a.deviceSerial ?? "—"),
      });
    }
  }
  const alertsNoteRaw = payload.alertsHistoryNote;
  const alertsNote =
    alertsNoteRaw != null && String(alertsNoteRaw).trim() !== ""
      ? String(alertsNoteRaw)
      : undefined;

  return {
    organizationName: String(payload.organizationName ?? "—"),
    networkName: String(payload.networkName ?? "—"),
    networkId: String(payload.networkId ?? "—"),
    deviceCount: typeof payload.deviceCount === "number" ? payload.deviceCount : devices.length,
    devices,
    wan,
    wanNote,
    alerts,
    alertsNote,
  };
}

export function parseTESnapshot(payload: unknown): TESnapshot | null {
  if (!isRecord(payload)) {
    return null;
  }
  const agents: TEAgentRow[] = [];
  const rawAgents = payload.agents;
  if (Array.isArray(rawAgents)) {
    for (const a of rawAgents) {
      if (!isRecord(a)) {
        continue;
      }
      const id = a.agentId;
      agents.push({
        agentId: id != null ? String(id) : "—",
        agentName: String(a.agentName ?? "—"),
        agentType: String(a.agentType ?? "—"),
        location: String(a.location ?? "—"),
        agentState: String(a.agentState ?? "—"),
      });
    }
  }
  const httpTests = parseTETestRowsFromArray(payload.httpTests);
  const testsByAgentId = parseTETestsByAgentFromRecord(payload.testsByAgentId);
  const agentToServerTests = parseTETestRowsFromArray(payload.agentToServerTests);
  const agentToServerTestsByAgentId = parseTETestsByAgentFromRecord(payload.agentToServerTestsByAgentId);
  const agentToAgentTests = parseTETestRowsFromArray(payload.agentToAgentTests);
  const agentToAgentTestsByAgentId = parseTETestsByAgentFromRecord(payload.agentToAgentTestsByAgentId);

  // Build the correlations index up-front so each row pickup is O(1).
  const correlationsByAgentId = parseWirelessCorrelations(payload.wirelessCorrelations);

  const endpointAgents: TEEndpointAgentRow[] = [];
  const rawEp = payload.endpointAgents;
  if (Array.isArray(rawEp)) {
    for (const e of rawEp) {
      if (!isRecord(e)) {
        continue;
      }
      const la = readFiniteNumber(e.lat);
      const lo = readFiniteNumber(e.lng);
      const id = String(e.id ?? "");
      const row: TEEndpointAgentRow = {
        id,
        hostname: String(e.hostname ?? e.computerName ?? e.name ?? "—"),
        computerName: String(e.computerName ?? ""),
        name: String(e.name ?? ""),
        platform: String(e.platform ?? "—"),
        status: String(e.status ?? "—"),
        lastSeen: String(e.lastSeen ?? ""),
        publicIP: String(e.publicIP ?? ""),
        lat: la,
        lng: lo,
      };
      const inv = parseEndpointInventory(e.inventory);
      if (inv) {
        row.inventory = inv;
      }
      const corr = correlationsByAgentId[id];
      if (corr) {
        row.wirelessCorrelation = corr;
      }
      endpointAgents.push(row);
    }
  }

  return {
    agents,
    httpTests,
    testsByAgentId,
    agentToServerTests,
    agentToServerTestsByAgentId,
    agentToAgentTests,
    agentToAgentTestsByAgentId,
    matchedByTag: Boolean(payload.matchedByTag),
    endpointAgents,
  };
}

/** Tests to show for a TE agent filter; `all` uses the union list. */
export function teTestRowsForAgent(
  unionRows: TETestRow[],
  byAgent: Record<string, TETestRow[]> | undefined,
  selectedAgentId: string | "all",
): TETestRow[] {
  if (selectedAgentId === "all" || !byAgent || Object.keys(byAgent).length === 0) {
    return unionRows;
  }
  return byAgent[selectedAgentId] ?? [];
}

export function teTestsForAgentSelection(te: TESnapshot | null, selectedAgentId: string | "all"): TETestRow[] {
  if (!te) {
    return [];
  }
  return teTestRowsForAgent(te.httpTests, te.testsByAgentId, selectedAgentId);
}

export function teAgentToServerTestsForSelection(te: TESnapshot | null, selectedAgentId: string | "all"): TETestRow[] {
  if (!te) {
    return [];
  }
  return teTestRowsForAgent(te.agentToServerTests, te.agentToServerTestsByAgentId, selectedAgentId);
}

export function teAgentToAgentTestsForSelection(te: TESnapshot | null, selectedAgentId: string | "all"): TETestRow[] {
  if (!te) {
    return [];
  }
  return teTestRowsForAgent(te.agentToAgentTests, te.agentToAgentTestsByAgentId, selectedAgentId);
}

/** Map / card health: green ok, orange degraded (expected WAN2/cellular path unhealthy but still online), amber partial, gray empty. */
export type LocationPinStatus = "ok" | "degraded" | "partial" | "empty";

/** WAN1/WAN2 link is usable: carrying traffic or standby up (Meraki active / ready). */
export function merakiWanCircuitHealthy(status: string | null | undefined): boolean {
  if (status == null || String(status).trim() === "") {
    return false;
  }
  const s = String(status).toLowerCase();
  return s === "active" || s === "ready";
}

function applianceHasActiveInternet(a: MerakiWanAppliance): boolean {
  return a.uplinks.some((u) => String(u.status).toLowerCase() === "active");
}

/** True if the location monitors any MX uplink (WAN2 and/or cellular); WAN1 is always required when this is on. */
export function locationExpectsCircuitChecks(location: DashboardLocation): boolean {
  return Boolean(location.expectWan2Healthy || location.expectCellularHealthy);
}

/** All configured circuits healthy: WAN1 whenever monitoring; WAN2/cellular if flagged. */
export function expectedMxUplinksHealthy(wan: MerakiWanAppliance, location: DashboardLocation): boolean {
  if (!locationExpectsCircuitChecks(location)) {
    return true;
  }
  if (!merakiWanCircuitHealthy(wan.wan1Status)) {
    return false;
  }
  if (location.expectWan2Healthy && !merakiWanCircuitHealthy(wan.wan2Status)) {
    return false;
  }
  if (location.expectCellularHealthy && !merakiWanCircuitHealthy(wan.cellularStatus)) {
    return false;
  }
  return true;
}

/**
 * Green pin: Meraki + TE base OK, and all expected WAN1/WAN2/cellular paths active or ready when configured.
 * Degraded: base OK, still has internet, but an expected circuit is not healthy.
 */
export function mapPinStatus(location: DashboardLocation): LocationPinStatus {
  const m = location.latestMeraki ? parseMerakiSnapshot(location.latestMeraki.payload) : null;
  const t = location.latestThousandEyes ? parseTESnapshot(location.latestThousandEyes.payload) : null;
  if (!m && !t) {
    return "empty";
  }
  const merakiOk = Boolean(m && m.devices.length > 0);
  const teAgentsOk = Boolean(t && t.agents.length > 0);
  const teTestsOk = Boolean(
    t &&
      (t.httpTests.some((x) => x.enabled) ||
        t.agentToServerTests.some((x) => x.enabled) ||
        t.agentToAgentTests.some((x) => x.enabled)),
  );
  const baseOk = merakiOk && teAgentsOk && teTestsOk;
  if (!baseOk) {
    return "partial";
  }

  if (!locationExpectsCircuitChecks(location)) {
    return "ok";
  }

  const aps = m?.wan?.appliances;
  if (!aps || aps.length === 0) {
    return "partial";
  }

  const wan = aps[0];
  const hasInternet = applianceHasActiveInternet(wan);

  if (!hasInternet) {
    return "partial";
  }
  if (!expectedMxUplinksHealthy(wan, location)) {
    return "degraded";
  }
  return "ok";
}

/** One-line explanation for map info window / location cards. */
export function mapPinStatusDescription(location: DashboardLocation): string {
  const status = mapPinStatus(location);
  const m = location.latestMeraki ? parseMerakiSnapshot(location.latestMeraki.payload) : null;
  const t = location.latestThousandEyes ? parseTESnapshot(location.latestThousandEyes.payload) : null;

  switch (status) {
    case "empty":
      return "No snapshot data yet for this location.";
    case "partial": {
      const parts: string[] = [];
      if (!m || m.devices.length === 0) {
        parts.push("Meraki MR/MS/MX/CW/MV gear missing in snapshot");
      }
      if (!t || t.agents.length === 0) {
        parts.push("matched TE agents missing");
      }
      if (
        !t ||
        (!t.httpTests.some((x) => x.enabled) &&
          !t.agentToServerTests.some((x) => x.enabled) &&
          !t.agentToAgentTests.some((x) => x.enabled))
      ) {
        parts.push("no enabled HTTP, agent-to-server, or agent-to-agent tests");
      }
      if (locationExpectsCircuitChecks(location) && m?.wan?.appliances?.length) {
        const w = m.wan.appliances[0];
        if (!applianceHasActiveInternet(w)) {
          parts.push("no active WAN/cellular uplink on MX");
        }
      }
      return `Incomplete: ${parts.join("; ")}.`;
    }
    case "degraded": {
      const w = m?.wan?.appliances?.[0];
      const bits: string[] = [];
      if (w && locationExpectsCircuitChecks(location) && !merakiWanCircuitHealthy(w.wan1Status)) {
        bits.push("WAN 1 not active/ready");
      }
      if (w && location.expectWan2Healthy && !merakiWanCircuitHealthy(w.wan2Status)) {
        bits.push("WAN 2 not active/ready");
      }
      if (w && location.expectCellularHealthy && !merakiWanCircuitHealthy(w.cellularStatus)) {
        bits.push("Cellular not active/ready");
      }
      if (bits.length === 0) {
        bits.push("an expected circuit is unhealthy");
      }
      return `Traffic still flowing, but monitored circuits need attention (${bits.join("; ")}). Check failover, SIM, and cabling.`;
    }
    default: {
      const parts: string[] = ["Meraki equipment", "TE agents", "enabled tests"];
      if (locationExpectsCircuitChecks(location)) {
        parts.push("WAN 1 healthy");
        if (location.expectWan2Healthy) {
          parts.push("WAN 2 healthy");
        }
        if (location.expectCellularHealthy) {
          parts.push("cellular healthy");
        }
      }
      return `${parts.join(", ")}.`;
    }
  }
}

export function isMrMsMxCw(model: string): boolean {
  const p = model.toUpperCase();
  return (
    p.startsWith("MR") ||
    p.startsWith("MS") ||
    p.startsWith("MX") ||
    p.startsWith("CW") ||
    p.startsWith("MV")
  );
}

/** Meraki smart camera (MV*) — use Dashboard API `GET /devices/{serial}/camera/videoLink` for live / Vision URLs. */
export function isMerakiCameraModel(model: string): boolean {
  return model.toUpperCase().startsWith("MV");
}

/** Wireless access point (MR* or CW* Catalyst Wi-Fi 6E/7). Used to gate the wireless connection-log link. */
export function isMerakiWirelessApModel(model: string): boolean {
  const p = model.toUpperCase();
  return p.startsWith("MR") || p.startsWith("CW");
}

/** Wireless (MR*) or switch (MS*) — alert history in snapshots is keyed by device serial. */
export function isMerakiMrOrMs(model: string): boolean {
  const p = model.toUpperCase();
  return p.startsWith("MR") || p.startsWith("MS");
}

function normalizeMerakiDeviceSerial(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase();
}

/** Rows from latest snapshot whose `deviceSerial` matches this equipment serial (case-insensitive). */
export function alertsForDeviceSerial(
  alerts: MerakiAlertHistoryRow[],
  deviceSerial: string,
): MerakiAlertHistoryRow[] {
  const target = normalizeMerakiDeviceSerial(deviceSerial);
  if (!target || target === "—") {
    return [];
  }
  return alerts.filter((a) => normalizeMerakiDeviceSerial(a.deviceSerial) === target);
}

export function filterEquipmentDevices(devices: MerakiDeviceRow[]): MerakiDeviceRow[] {
  return devices.filter((d) => isMrMsMxCw(d.model));
}
