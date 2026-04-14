import {
  getEndpointAgentExpanded,
  getEndpointHttpServerResults,
  getEndpointPathVisResults,
  listEndpointScheduledTests,
  type TeAccountScope,
} from "./thousandEyesClient.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scheduledTestAppliesToAgent(test: Record<string, unknown>, agentId: string): boolean {
  if (test.isEnabled === false) {
    return false;
  }
  const cfg = test.agentSelectorConfig;
  if (!isRecord(cfg)) {
    return false;
  }
  const st = String(cfg.agentSelectorType ?? "");
  if (st === "all-agents") {
    return true;
  }
  if (st === "specific-agents") {
    const agents = cfg.agents;
    if (Array.isArray(agents)) {
      return agents.map(String).includes(agentId);
    }
  }
  return false;
}

function latestResultForAgent(results: unknown[], agentId: string): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestRound = -1;
  for (const r of results) {
    if (!isRecord(r)) {
      continue;
    }
    if (String(r.agentId ?? "") !== agentId) {
      continue;
    }
    const roundId = typeof r.roundId === "number" ? r.roundId : Number(r.roundId) || 0;
    if (roundId >= bestRound) {
      bestRound = roundId;
      best = r;
    }
  }
  return best;
}

function connectivityFromAgentPayload(agent: unknown): string | null {
  if (!isRecord(agent)) {
    return null;
  }
  const cell = agent.cellularProfile;
  if (isRecord(cell) && (cell.carrierName || cell.networkGen)) {
    const bits = [String(cell.carrierName ?? ""), String(cell.networkGen ?? cell.networkSubtype ?? "")].filter(
      Boolean,
    );
    return bits.length ? `Cellular · ${bits.join(" · ")}` : "Cellular";
  }
  const nifs = agent.networkInterfaceProfiles;
  if (Array.isArray(nifs)) {
    for (const raw of nifs) {
      if (!isRecord(raw)) {
        continue;
      }
      const wp = raw.wirelessProfile;
      if (isRecord(wp) && wp.ssid) {
        return `Wi‑Fi · ${String(wp.ssid)}${wp.rssi != null ? ` (RSSI ${String(wp.rssi)})` : ""}`;
      }
      if (raw.hardwareType === "ethernet") {
        const ep = raw.ethernetProfile;
        const spd = isRecord(ep) && ep.linkSpeed != null ? ` ${String(ep.linkSpeed)} Mbps` : "";
        return `Ethernet${spd}`;
      }
    }
  }
  const vpn = agent.vpnProfiles;
  if (Array.isArray(vpn) && vpn.length > 0 && isRecord(vpn[0])) {
    const v0 = vpn[0] as Record<string, unknown>;
    return `VPN · ${String(v0.vpnType ?? "active")}`;
  }
  return null;
}

function pickConnectivity(networkProfile: Record<string, unknown> | null): string {
  if (!networkProfile) {
    return "—";
  }
  const hw = String(networkProfile.hardwareType ?? "");
  const wp = networkProfile.wirelessProfile;
  if (isRecord(wp) && String(wp.ssid ?? "")) {
    return `Wi‑Fi (${String(wp.ssid)})${hw ? ` · ${hw}` : ""}`;
  }
  const ep = networkProfile.ethernetProfile;
  if (isRecord(ep) && ep.linkSpeed != null) {
    return `Ethernet · ${String(ep.linkSpeed)} Mbps`;
  }
  if (hw && hw !== "unknown") {
    return hw;
  }
  return "Unknown";
}

function formatDns(np: Record<string, unknown> | null): string {
  if (!np) {
    return "—";
  }
  const dns = np.dnsServers;
  if (Array.isArray(dns) && dns.length > 0) {
    return dns.map(String).join(", ");
  }
  return "—";
}

function formatCpuMem(sm: Record<string, unknown> | null): { cpu: string; memory: string } {
  if (!sm) {
    return { cpu: "—", memory: "—" };
  }
  const cpu = isRecord(sm.cpuUtilization) ? (sm.cpuUtilization as Record<string, unknown>) : null;
  const mem = isRecord(sm.physicalMemoryUsedBytes) ? (sm.physicalMemoryUsedBytes as Record<string, unknown>) : null;
  const total = sm.physicalMemoryTotalBytes;
  const cpuMean = cpu?.mean;
  const memMean = mem?.mean;
  const cpuStr =
    typeof cpuMean === "number" ? `${Math.round(cpuMean * 100)}% mean` : typeof cpuMean === "string" ? cpuMean : "—";
  let memStr = "—";
  if (typeof memMean === "number" && typeof total === "number" && total > 0) {
    const gbUsed = memMean / 1e9;
    const gbTot = total / 1e9;
    memStr = `${gbUsed.toFixed(1)} / ${gbTot.toFixed(1)} GB (mean est.)`;
  } else if (typeof memMean === "number") {
    memStr = `${(memMean / 1e9).toFixed(1)} GB used (mean est.)`;
  }
  return { cpu: cpuStr, memory: memStr };
}

function summarizePathVisRow(row: Record<string, unknown>): string {
  const traces = row.pathTraces;
  if (!Array.isArray(traces) || traces.length === 0) {
    return "Path vis (no hop summary)";
  }
  const t0 = traces[0];
  if (!isRecord(t0)) {
    return "Path vis";
  }
  const rtt = t0.responseTime;
  const hops = t0.numberOfHops;
  return `RTT ${rtt != null ? String(rtt) : "—"} ms · hops ${hops != null ? String(hops) : "—"}`;
}

function summarizeHttpRow(row: Record<string, unknown>): string {
  const m = isRecord(row.metrics) ? (row.metrics as Record<string, unknown>) : row;
  const dns = m.dnsTime ?? row.dnsTime;
  const connect = m.connectTime ?? row.connectTime;
  const wait = m.waitTime ?? row.waitTime;
  const receive = m.receiveTime ?? row.receiveTime;
  const parts: string[] = [];
  if (dns != null) {
    parts.push(`DNS ${String(dns)} ms`);
  }
  if (connect != null) {
    parts.push(`Conn ${String(connect)} ms`);
  }
  if (wait != null) {
    parts.push(`Wait ${String(wait)} ms`);
  }
  if (receive != null) {
    parts.push(`Rx ${String(receive)} ms`);
  }
  return parts.length ? parts.join(" · ") : "HTTP metrics";
}

export type EndpointAgentDashboardDetail = {
  agent: unknown;
  summary: {
    connectivityType: string;
    dnsServers: string;
    cpuSummary: string;
    memorySummary: string;
    telemetrySourceTestId: string | null;
  };
  tests: Array<{
    testId: string;
    testName: string;
    type: string;
    enabled: boolean;
    target: string;
    summary: string;
  }>;
};

export async function buildEndpointAgentDashboardDetail(
  token: string,
  agentId: string,
  teAid?: string | null,
): Promise<EndpointAgentDashboardDetail> {
  const scope: TeAccountScope | undefined = teAid?.trim() ? { aid: teAid.trim() } : undefined;
  const agent = await getEndpointAgentExpanded(token, agentId, scope);
  const allTests = await listEndpointScheduledTests(token, scope);
  const applicable = allTests.filter((t) => isRecord(t) && scheduledTestAppliesToAgent(t, agentId)) as Record<
    string,
    unknown
  >[];

  let bestRow: Record<string, unknown> | null = null;
  let bestTestId: string | null = null;
  let bestRound = -1;

  for (const t of applicable) {
    if (String(t.type ?? "") !== "agent-to-server") {
      continue;
    }
    if (t.networkMeasurements === false) {
      continue;
    }
    const tid = String(t.testId ?? "");
    if (!tid) {
      continue;
    }
    try {
      const pv = await getEndpointPathVisResults(token, tid, "24h", scope);
      const results = Array.isArray(pv.results) ? pv.results : [];
      for (const r of results) {
        if (!isRecord(r) || String(r.agentId ?? "") !== agentId) {
          continue;
        }
        const roundId = typeof r.roundId === "number" ? r.roundId : Number(r.roundId) || 0;
        if (roundId >= bestRound) {
          bestRound = roundId;
          bestRow = r;
          bestTestId = tid;
        }
      }
    } catch {
      /* skip test */
    }
  }

  const np = bestRow && isRecord(bestRow.networkProfile) ? (bestRow.networkProfile as Record<string, unknown>) : null;
  const sm = bestRow && isRecord(bestRow.systemMetrics) ? (bestRow.systemMetrics as Record<string, unknown>) : null;
  const { cpu, memory } = formatCpuMem(sm);
  const fromPath = pickConnectivity(np);
  const fromAgent = connectivityFromAgentPayload(agent);
  const connectivityType = fromPath !== "—" ? fromPath : fromAgent ?? "—";

  const testsOut: EndpointAgentDashboardDetail["tests"] = [];
  const slice = applicable.slice(0, 12);
  for (const t of slice) {
    const tid = String(t.testId ?? "");
    const typ = String(t.type ?? "");
    const name = String(t.testName ?? tid);
    const server = String(t.server ?? t.url ?? "—");
    let summary = "—";
    try {
      if (typ === "agent-to-server" && t.networkMeasurements !== false && tid) {
        const pv = await getEndpointPathVisResults(token, tid, "6h", scope);
        const results = Array.isArray(pv.results) ? pv.results : [];
        const row = latestResultForAgent(results, agentId);
        summary = row ? summarizePathVisRow(row) : "No samples for this agent in window";
      } else if (typ === "http-server" && tid) {
        const hr = await getEndpointHttpServerResults(token, tid, "6h", scope);
        const results = Array.isArray(hr.results) ? hr.results : [];
        const row = latestResultForAgent(results, agentId);
        summary = row ? summarizeHttpRow(row) : "No HTTP samples for this agent in window";
      }
    } catch {
      summary = "Could not load results";
    }
    testsOut.push({
      testId: tid,
      testName: name,
      type: typ,
      enabled: t.isEnabled !== false,
      target: server,
      summary,
    });
  }

  return {
    agent,
    summary: {
      connectivityType,
      dnsServers: formatDns(np),
      cpuSummary: cpu,
      memorySummary: memory,
      telemetrySourceTestId: bestTestId,
    },
    tests: testsOut,
  };
}
