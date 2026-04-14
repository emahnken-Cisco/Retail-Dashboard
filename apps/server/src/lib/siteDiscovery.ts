import { prisma } from "./prisma.js";
import { decryptSecret } from "./cryptoVault.js";
import { listOrganizations, listNetworks, listNetworkDevices } from "./merakiClient.js";
import { getAdminSettings } from "./settings.js";
import { teFetch } from "./thousandEyesClient.js";

export type TEAgentFull = {
  agentId: number;
  agentName?: string;
  agentType?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  /** TE API variants */
  lat?: number;
  lng?: number;
  long?: number;
  prefix?: string;
  suffix?: string;
  [key: string]: unknown;
};

type TEAgentsEnvelope = { agents?: TEAgentFull[] };

function isEnterpriseAgent(a: TEAgentFull): boolean {
  return String(a.agentType ?? "")
    .toLowerCase()
    .includes("enterprise");
}

/** Heuristic: TE agent is treated as Meraki-related when metadata suggests Meraki/Cisco edge deployment. */
export function isMerakiIdentifiedAgent(a: TEAgentFull): boolean {
  if (!isEnterpriseAgent(a)) {
    return false;
  }
  const blob = JSON.stringify(a).toLowerCase();
  if (blob.includes("meraki")) {
    return true;
  }
  const name = String(a.agentName ?? "");
  if (/\bmx\d{2,4}\b/i.test(name) || /\bmr\d{2,4}\b/i.test(name)) {
    return true;
  }
  const loc = String(a.location ?? "").toLowerCase();
  if (loc.includes("meraki") || loc.includes("cisco store")) {
    return true;
  }
  return false;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/u)
      .filter((w) => w.length > 1),
  );
}

function tokenOverlapScore(agent: TEAgentFull, networkName: string, orgName: string): number {
  const parts = [agent.agentName, agent.location, agent.prefix, agent.suffix]
    .filter(Boolean)
    .join(" ");
  const a = tokenize(parts);
  const b = tokenize(`${networkName} ${orgName}`);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) {
      inter += 1;
    }
  }
  return inter / Math.max(a.size, b.size);
}

type NetworkRow = {
  networkId: string;
  networkName: string;
  organizationId: string;
  organizationName: string;
};

async function getMerakiKey(): Promise<string | null> {
  const row = await prisma.credentialVault.findUnique({ where: { provider: "meraki" } });
  if (!row) {
    return null;
  }
  return decryptSecret(row.encryptedValue, row.iv, row.authTag);
}

async function getTeToken(): Promise<string | null> {
  const row = await prisma.credentialVault.findUnique({ where: { provider: "thousandeyes" } });
  if (!row) {
    return null;
  }
  return decryptSecret(row.encryptedValue, row.iv, row.authTag);
}

async function loadAllNetworks(apiKey: string): Promise<NetworkRow[]> {
  const orgs = await listOrganizations(apiKey);
  const rows: NetworkRow[] = [];
  for (const org of orgs) {
    const nets = await listNetworks(apiKey, org.id);
    for (const n of nets) {
      rows.push({
        networkId: n.id,
        networkName: n.name,
        organizationId: org.id,
        organizationName: org.name,
      });
    }
  }
  return rows;
}

async function networkLatLng(
  apiKey: string,
  networkId: string,
): Promise<{ lat: number | null; lng: number | null; devicesSample: unknown[] }> {
  const devices = await listNetworkDevices(apiKey, networkId);
  const mxMr = devices.filter(
    (d) =>
      String(d.model ?? "")
        .toUpperCase()
        .startsWith("MX") ||
      String(d.model ?? "")
        .toUpperCase()
        .startsWith("MR") ||
      String(d.model ?? "")
        .toUpperCase()
        .startsWith("CW"),
  );
  const withGeo = mxMr.find((d) => d.lat != null && d.lng != null) ?? devices.find((d) => d.lat != null && d.lng != null);
  const sample = mxMr.slice(0, 15).map((d) => ({
    name: d.name,
    model: d.model,
    serial: d.serial,
    lat: d.lat,
    lng: d.lng,
    address: d.address,
    status: d.status,
  }));
  return {
    lat: withGeo?.lat ?? null,
    lng: withGeo?.lng ?? null,
    devicesSample: sample,
  };
}

export type SiteDiscoverySuggestion = {
  suggestionKey: string;
  name: string;
  merakiNetworkId: string | null;
  merakiOrganizationId: string | null;
  merakiOrganizationName: string | null;
  merakiNetworkName: string | null;
  thousandEyesAgentId: number;
  thousandEyesTag: string;
  lat: number | null;
  lng: number | null;
  matchScore: number;
  thousandEyes: TEAgentFull;
  meraki: {
    network: NetworkRow | null;
    lat: number | null;
    lng: number | null;
    devicesSample: unknown[];
  };
};

export async function discoverSiteSuggestions(options: {
  includeAllEnterprise: boolean;
}): Promise<{ suggestions: SiteDiscoverySuggestion[]; warnings: string[] }> {
  const warnings: string[] = [];
  const merakiKey = await getMerakiKey();
  const teToken = await getTeToken();
  if (!teToken) {
    throw new Error("ThousandEyes API token not configured");
  }
  if (!merakiKey) {
    warnings.push("Meraki API key not configured — suggestions will include TE agents only (no Meraki network match).");
  }

  const admin = await getAdminSettings();
  const teAid = admin.thousandEyesAid?.trim() || "";
  const agentsQs = teAid ? `?aid=${encodeURIComponent(teAid)}` : "";
  const data = await teFetch<TEAgentsEnvelope>(teToken, `/agents${agentsQs}`);
  const allAgents = data.agents ?? [];
  const candidates = allAgents.filter((a) => {
    if (!isEnterpriseAgent(a)) {
      return false;
    }
    if (options.includeAllEnterprise) {
      return true;
    }
    return isMerakiIdentifiedAgent(a);
  });

  if (candidates.length === 0) {
    return { suggestions: [], warnings: [...warnings, "No matching enterprise agents. Try enabling “all enterprise agents” or verify Meraki-related agent naming in ThousandEyes."] };
  }

  let networks: NetworkRow[] = [];
  if (merakiKey) {
    networks = await loadAllNetworks(merakiKey);
  }

  const existing = await prisma.site.findMany({
    select: { merakiNetworkId: true, thousandEyesTag: true, name: true },
  });
  const existingNetworkIds = new Set(existing.map((s) => s.merakiNetworkId).filter(Boolean) as string[]);
  const existingTeTags = new Set(existing.map((s) => s.thousandEyesTag).filter(Boolean) as string[]);

  const suggestions: SiteDiscoverySuggestion[] = [];
  const geoCache = new Map<string, { lat: number | null; lng: number | null; devicesSample: unknown[] }>();

  for (const agent of candidates) {
    const agentId = agent.agentId;
    const tagBase = String(agent.agentName ?? `agent-${agentId}`).trim() || `agent-${agentId}`;
    const thousandEyesTag = tagBase.slice(0, 500);

    let best: { net: NetworkRow; score: number } | null = null;
    for (const net of networks) {
      const score = tokenOverlapScore(agent, net.networkName, net.organizationName);
      if (!best || score > best.score) {
        best = { net, score };
      }
    }

    const matchScore = best?.score ?? 0;
    const useNetwork = best && matchScore >= 0.12;
    const net = useNetwork ? best!.net : null;

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    let lat = num(agent.latitude) ?? num(agent.lat) ?? null;
    let lng = num(agent.longitude) ?? num(agent.lng) ?? num(agent.long) ?? null;
    let devicesSample: unknown[] = [];

    if (merakiKey && net) {
      if (!geoCache.has(net.networkId)) {
        geoCache.set(net.networkId, await networkLatLng(merakiKey, net.networkId));
      }
      const geo = geoCache.get(net.networkId)!;
      devicesSample = geo.devicesSample;
      if (geo.lat != null && geo.lng != null) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    const name =
      net && useNetwork
        ? net.networkName
        : tagBase.length > 80
          ? `${tagBase.slice(0, 77)}…`
          : tagBase;

    const merakiNetworkId = net && useNetwork ? net.networkId : null;
    if (merakiNetworkId && existingNetworkIds.has(merakiNetworkId)) {
      continue;
    }
    if (existingTeTags.has(thousandEyesTag)) {
      continue;
    }

    suggestions.push({
      suggestionKey: `${agentId}-${merakiNetworkId ?? "nomeraki"}`,
      name,
      merakiNetworkId,
      merakiOrganizationId: net && useNetwork ? net.organizationId : null,
      merakiOrganizationName: net && useNetwork ? net.organizationName : null,
      merakiNetworkName: net && useNetwork ? net.networkName : null,
      thousandEyesAgentId: agentId,
      thousandEyesTag,
      lat,
      lng,
      matchScore,
      thousandEyes: agent,
      meraki: {
        network: net && useNetwork ? net : null,
        lat,
        lng,
        devicesSample,
      },
    });
  }

  suggestions.sort((a, b) => b.matchScore - a.matchScore);
  return { suggestions, warnings };
}
