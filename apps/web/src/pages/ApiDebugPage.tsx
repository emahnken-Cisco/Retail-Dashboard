import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { fetchApiDebug, type ApiDebugResult } from "../lib/debugApi.js";
import { maskSecretText } from "../lib/maskSecret.js";
import { canClearOutboundTraces, type UserRole } from "../lib/roles.js";

type OutboundTraceEntry = {
  id: string;
  ts: string;
  provider: string;
  method: string;
  urlDisplay: string;
  status: number | null;
  durationMs: number;
  ok: boolean;
  errorMessage?: string;
  responsePreview?: string;
};

type Preset = {
  label: string;
  method: "GET" | "POST";
  path: string;
  hint?: string;
};

const PRESETS: Preset[] = [
  { label: "GET /api/health", method: "GET", path: "/api/health" },
  { label: "GET /api/auth/me", method: "GET", path: "/api/auth/me" },
  { label: "GET /api/session/config", method: "GET", path: "/api/session/config" },
  { label: "GET /api/admin/settings", method: "GET", path: "/api/admin/settings" },
  { label: "GET /api/admin/ingest-runs", method: "GET", path: "/api/admin/ingest-runs" },
  { label: "GET /api/credentials (masked)", method: "GET", path: "/api/credentials" },
  { label: "GET /api/sites", method: "GET", path: "/api/sites" },
  { label: "GET /api/dashboard/sites", method: "GET", path: "/api/dashboard/sites" },
  {
    label: "GET /api/sites/discover",
    method: "GET",
    path: "/api/sites/discover?includeAllEnterprise=false",
    hint: "Calls Meraki and ThousandEyes; may be slow.",
  },
  {
    label: "POST /api/integrations/meraki/test",
    method: "POST",
    path: "/api/integrations/meraki/test",
    hint: "Uses saved Meraki key.",
  },
  {
    label: "POST /api/integrations/thousandeyes/test",
    method: "POST",
    path: "/api/integrations/thousandeyes/test",
    hint: "Uses saved ThousandEyes token.",
  },
  {
    label: "GET /api/debug/outbound-traces",
    method: "GET",
    path: "/api/debug/outbound-traces",
    hint: "Server log of outbound Meraki / TE / OpenWeather HTTP calls (same data as the live panel below).",
  },
];

function presetsForRole(role: UserRole | undefined): Preset[] {
  if (role === "ORG_ADMIN") {
    return PRESETS;
  }
  return PRESETS.filter(
    (p) =>
      p.method === "GET" &&
      !p.path.includes("/api/credentials") &&
      !p.path.includes("/api/admin/") &&
      !p.path.includes("/api/integrations/"),
  );
}

export function ApiDebugPage() {
  const { user } = useAuth();
  const role = user?.role;
  const presetRows = useMemo(() => presetsForRole(role), [role]);
  const canClearTraces = canClearOutboundTraces(role);
  const [customPath, setCustomPath] = useState("/api/");
  const [customMethod, setCustomMethod] = useState<"GET" | "POST">("GET");
  const [customBody, setCustomBody] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ApiDebugResult | null>(null);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [historySiteId, setHistorySiteId] = useState("");
  const [historySource, setHistorySource] = useState<"meraki" | "thousandeyes">("meraki");
  const [historyDays, setHistoryDays] = useState("14");
  const [outboundTraces, setOutboundTraces] = useState<OutboundTraceEntry[]>([]);
  const [outboundLive, setOutboundLive] = useState(true);
  const [outboundLoading, setOutboundLoading] = useState(false);
  const [expandedOutboundId, setExpandedOutboundId] = useState<string | null>(null);

  const loadOutboundTraces = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setOutboundLoading(true);
    }
    try {
      const r = await api<{ traces: OutboundTraceEntry[] }>("/api/debug/outbound-traces");
      setOutboundTraces(r.traces);
    } catch {
      /* ignore while polling */
    } finally {
      if (!opts?.silent) {
        setOutboundLoading(false);
      }
    }
  }, []);

  const outboundPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    void loadOutboundTraces();
  }, [loadOutboundTraces]);

  useEffect(() => {
    if (role !== "ORG_ADMIN" && customMethod === "POST") {
      setCustomMethod("GET");
    }
  }, [role, customMethod]);

  useEffect(() => {
    if (outboundLive) {
      outboundPollRef.current = setInterval(() => void loadOutboundTraces({ silent: true }), 2000);
      return () => {
        if (outboundPollRef.current) {
          clearInterval(outboundPollRef.current);
        }
      };
    }
    if (outboundPollRef.current) {
      clearInterval(outboundPollRef.current);
    }
    return undefined;
  }, [outboundLive, loadOutboundTraces]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api<{ sites: { id: string; name: string }[] }>("/api/sites");
        setSites(r.sites);
        if (r.sites[0]) {
          setHistorySiteId(r.sites[0].id);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const run = useCallback(async (path: string, method: "GET" | "POST", body?: string) => {
    setErr("");
    setLoading(true);
    setResult(null);
    try {
      const init: RequestInit =
        method === "POST"
          ? { method: "POST", body: body ?? "{}" }
          : { method: "GET" };
      const out = await fetchApiDebug(path, init);
      setResult(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const runCustom = () => {
    void run(customPath, customMethod, customMethod === "POST" ? customBody : undefined);
  };

  const copyBody = () => {
    if (!result) {
      return;
    }
    const text =
      result.bodyJson != null ? JSON.stringify(result.bodyJson, null, 2) : result.bodyText;
    void navigator.clipboard.writeText(maskSecretText(text));
  };

  const historyPath =
    historySiteId &&
    `/api/dashboard/history/${encodeURIComponent(historySiteId)}?source=${encodeURIComponent(historySource)}&days=${encodeURIComponent(historyDays)}`;

  return (
    <div>
      <h1>API debug</h1>
      <p style={{ color: "var(--muted)", maxWidth: 720 }}>
        Inspect JSON responses from this app&apos;s API using your current session. The{" "}
        <strong>Outbound API trace</strong> panel shows HTTP requests this <strong>server</strong> makes to Meraki,
        ThousandEyes, and OpenWeather (URLs and error bodies are redacted — no API keys in the trace).
      </p>
      <p style={{ color: "var(--warn)", fontSize: "0.85rem", maxWidth: 720 }}>
        Responses are proxied through the server and API keys, tokens, and passwords are redacted before they reach this
        page (shown as <code>[REDACTED]</code> or masked to the last 4 characters). Treat responses as sensitive anyway
        and avoid screen-sharing other operational data.
      </p>
      {role === "LOCATION_CIRCUIT" ? (
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", maxWidth: 720 }}>
          Your role can <strong>read</strong> API debug data. Presets exclude admin and integration-test calls; clearing
          the outbound trace buffer requires an organization admin.
        </p>
      ) : null}

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Outbound API trace (server → Meraki / ThousandEyes / OpenWeather)</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
          Each row is one outbound <code>fetch</code> from the retail-dashboard server. Failed responses include a
          short body preview (truncated). Successful calls do not store response bodies. Buffer holds the last ~250
          calls; clearing does not affect vendors.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
            <input type="checkbox" checked={outboundLive} onChange={(e) => setOutboundLive(e.target.checked)} />
            Auto-refresh every 2s
          </label>
          <button type="button" className="btn secondary" disabled={outboundLoading} onClick={() => void loadOutboundTraces()}>
            Refresh now
          </button>
          {canClearTraces ? (
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              await api("/api/debug/outbound-traces/clear", { method: "POST", body: "{}" });
              await loadOutboundTraces({ silent: true });
            }}
          >
            Clear trace buffer
          </button>
          ) : null}
          {outboundLoading ? <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading…</span> : null}
        </div>
        <div style={{ overflow: "auto", maxHeight: "min(55vh, 520px)", border: "1px solid var(--surface2)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead>
              <tr style={{ background: "var(--surface1)", textAlign: "left" }}>
                <th style={{ padding: "0.4rem 0.5rem" }}>Time (UTC)</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Provider</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Meth</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>HTTP</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>ms</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>URL / note</th>
                <th style={{ padding: "0.4rem 0.5rem" }} />
              </tr>
            </thead>
            <tbody>
              {outboundTraces.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "1rem", color: "var(--muted)" }}>
                    No outbound calls recorded yet. Run ingest, integration tests, site discovery, or open the dashboard
                    map (OpenWeather tile check) to populate this log.
                  </td>
                </tr>
              ) : (
                outboundTraces.map((t) => (
                  <Fragment key={t.id}>
                    <tr style={{ borderTop: "1px solid var(--surface2)" }}>
                      <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap", color: "var(--muted)" }}>
                        {t.ts.replace("T", " ").slice(0, 19)}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{t.provider}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{t.method}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>
                        {t.status == null ? (
                          <span style={{ color: "var(--danger)" }}>—</span>
                        ) : (
                          <span style={{ color: t.ok ? "var(--ok, #3dd68c)" : "var(--danger)" }}>{t.status}</span>
                        )}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{t.durationMs}</td>
                      <td style={{ padding: "0.35rem 0.5rem", wordBreak: "break-all", maxWidth: 360 }}>{t.urlDisplay}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>
                        {(t.responsePreview || t.errorMessage) && (
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ fontSize: "0.72rem", padding: "0.2rem 0.45rem" }}
                            onClick={() => setExpandedOutboundId((id) => (id === t.id ? null : t.id))}
                          >
                            {expandedOutboundId === t.id ? "Hide" : "Error detail"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedOutboundId === t.id ? (
                      <tr>
                        <td colSpan={7} style={{ padding: "0 0.75rem 0.75rem", background: "var(--surface1)" }}>
                          {t.errorMessage ? (
                            <pre
                              style={{
                                margin: 0,
                                fontSize: "0.75rem",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                color: "var(--danger)",
                              }}
                            >
                              {t.errorMessage}
                            </pre>
                          ) : null}
                          {t.responsePreview ? (
                            <pre
                              style={{
                                margin: t.errorMessage ? "0.5rem 0 0" : 0,
                                fontSize: "0.75rem",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {t.responsePreview}
                            </pre>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Presets</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {presetRows.map((p) => (
            <button
              key={`${p.method}:${p.path}`}
              type="button"
              className="btn secondary"
              disabled={loading}
              onClick={() => void run(p.path, p.method, p.method === "POST" ? "{}" : undefined)}
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Dashboard history</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
          GET snapshot history for a location (same data as the history chart).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
            <label className="label">Location</label>
            <select
              className="input"
              style={{ maxWidth: "100%" }}
              value={historySiteId}
              onChange={(e) => setHistorySiteId(e.target.value)}
            >
              {sites.length === 0 ? <option value="">No locations</option> : null}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Source</label>
            <select
              className="input"
              value={historySource}
              onChange={(e) => setHistorySource(e.target.value as "meraki" | "thousandeyes")}
            >
              <option value="meraki">meraki</option>
              <option value="thousandeyes">thousandeyes</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, width: 100 }}>
            <label className="label">Days</label>
            <input
              className="input"
              value={historyDays}
              onChange={(e) => setHistoryDays(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn secondary"
            disabled={loading || !historyPath}
            onClick={() => historyPath && void run(historyPath, "GET")}
          >
            GET history
          </button>
        </div>
        {historyPath ? (
          <code style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginTop: "0.75rem" }}>
            {historyPath}
          </code>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Custom request</h2>
        <div className="form-group">
          <label className="label">Method</label>
          <select
            className="input"
            style={{ maxWidth: 120 }}
            value={customMethod}
            onChange={(e) => setCustomMethod(e.target.value as "GET" | "POST")}
          >
            <option value="GET">GET</option>
            {role === "ORG_ADMIN" ? <option value="POST">POST</option> : null}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Path (must start with /api/)</label>
          <input
            className="input"
            style={{ maxWidth: "100%", width: "min(100%, 640px)" }}
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            spellCheck={false}
          />
        </div>
        {customMethod === "POST" ? (
          <div className="form-group">
            <label className="label">JSON body</label>
            <textarea
              className="input"
              style={{ width: "min(100%, 640px)", minHeight: 100, fontFamily: "ui-monospace, monospace" }}
              value={customBody}
              onChange={(e) => setCustomBody(e.target.value)}
              spellCheck={false}
            />
          </div>
        ) : null}
        <button type="button" className="btn" disabled={loading} onClick={() => void runCustom()}>
          Send
        </button>
      </section>

      {err ? (
        <p className="card" style={{ marginTop: "1rem", color: "var(--danger)", borderColor: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      {result ? (
        <section className="card" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <strong>Response</strong>
            <span
              style={{
                padding: "0.15rem 0.5rem",
                borderRadius: 6,
                fontSize: "0.8rem",
                fontWeight: 700,
                background: result.ok ? "rgba(61, 214, 140, 0.15)" : "rgba(240, 91, 91, 0.15)",
                color: result.ok ? "var(--ok)" : "var(--danger)",
              }}
            >
              {result.status}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              {result.method} {result.durationMs} ms
            </span>
            {result.contentType ? (
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{result.contentType}</span>
            ) : null}
            <button type="button" className="btn secondary" style={{ marginLeft: "auto" }} onClick={() => void copyBody()}>
              Copy body
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "0.75rem",
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--surface2)",
              fontSize: "0.75rem",
              overflow: "auto",
              maxHeight: "min(70vh, 720px)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {result.bodyJson != null
              ? maskSecretText(JSON.stringify(result.bodyJson, null, 2))
              : maskSecretText(result.bodyText) || "(empty body)"}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
