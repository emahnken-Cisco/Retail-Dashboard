/** ThousandEyes REST API v7 (v6 deprecated). See https://developer.cisco.com/docs/thousandeyes/ */
import { tracedFetch } from "./outboundTrace.js";

const TE_BASE = "https://api.thousandeyes.com/v7";

export async function teFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await tracedFetch(
    `${TE_BASE}${path}`,
    {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    },
    { provider: "thousandeyes" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ThousandEyes ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

export type TEAgent = {
  /** v7 may return string or number in JSON. */
  agentId: number | string;
  agentName?: string;
  location?: string;
  agentType?: string;
  agentState?: string;
};

/** Enterprise agent row from `GET /agents?expand=test`. */
export type TEAgentWithAssignedTests = TEAgent & {
  tests?: TETest[];
};

export type TETest = {
  /** v7 OpenAPI types this as string; JSON may still emit numbers for some accounts. */
  testId?: number | string;
  testName?: string;
  type?: string;
  enabled?: boolean;
};

export type TEAgentsResponse = { agents?: TEAgent[] };
export type TETestsResponse = { test?: TETest[]; tests?: TETest[] };

export type TeAccountScope = { aid?: string | null };

function appendAid(qs: URLSearchParams, scope?: TeAccountScope): void {
  const a = scope?.aid?.trim();
  if (a) {
    qs.set("aid", a);
  }
}

export async function listEnterpriseAgents(token: string, scope?: TeAccountScope): Promise<TEAgent[]> {
  const qs = new URLSearchParams();
  appendAid(qs, scope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await teFetch<TEAgentsResponse>(token, `/agents${suffix}`);
  return data.agents?.filter((a) => String(a.agentType || "").toLowerCase().includes("enterprise")) ?? [];
}

/** Enterprise agents with tests assigned to each agent (matches TE “running tests” per agent). */
export async function listEnterpriseAgentsWithTests(
  token: string,
  scope?: TeAccountScope,
): Promise<TEAgentWithAssignedTests[]> {
  const qs = new URLSearchParams();
  qs.set("agentTypes", "enterprise");
  qs.set("expand", "test");
  appendAid(qs, scope);
  const data = await teFetch<{ agents?: TEAgentWithAssignedTests[] }>(token, `/agents?${qs.toString()}`);
  return data.agents ?? [];
}

export async function listTests(token: string): Promise<TETest[]> {
  const data = await teFetch<TETestsResponse>(token, "/tests");
  return data.tests ?? data.test ?? [];
}

export async function getTestResults(
  token: string,
  testId: number | string,
  windowSec = 3600,
): Promise<unknown> {
  const from = Math.floor(Date.now() / 1000) - windowSec;
  const to = Math.floor(Date.now() / 1000);
  return teFetch(
    token,
    `/test-results/${encodeURIComponent(String(testId))}/http-server?from=${from}&to=${to}`,
  );
}

/** Follow absolute TE URLs (pagination `next` links). */
export async function teFetchAbsolute<T>(token: string, absoluteUrl: string): Promise<T> {
  const res = await tracedFetch(
    absoluteUrl,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    { provider: "thousandeyes", note: "absolute URL / pagination" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ThousandEyes ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

type TeHalLinks = { _links?: { next?: { href?: string } } };

/**
 * Paginated `GET /endpoint/agents` (UUID endpoint agents, not enterprise agents).
 *
 * `expand` (optional) is forwarded as the TE `expand` query param. Allowed
 * values include `networkInterfaceProfiles`, `vpnProfiles`, `clients` — pass
 * `["networkInterfaceProfiles"]` to retrieve current Wi‑Fi connection info
 * (SSID, BSSID, RSSI, signal-to-noise, wireless MAC) in the listing call so
 * downstream correlators don't need per-agent expansion fan-out.
 */
export async function listAllEndpointAgents(
  token: string,
  maxTotal = 500,
  scope?: TeAccountScope,
  expand?: ReadonlyArray<string>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  const initialQs = new URLSearchParams({ max: "100" });
  appendAid(initialQs, scope);
  for (const e of expand ?? []) {
    const v = String(e ?? "").trim();
    if (v) {
      initialQs.append("expand", v);
    }
  }
  let pathOrUrl: string | null = `/endpoint/agents?${initialQs.toString()}`;
  while (pathOrUrl && out.length < maxTotal) {
    const data = (pathOrUrl.startsWith("http")
      ? await teFetchAbsolute<Record<string, unknown>>(token, pathOrUrl)
      : await teFetch<Record<string, unknown>>(token, pathOrUrl)) as Record<string, unknown> & TeHalLinks;
    const batch = Array.isArray(data.agents) ? data.agents : [];
    out.push(...batch);
    const nextHref = data._links?.next?.href;
    if (!nextHref || batch.length === 0) {
      break;
    }
    pathOrUrl = nextHref;
  }
  return out.slice(0, maxTotal);
}

const ENDPOINT_AGENT_EXPAND = "vpnProfiles,networkInterfaceProfiles,clients";

export async function getEndpointAgentExpanded(
  token: string,
  agentId: string,
  scope?: TeAccountScope,
): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set("expand", ENDPOINT_AGENT_EXPAND);
  appendAid(qs, scope);
  return teFetch<unknown>(token, `/endpoint/agents/${encodeURIComponent(agentId)}?${qs.toString()}`);
}

export async function listEndpointScheduledTests(token: string, scope?: TeAccountScope): Promise<unknown[]> {
  const qs = new URLSearchParams();
  appendAid(qs, scope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await teFetch<Record<string, unknown>>(token, `/endpoint/tests/scheduled-tests${suffix}`);
  const tests = data.tests;
  return Array.isArray(tests) ? tests : [];
}

export async function getEndpointPathVisResults(
  token: string,
  testId: string,
  window = "24h",
  scope?: TeAccountScope,
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  qs.set("window", window);
  appendAid(qs, scope);
  return teFetch<Record<string, unknown>>(
    token,
    `/endpoint/test-results/scheduled-tests/${encodeURIComponent(testId)}/path-vis?${qs.toString()}`,
  );
}

/** HTTP component results for endpoint scheduled tests (DNS / connect / wait / receive). */
export async function getEndpointHttpServerResults(
  token: string,
  testId: string,
  window = "24h",
  scope?: TeAccountScope,
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  qs.set("window", window);
  appendAid(qs, scope);
  return teFetch<Record<string, unknown>>(
    token,
    `/endpoint/test-results/scheduled-tests/${encodeURIComponent(testId)}/http-server?${qs.toString()}`,
  );
}

// --- Tags API (v7): https://developer.cisco.com/docs/thousandeyes/tags-api-overview ---

export type TEAccountGroupRow = {
  aid?: string | number;
  accountGroupName?: string;
  isCurrentAccountGroup?: boolean;
  isDefaultAccountGroup?: boolean;
  organizationName?: string;
};

export async function listAccountGroups(token: string): Promise<TEAccountGroupRow[]> {
  const data = await teFetch<{ accountGroups?: TEAccountGroupRow[] }>(token, "/account-groups");
  return data.accountGroups ?? [];
}

export type TETagAssignmentRow = { id?: string; type?: string };

export type TETagRow = {
  id?: string;
  key?: string;
  value?: string;
  objectType?: string;
  type?: string;
  description?: string | null;
  color?: string;
  builtIn?: boolean;
  accessType?: string;
  assignments?: TETagAssignmentRow[];
};

export async function listTags(
  token: string,
  options?: { aid?: string; expandAssignments?: boolean },
): Promise<TETagRow[]> {
  const qs = new URLSearchParams();
  if (options?.aid) {
    qs.set("aid", String(options.aid));
  }
  if (options?.expandAssignments) {
    qs.append("expand", "assignments");
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await teFetch<{ tags?: TETagRow[] }>(token, `/tags${suffix}`);
  return data.tags ?? [];
}

export type TECreateTagBody = {
  key: string;
  value: string;
  objectType: string;
  type?: "static" | "dynamic";
  description?: string;
  color?: string;
  accessType?: string;
};

/** POST /tags — returns created tag (shape may wrap in `tag`). */
export async function createThousandEyesTag(
  token: string,
  body: TECreateTagBody,
  aid?: string,
): Promise<Record<string, unknown>> {
  const q = aid ? `?aid=${encodeURIComponent(aid)}` : "";
  const payload = { ...body, type: body.type ?? "static" };
  return teFetch<Record<string, unknown>>(token, `/tags${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** POST /tags/{id}/assign — cumulative assignments (207 Multi-Status is still `ok` in fetch). */
export async function assignThousandEyesTagToObjects(
  token: string,
  tagId: string,
  assignments: Array<{ id: string; type: string }>,
  aid?: string,
): Promise<unknown> {
  const q = aid ? `?aid=${encodeURIComponent(aid)}` : "";
  return teFetch<unknown>(token, `/tags/${encodeURIComponent(tagId)}/assign${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
}
