import { prisma } from "../lib/prisma.js";
import { getAdminSettings } from "../lib/settings.js";
import { readFiniteCoord, resolveSiteCoordinates } from "../lib/siteCoordinates.js";
import { decryptSecret } from "../lib/cryptoVault.js";
import type { TEAgentWithAssignedTests } from "../lib/thousandEyesClient.js";
import { listAllEndpointAgents, listEnterpriseAgentsWithTests } from "../lib/thousandEyesClient.js";

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
  };
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
} {
  const http = buildScopedTests(agents, isHttpType, 100);
  const a2s = buildScopedTests(agents, isAgentToServerType, 100);
  return {
    httpTests: http.tests,
    testsByAgentId: http.testsByAgentId,
    agentToServerTests: a2s.tests,
    agentToServerTestsByAgentId: a2s.testsByAgentId,
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
    const agentsWithTests = await listEnterpriseAgentsWithTests(token, teScope);
    let endpointAgentPool: unknown[] = [];
    try {
      endpointAgentPool = await listAllEndpointAgents(token, 600, teScope);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[te ingest] list endpoint agents: ${msg.slice(0, 400)}`);
    }

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

      const endpointAgents = endpointAgentPool
        .filter(isRecord)
        .filter((a) => endpointAgentMatchesSite(a, site, effLat, effLng))
        .map(slimEndpointAgentRow)
        .filter((r) => r.id.length > 0)
        .slice(0, 120);

      const payload = {
        agents: displayAgents.map(slimAgentSnapshot),
        httpTests: scoped.httpTests,
        testsByAgentId: scoped.testsByAgentId,
        agentToServerTests: scoped.agentToServerTests,
        agentToServerTestsByAgentId: scoped.agentToServerTestsByAgentId,
        matchedByTag: Boolean(tag),
        endpointAgents,
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
