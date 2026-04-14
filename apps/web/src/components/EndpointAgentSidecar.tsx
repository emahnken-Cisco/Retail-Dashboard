import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api.js";

type EndpointDetailResponse = {
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const th: CSSProperties = {
  textAlign: "left",
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
  padding: "0.35rem 0.45rem",
  borderBottom: "1px solid var(--surface2)",
};
const td: CSSProperties = {
  fontSize: "0.78rem",
  padding: "0.35rem 0.45rem",
  borderBottom: "1px solid var(--surface2)",
  verticalAlign: "top",
};

function AgentFieldGrid({ agent }: { agent: unknown }) {
  if (!isRecord(agent)) {
    return <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No agent payload.</p>;
  }
  const a = agent;
  const clients = Array.isArray(a.clients) ? a.clients : [];
  let userLine = "—";
  if (clients.length > 0 && isRecord(clients[0])) {
    const up = clients[0].userProfile;
    if (isRecord(up)) {
      userLine = String(up.userPrincipalName || up.userName || "—");
    }
  }
  const rows: [string, string][] = [
    ["Computer name", String(a.computerName ?? "—")],
    ["Agent name", String(a.name ?? "—")],
    ["Platform", String(a.platform ?? "—")],
    ["OS version", String(a.osVersion ?? "—")],
    ["Kernel", String(a.kernelVersion ?? "—")],
    ["Manufacturer / model", `${String(a.manufacturer ?? "—")} · ${String(a.model ?? "—")}`],
    ["Public IP", String(a.publicIP ?? "—")],
    ["Total memory (agent)", String(a.totalMemory ?? "—")],
    ["Agent version", String(a.version ?? "—")],
    ["Last seen", a.lastSeen ? new Date(String(a.lastSeen)).toLocaleString() : "—"],
    ["Logged-in user", userLine],
    ["Status", String(a.status ?? "—")],
  ];
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 38%) 1fr",
        gap: "0.35rem 0.75rem",
        margin: 0,
        fontSize: "0.8rem",
      }}
    >
      {rows.map(([k, v]) => (
        <FragmentRow key={k} k={k} v={v} />
      ))}
    </dl>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: "var(--muted)", margin: 0 }}>{k}</dt>
      <dd style={{ margin: 0, wordBreak: "break-word" }}>{v}</dd>
    </>
  );
}

export function EndpointAgentSidecar({
  siteId,
  agentId,
  subtitle,
  open,
  onClose,
}: {
  siteId: string;
  agentId: string | null;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<EndpointDetailResponse | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !siteId || !agentId) {
      return;
    }
    setLoading(true);
    setErr("");
    setData(null);
    void api<EndpointDetailResponse>(
      `/api/dashboard/sites/${encodeURIComponent(siteId)}/endpoint-agents/${encodeURIComponent(agentId)}/detail`,
    )
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, siteId, agentId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !agentId) {
    return null;
  }

  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 1100,
        }}
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      />
      <aside
        className="card"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(460px, 100vw)",
          maxWidth: "100%",
          zIndex: 1110,
          margin: 0,
          borderRadius: "12px 0 0 12px",
          borderRight: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "0.75rem",
            padding: "1rem 1rem 0.75rem",
            borderBottom: "1px solid var(--surface2)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.3 }}>Endpoint agent</h2>
            {subtitle ? (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>{subtitle}</p>
            ) : null}
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
              {agentId}
            </p>
          </div>
          <button type="button" className="btn secondary" style={{ flexShrink: 0 }} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ padding: "0.85rem 1rem", overflowY: "auto", flex: 1 }}>
          {loading ? <p style={{ color: "var(--muted)" }}>Loading live detail from ThousandEyes…</p> : null}
          {err ? (
            <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{err}</p>
          ) : null}
          {data ? (
            <>
              <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>Machine</h3>
              <AgentFieldGrid agent={data.agent} />

              <h3 style={{ margin: "1rem 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Connectivity & metrics
              </h3>
              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 42%) 1fr",
                  gap: "0.35rem 0.75rem",
                  margin: 0,
                  fontSize: "0.8rem",
                }}
              >
                <dt style={{ color: "var(--muted)", margin: 0 }}>Connectivity</dt>
                <dd style={{ margin: 0 }}>{data.summary.connectivityType}</dd>
                <dt style={{ color: "var(--muted)", margin: 0 }}>DNS servers</dt>
                <dd style={{ margin: 0, wordBreak: "break-word" }}>{data.summary.dnsServers}</dd>
                <dt style={{ color: "var(--muted)", margin: 0 }}>CPU (path-vis window)</dt>
                <dd style={{ margin: 0 }}>{data.summary.cpuSummary}</dd>
                <dt style={{ color: "var(--muted)", margin: 0 }}>Memory (path-vis window)</dt>
                <dd style={{ margin: 0 }}>{data.summary.memorySummary}</dd>
              </dl>
              {data.summary.telemetrySourceTestId ? (
                <p style={{ margin: "0.65rem 0 0", fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
                  CPU / memory / DNS above come from the latest <strong>network (path vis)</strong> sample for
                  scheduled test <code>{data.summary.telemetrySourceTestId}</code> when available.
                </p>
              ) : (
                <p style={{ margin: "0.65rem 0 0", fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
                  No recent path-visualization sample tied this agent to a network test in the last 24h; connectivity may
                  still be inferred from the agent profile.
                </p>
              )}

              <h3 style={{ margin: "1rem 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                Scheduled tests targeting this agent
              </h3>
              {data.tests.length === 0 ? (
                <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>No matching scheduled tests.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={th}>Test</th>
                        <th style={th}>Type</th>
                        <th style={th}>Target</th>
                        <th style={th}>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tests.map((t) => (
                        <tr key={t.testId + t.type}>
                          <td style={td}>
                            {t.testName}
                            <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                              {t.enabled ? "Enabled" : "Disabled"} · {t.testId}
                            </div>
                          </td>
                          <td style={{ ...td, color: "var(--muted)", fontSize: "0.72rem" }}>{t.type}</td>
                          <td style={{ ...td, wordBreak: "break-all", fontSize: "0.72rem" }}>{t.target}</td>
                          <td style={{ ...td, fontSize: "0.72rem", lineHeight: 1.35 }}>{t.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
