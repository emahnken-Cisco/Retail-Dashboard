import { prisma } from "../lib/prisma.js";
import { getAdminSettings } from "../lib/settings.js";
import { readFiniteCoord, resolveSiteCoordinates } from "../lib/siteCoordinates.js";
import { decryptSecret } from "../lib/cryptoVault.js";
import { getMerakiApiKey } from "../lib/merakiVault.js";
import {
  getNetworkWirelessClients,
  getOrganizationWirelessSsidsStatusesByDevice,
  type MerakiNetworkWirelessClient,
} from "../lib/merakiClient.js";
import type { TEAgentWithAssignedTests } from "../lib/thousandEyesClient.js";
import { listAllEndpointAgents, listEnterpriseAgentsWithTests } from "../lib/thousandEyesClient.js";
import {
  clampRssiThresholds,
  correlateEndpoint,
  enrichApRefsWithNames,
  indexBssidsByApRef,
  indexWirelessClientsByMac,
  snapshotEndpointWireless,
  type RssiThresholds,
  type WirelessApRef,
  type WirelessEndpointCorrelation,
} from "../lib/wirelessCorrelator.js";

async function getTeToken(): Promise<string | null> {
  const row = await prisma.credentialVault.findUnique({ where: { provider: "thousandeyes" } });
  if (!row) return null;
  return decryptSecret(row.encryptedValue, row.iv, row.authTag);
}

function isHttpType(type: string): boolean {
  return type.toLowerCase().includes("http");
}

function isAgentToServerType(type: string): boolean {
  return type.toLowerCase() === "agent-to-server";
}

function isAgentToAgentType(type: string): boolean {
  return type.toLowerCase() === "agent-to-agent";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function endpointAgentMatchesSite(
  agent: Record<string, unknown>,
  site: { thousandEyesTag: string | null },
  effectiveLat: number | null,
  effectiveLng: number | null,
): boolean {
  const tag = site.thousandEyesTag?.trim().toLowerCase();
  const locObj = isRecord(agent.location) ? agent.location : null;
  const locName = typeof locObj?.locationName === "string" ? locObj.locationName : "";
  const label =
    `${String(agent.computerName ?? "")} ${String(agent.name ?? "")} ${locName}`.toLowerCase();
  const tagMatch = Boolean(tag && label.includes(tag));

  let geoMatch = false;
  if (effectiveLat != null && effectiveLng != null) {
    if (locObj) {
      const la = readFiniteCoord(locObj.latitude);
      const lo = readFiniteCoord(locObj.longitude);
      if (la != null && lo != null) {
        geoMatch = distanceKm(effectiveLat, effectiveLng, la, lo) <= 80;
      }
    }
  }

  return tagMatch || geoMatch;
}

function slimEndpointAgentRow(agent: Record<string, unknown>) {
  const loc = isRecord(agent.location) ? agent.location : null;
  // Extract a compact wireless snapshot when TE returned `networkInterfaceProfiles`
  // (we request it via `expand` in the listing call). When the agent is wired
  // or TE omitted the expansion, the resulting connectionType is "Wired" or
  // "Unknown" and the wireless fields are null — both flow through the
  // correlator safely and the UI renders a neutral pill.
  const wireless = snapshotEndpointWireless(agent);
  return {
    id: String(agent.id ?? ""),
    hostname: String(agent.computerName || agent.name || "—"),
    computerName: String(agent.computerName ?? ""),
    name: String(agent.name ?? ""),
    platform: String(agent.platform ?? "—"),
    status: String(agent.status ?? "—"),
    lastSeen: String(agent.lastSeen ?? ""),
    publicIP: agent.publicIP != null ? String(agent.publicIP) : "",
    lat: readFiniteCoord(loc?.latitude),
    lng: readFiniteCoord(loc?.longitude),
    /** Wi‑Fi snapshot used by the correlator and rendered in the endpoint sidecar. */
    wireless: {
      connectionType: wireless.connectionType,
      wirelessMac: wireless.wirelessMac,
      ssid: wireless.ssid,
      bssid: wireless.bssid,
      rssiDbm: wireless.rssiDbm,
      signalQualityDb: wireless.signalQualityDb,
      channel: wireless.channel,
      channelWidthMhz: wireless.channelWidthMhz,
      band: wireless.band,
    },
  };
}

type SlimEndpointAgent = ReturnType<typeof slimEndpointAgentRow>;

/**
 * Read the admin-configured RSSI tone thresholds from the `lenses` blob.
 * Falls back to the correlator defaults when missing or malformed; the
 * `clampRssiThresholds` helper guarantees a usable range either way.
 */
function readRssiThresholdsFromLenses(lensesRaw: unknown): RssiThresholds {
  if (!isRecord(lensesRaw)) return clampRssiThresholds(undefined);
  const amber = (lensesRaw as Record<string, unknown>).wirelessImpactRssiAmberDbm;
  const red = (lensesRaw as Record<string, unknown>).wirelessImpactRssiRedDbm;
  return clampRssiThresholds({
    amberDbm: typeof amber === "number" ? amber : undefined,
    redDbm: typeof red === "number" ? red : undefined,
  });
}

/**
 * Resolve a Meraki networkId for the site from the latest Meraki snapshot
 * payload. Returns null when the snapshot is missing or shape is wrong;
 * callers skip wireless correlation in that case rather than failing the
 * whole ingest.
 */
function networkIdFromMerakiPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const id = payload.networkId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function organizationIdFromMerakiPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const id = payload.organizationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Walk the `devices` array a Meraki snapshot already stores and return a
 * `serial → friendlyName` map. Used to dress up the BSSID-based AP matches
 * (Meraki's `byDevice` endpoint returns serial but no device name).
 */
function deviceNamesFromMerakiPayload(payload: unknown): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!isRecord(payload)) return map;
  const devices = Array.isArray(payload.devices) ? payload.devices : [];
  for (const d of devices) {
    if (!isRecord(d)) continue;
    const serial = typeof d.serial === "string" ? d.serial : "";
    if (!serial) continue;
    const name = typeof d.name === "string" ? d.name : null;
    map.set(serial, name);
  }
  return map;
}

type TestRow = { testId: number | string; testName: string; type: string; enabled: boolean };

function slimAgentSnapshot(a: TEAgentWithAssignedTests) {
  return {
    agentId: a.agentId,
    agentName: a.agentName ?? "",
    location: a.location ?? "",
    agentType: a.agentType ?? "",
    agentState: a.agentState ?? "",
  };
}

function buildScopedTests(
  agents: TEAgentWithAssignedTests[],
  matchType: (type: string) => boolean,
  cap: number,
): { tests: TestRow[]; testsByAgentId: Record<string, TestRow[]> } {
  const testsByAgentId: Record<string, TestRow[]> = {};
  const unionById = new Map<string, TestRow>();

  for (const a of agents) {
    const aid = String(a.agentId ?? "");
    if (!aid) {
      continue;
    }
    const list: TestRow[] = [];
    for (const t of a.tests ?? []) {
      const typ = String(t.type ?? "");
      if (!matchType(typ)) {
        continue;
      }
      const tidRaw = t.testId;
      const tidStr = tidRaw != null ? String(tidRaw) : "";
      if (!tidStr) {
        continue;
      }
      const row: TestRow = {
        testId: tidRaw as number | string,
        testName: String(t.testName ?? ""),
        type: typ,
        enabled: t.enabled !== false,
      };
      list.push(row);
      if (!unionById.has(tidStr)) {
        unionById.set(tidStr, row);
      }
    }
    if (list.length > 0) {
      testsByAgentId[aid] = list;
    }
  }

  return { tests: Array.from(unionById.values()).slice(0, cap), testsByAgentId };
}

function buildAllAgentScopedTests(agents: TEAgentWithAssignedTests[]): {
  httpTests: TestRow[];
  testsByAgentId: Record<string, TestRow[]>;
  agentToServerTests: TestRow[];
  agentToServerTestsByAgentId: Record<string, TestRow[]>;
  agentToAgentTests: TestRow[];
  agentToAgentTestsByAgentId: Record<string, TestRow[]>;
} {
  const http = buildScopedTests(agents, isHttpType, 100);
  const a2s = buildScopedTests(agents, isAgentToServerType, 100);
  const a2a = buildScopedTests(agents, isAgentToAgentType, 100);
  return {
    httpTests: http.tests,
    testsByAgentId: http.testsByAgentId,
    agentToServerTests: a2s.tests,
    agentToServerTestsByAgentId: a2s.testsByAgentId,
    agentToAgentTests: a2a.tests,
    agentToAgentTestsByAgentId: a2a.testsByAgentId,
  };
}

export async function runThousandEyesIngest(): Promise<void> {
  const run = await prisma.ingestRun.create({
    data: { jobType: "thousandeyes", status: "running" },
  });
  try {
    const token = await getTeToken();
    if (!token) {
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          status: "skipped",
          finishedAt: new Date(),
          errorSummary: "No ThousandEyes token configured",
        },
      });
      return;
    }

    const admin = await getAdminSettings();
    const teScope = { aid: admin.thousandEyesAid?.trim() || null };
    const rssiThresholds = readRssiThresholdsFromLenses(admin.lenses);
    const agentsWithTests = await listEnterpriseAgentsWithTests(token, teScope);
    let endpointAgentPool: unknown[] = [];
    try {
      // Expand `networkInterfaceProfiles` in the listing call so each agent
      // carries its current Wi-Fi profile (SSID/BSSID/RSSI/SNR/MAC) without
      // requiring a per-agent fan-out — a single expanded listing keeps the
      // ingest job within TE's rate limits even on large endpoint fleets.
      endpointAgentPool = await listAllEndpointAgents(token, 600, teScope, [
        "networkInterfaceProfiles",
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[te ingest] list endpoint agents: ${msg.slice(0, 400)}`);
    }

    // Best-effort Meraki API key for cross-pillar correlation. When absent
    // (e.g. credentials not yet provisioned) we still ingest endpoint rows
    // but skip the wireless correlation step entirely — endpoints render
    // with a neutral pill in that case.
    let merakiApiKey: string | null = null;
    try {
      merakiApiKey = await getMerakiApiKey();
    } catch {
      merakiApiKey = null;
    }

    /** Cache of wireless-clients per Meraki networkId for the duration of this run. */
    const wirelessClientsByNetwork = new Map<string, MerakiNetworkWirelessClient[]>();
    /**
     * Cache of BSSID → AP-ref per Meraki organizationId for the duration of
     * this run. One Meraki call per org per ingest cycle — the byDevice
     * endpoint is org-scoped so siteN doesn't repeat the work.
     */
    const bssidIndexByOrg = new Map<string, Map<string, WirelessApRef>>();
    /** Note keyed by orgId when the byDevice call failed. */
    const bssidIndexErrByOrg = new Map<string, string>();

    const sites = await prisma.site.findMany();

    for (const site of sites) {
      const merakiSnap = await prisma.metricSnapshot.findFirst({
        where: { siteId: site.id, source: "meraki" },
        orderBy: { capturedAt: "desc" },
        select: { payload: true },
      });
      const { lat: effLat, lng: effLng } = resolveSiteCoordinates({
        lat: site.lat,
        lng: site.lng,
        locationLatLngManual: site.locationLatLngManual,
        merakiPayload: merakiSnap?.payload ?? null,
      });

      const tag = site.thousandEyesTag?.toLowerCase();
      const matchedAgents = tag
        ? agentsWithTests.filter((a) => (a.agentName || "").toLowerCase().includes(tag))
        : [];
      const displayAgents = matchedAgents.length ? matchedAgents : agentsWithTests.slice(0, 50);
      const scoped = buildAllAgentScopedTests(displayAgents);

      const matchedRawEndpoints = endpointAgentPool
        .filter(isRecord)
        .filter((a) => endpointAgentMatchesSite(a, site, effLat, effLng))
        .slice(0, 120);

      const endpointAgents: SlimEndpointAgent[] = matchedRawEndpoints
        .map(slimEndpointAgentRow)
        .filter((r) => r.id.length > 0);

      // ---- Wireless correlation (TE Endpoint Agent ↔ Meraki MR) -----------
      // We always emit a correlation entry per endpoint so the UI gets a
      // concrete reason (wired / no-Wi-Fi-data / no-Meraki-match / healthy
      // / impacted) instead of falling back to a generic "—" pill. The
      // Meraki wireless-clients call is only made when there's a Meraki
      // networkId + API key + at least one wireless endpoint — otherwise
      // the index is empty and every endpoint resolves to its
      // pre-Meraki tone (wired / no-data / no-match) cleanly.
      const wirelessCorrelations: Record<string, WirelessEndpointCorrelation> = {};
      let wirelessCorrelationNote: string | null = null;
      const merakiNetworkId = networkIdFromMerakiPayload(merakiSnap?.payload ?? null);
      const merakiOrganizationId = organizationIdFromMerakiPayload(merakiSnap?.payload ?? null);
      const serialToName = deviceNamesFromMerakiPayload(merakiSnap?.payload ?? null);

      const wirelessAgents = endpointAgents.filter(
        (a) => a.wireless.connectionType === "Wireless" && a.wireless.wirelessMac,
      );
      const wirelessAgentsWithBssid = endpointAgents.filter(
        (a) => a.wireless.connectionType === "Wireless" && a.wireless.bssid,
      );
      const needsCorrelation = wirelessAgents.length + wirelessAgentsWithBssid.length > 0;

      // ----- Client-MAC index (per network) --------------------------------
      let macIndex = new Map<string, MerakiNetworkWirelessClient>();
      const canQueryClients = Boolean(merakiApiKey && merakiNetworkId);
      if (canQueryClients && wirelessAgents.length > 0) {
        try {
          let clients = wirelessClientsByNetwork.get(merakiNetworkId!);
          if (!clients) {
            clients = await getNetworkWirelessClients(merakiApiKey!, merakiNetworkId!, {
              timespan: 86_400,
            });
            wirelessClientsByNetwork.set(merakiNetworkId!, clients);
          }
          macIndex = indexWirelessClientsByMac(clients);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          wirelessCorrelationNote = msg.slice(0, 240);
          console.warn(
            `[te ingest] wireless client list (${merakiNetworkId}): ${msg.slice(0, 240)}`,
          );
        }
      }

      // ----- BSSID index (per org, cached for the run) ---------------------
      // Always attempt the BSSID-based fallback when we have any wireless
      // endpoint with a reported BSSID — this is how Android / iOS / managed-
      // MAC fleets get matched to an MR even though TE never exposes their
      // client MAC.
      let bssidIndex: Map<string, WirelessApRef> | undefined;
      if (merakiApiKey && merakiOrganizationId && wirelessAgentsWithBssid.length > 0) {
        let cached = bssidIndexByOrg.get(merakiOrganizationId);
        if (!cached && !bssidIndexErrByOrg.has(merakiOrganizationId)) {
          try {
            const rows = await getOrganizationWirelessSsidsStatusesByDevice(
              merakiApiKey,
              merakiOrganizationId,
            );
            cached = indexBssidsByApRef(rows);
            bssidIndexByOrg.set(merakiOrganizationId, cached);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            bssidIndexErrByOrg.set(merakiOrganizationId, msg.slice(0, 240));
            console.warn(
              `[te ingest] wireless BSSID index (org=${merakiOrganizationId}): ${msg.slice(0, 240)}`,
            );
            // Surface as a correlation note ONLY when no MAC-based note already exists.
            if (!wirelessCorrelationNote) {
              wirelessCorrelationNote = `BSSID index unavailable: ${msg.slice(0, 200)}`;
            }
          }
        }
        if (cached) {
          // Patch in per-site device names so the AP-ref carries "MR-LAB-AP-03".
          // Safe to mutate: enrichApRefsWithNames only fills in missing names.
          bssidIndex = enrichApRefsWithNames(cached, serialToName);
        }
      } else if (
        !merakiApiKey &&
        (wirelessAgents.length > 0 || wirelessAgentsWithBssid.length > 0) &&
        !wirelessCorrelationNote
      ) {
        wirelessCorrelationNote = "Meraki API key not configured — wireless correlation skipped";
      } else if (
        merakiApiKey &&
        !merakiOrganizationId &&
        wirelessAgentsWithBssid.length > 0 &&
        !wirelessCorrelationNote
      ) {
        wirelessCorrelationNote =
          "Meraki organizationId missing from latest Meraki snapshot — BSSID fallback disabled";
      }

      for (const a of endpointAgents) {
        const snapshot = {
          agentId: a.id,
          connectionType: a.wireless.connectionType,
          wirelessMac: a.wireless.wirelessMac,
          ssid: a.wireless.ssid,
          bssid: a.wireless.bssid,
          rssiDbm: a.wireless.rssiDbm,
          signalQualityDb: a.wireless.signalQualityDb,
          channel: a.wireless.channel,
          channelWidthMhz: a.wireless.channelWidthMhz,
          band: a.wireless.band,
        };
        wirelessCorrelations[a.id] = correlateEndpoint(
          snapshot,
          macIndex,
          rssiThresholds,
          undefined,
          bssidIndex,
        );
      }

      // Light diagnostics — counts only; no PII / MAC values leak.
      if (endpointAgents.length > 0) {
        const wirelessDetected = endpointAgents.filter(
          (a) => a.wireless.connectionType === "Wireless",
        ).length;
        const matchedByMac = Object.values(wirelessCorrelations).filter(
          (c) => c.matchMethod === "client-mac",
        ).length;
        const matchedByBssid = Object.values(wirelessCorrelations).filter(
          (c) => c.matchMethod === "bssid",
        ).length;
        void needsCorrelation;
        console.info(
          `[te ingest] site=${site.id} endpoints=${endpointAgents.length} wireless=${wirelessDetected} with-mac=${wirelessAgents.length} with-bssid=${wirelessAgentsWithBssid.length} mac-matched=${matchedByMac} bssid-matched=${matchedByBssid} note=${wirelessCorrelationNote ?? "none"}`,
        );
      }

      const payload = {
        agents: displayAgents.map(slimAgentSnapshot),
        httpTests: scoped.httpTests,
        testsByAgentId: scoped.testsByAgentId,
        agentToServerTests: scoped.agentToServerTests,
        agentToServerTestsByAgentId: scoped.agentToServerTestsByAgentId,
        agentToAgentTests: scoped.agentToAgentTests,
        agentToAgentTestsByAgentId: scoped.agentToAgentTestsByAgentId,
        matchedByTag: Boolean(tag),
        endpointAgents,
        wirelessCorrelations,
        wirelessCorrelationNote,
      };

      await prisma.metricSnapshot.create({
        data: {
          siteId: site.id,
          source: "thousandeyes",
          payload,
        },
      });
    }

    if (sites.length === 0) {
      const displayAgents = agentsWithTests.slice(0, 100);
      const scoped = buildAllAgentScopedTests(displayAgents);
      await prisma.metricSnapshot.create({
        data: {
          siteId: null,
          source: "thousandeyes",
          payload: {
            agents: displayAgents.map(slimAgentSnapshot),
            httpTests: scoped.httpTests,
            testsByAgentId: scoped.testsByAgentId,
            agentToServerTests: scoped.agentToServerTests,
            agentToServerTestsByAgentId: scoped.agentToServerTestsByAgentId,
            agentToAgentTests: scoped.agentToAgentTests,
            agentToAgentTestsByAgentId: scoped.agentToAgentTestsByAgentId,
            matchedByTag: false,
            endpointAgents: [],
          },
        },
      });
    }

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date() },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), errorSummary: msg.slice(0, 2000) },
    });
  }
}
