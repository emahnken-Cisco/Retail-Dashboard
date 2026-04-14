import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type ConnectivityKind = "DIA" | "BROADBAND" | "SATELLITE" | "CELLULAR_4G_5G";

const KIND_LABELS: Record<ConnectivityKind, string> = {
  DIA: "Direct Internet Access (DIA)",
  BROADBAND: "Broadband",
  SATELLITE: "Satellite (e.g. Starlink)",
  CELLULAR_4G_5G: "4G / 5G cellular",
};

/** Human-readable outage length (uses closed end time or “so far” for ongoing). */
function formatOutageDuration(seconds: number, ongoing: boolean): string {
  if (seconds < 60) {
    return ongoing ? `${seconds}s so far` : `${seconds}s`;
  }
  const m = Math.floor(seconds / 60);
  if (m < 60) {
    return ongoing ? `${m} min so far` : `${m} min`;
  }
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const base = rem > 0 ? `${h} h ${rem} min` : `${h} h`;
  return ongoing ? `${base} so far` : base;
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.4rem 0.45rem",
  borderBottom: "1px solid var(--surface2)",
  color: "var(--muted)",
  fontSize: "0.75rem",
  fontWeight: 600,
};
const td: CSSProperties = { padding: "0.35rem 0.45rem", borderTop: "1px solid var(--surface2)", fontSize: "0.8rem" };

type ReportPayload = {
  days?: number;
  since?: string;
  last24HoursSince?: string;
  totals?: {
    outageEvents: number;
    uniqueCircuitsAffected: number;
    outageStartsLast24h?: number;
  };
  byProvider?: Array<{ key: string; outageStarts: number; openEnded: number }>;
  byConnectivityKind?: Array<{ key: string; outageStarts: number; openEnded: number }>;
  topCircuitsByOutageCount?: Array<{
    circuitId: string;
    providerName: string;
    locationName: string;
    connectivityKind: string;
    outageStarts: number;
    openEnded: number;
    outageStartsLast24h?: number;
  }>;
  recentEvents?: Array<{
    id?: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    ongoing: boolean;
    locationName: string;
    providerName: string;
    carrierCircuitId: string;
    merakiInterface: string;
    statusObserved: string;
  }>;
};

type CircuitEventsPayload = {
  days?: number;
  since?: string;
  /** Present when the CircuitEvent table is missing (migrations not applied). */
  storageWarning?: string;
  events?: Array<{
    id: string;
    detectedAt: string;
    kind: string;
    kindLabel: string;
    previousValue: string | null;
    newValue: string | null;
    note: string | null;
    locationName: string;
    providerName: string;
    carrierCircuitId: string;
    merakiInterface: string;
    connectivityKind: string;
    relatedOutage: { id: string; startedAt: string; endedAt: string | null } | null;
  }>;
};

export function ReportingPage() {
  const [err, setErr] = useState("");
  const [reportDays, setReportDays] = useState(30);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [circuitEventDays, setCircuitEventDays] = useState(30);
  const [circuitEvents, setCircuitEvents] = useState<CircuitEventsPayload | null>(null);
  const [circuitEventsErr, setCircuitEventsErr] = useState("");

  async function loadReport() {
    setErr("");
    try {
      const r = await api<ReportPayload>(
        `/api/circuits/reports/outage-summary?days=${encodeURIComponent(String(reportDays))}`,
      );
      setReport(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Report failed");
      setReport(null);
    }
  }

  async function loadCircuitEvents() {
    setCircuitEventsErr("");
    try {
      const r = await api<CircuitEventsPayload>(
        `/api/circuits/circuit-events?days=${encodeURIComponent(String(circuitEventDays))}`,
      );
      setCircuitEvents(r);
    } catch (e) {
      setCircuitEventsErr(e instanceof Error ? e.message : "Failed to load circuit events");
      setCircuitEvents(null);
    }
  }

  useEffect(() => {
    void loadCircuitEvents();
  }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Reporting</h1>
      <p style={{ color: "var(--muted)", maxWidth: "54rem", lineHeight: 1.55 }}>
        Circuit outage statistics and WAN observations from Meraki ingest. Configure circuits on the{" "}
        <Link to="/circuits">Circuits</Link> tab. <strong>Circuit events</strong> record changes such as public IP
        reassignment (often after carrier activity); when a change follows a recent outage recovery, it is linked for
        context.
      </p>

      {err ? (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem" }} role="alert">
          {err}
        </p>
      ) : null}

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Outage reporting</h2>
        <p style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 0 }}>
          Counts outage <em>starts</em> in the window (from Meraki ingest deltas). “Open ended” = events not yet cleared
          in the data.
          {report?.last24HoursSince ?
            <>
              {" "}
              <strong>Last 24h</strong> counts are outage starts since{" "}
              {new Date(report.last24HoursSince).toLocaleString()} (rolling window).
            </>
          : null}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <label className="label" htmlFor="rep-days" style={{ margin: 0 }}>
            Days
          </label>
          <select
            id="rep-days"
            className="input"
            style={{ width: "5rem" }}
            value={reportDays}
            onChange={(e) => setReportDays(Number.parseInt(e.target.value, 10) || 30)}
          >
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={90}>90</option>
          </select>
          <button type="button" className="btn" onClick={() => void loadReport()}>
            Run report
          </button>
        </div>
        {report?.totals ?
          <p style={{ fontSize: "0.88rem" }}>
            <strong>{report.totals.outageEvents}</strong> outage events ·{" "}
            <strong>{report.totals.uniqueCircuitsAffected}</strong> circuits affected
            {typeof report.totals.outageStartsLast24h === "number" ? (
              <>
                {" "}
                · <strong>{report.totals.outageStartsLast24h}</strong> outage starts in last 24 hours
              </>
            ) : null}
          </p>
        : null}
        {report?.byProvider && report.byProvider.length > 0 ?
          <div style={{ marginTop: "0.75rem" }}>
            <h3 style={{ fontSize: "0.95rem" }}>By provider</h3>
            <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
              {report.byProvider.map((r) => (
                <li key={r.key}>
                  {r.key}: {r.outageStarts} starts ({r.openEnded} open)
                </li>
              ))}
            </ul>
          </div>
        : null}
        {report?.byConnectivityKind && report.byConnectivityKind.length > 0 ?
          <div style={{ marginTop: "0.75rem" }}>
            <h3 style={{ fontSize: "0.95rem" }}>By connectivity type</h3>
            <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
              {report.byConnectivityKind.map((r) => (
                <li key={r.key}>
                  {KIND_LABELS[r.key as ConnectivityKind] ?? r.key}: {r.outageStarts} starts ({r.openEnded} open)
                </li>
              ))}
            </ul>
          </div>
        : null}
        {report?.topCircuitsByOutageCount && report.topCircuitsByOutageCount.length > 0 ?
          <div style={{ marginTop: "0.75rem" }}>
            <h3 style={{ fontSize: "0.95rem" }}>Circuits with most outage starts</h3>
            <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
              {report.topCircuitsByOutageCount.map((r) => (
                <li key={r.circuitId}>
                  {r.locationName} — {r.providerName} ({r.connectivityKind}): {r.outageStarts} starts in selected window
                  {typeof r.outageStartsLast24h === "number" ? (
                    <>
                      {" "}
                      · <strong>{r.outageStartsLast24h}</strong> starts in last 24h
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        : null}
        {report?.recentEvents && report.recentEvents.length > 0 ?
          <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
            <h3 style={{ fontSize: "0.95rem" }}>Recent events</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  <th style={th}>Started</th>
                  <th style={th}>Ended</th>
                  <th style={th}>Duration</th>
                  <th style={th}>Location</th>
                  <th style={th}>Provider</th>
                  <th style={th}>Circuit</th>
                  <th style={th}>Iface</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.recentEvents.map((ev, i) => (
                  <tr key={ev.id ?? i}>
                    <td style={td}>{new Date(ev.startedAt).toLocaleString()}</td>
                    <td style={td}>{ev.endedAt ? new Date(ev.endedAt).toLocaleString() : "—"}</td>
                    <td style={td}>
                      {typeof ev.durationSeconds === "number" ?
                        formatOutageDuration(ev.durationSeconds, Boolean(ev.ongoing))
                      : "—"}
                    </td>
                    <td style={td}>{ev.locationName}</td>
                    <td style={td}>{ev.providerName}</td>
                    <td style={td}>{ev.carrierCircuitId}</td>
                    <td style={td}>
                      <code>{ev.merakiInterface}</code>
                    </td>
                    <td style={td}>{ev.statusObserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        : null}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Circuit events</h2>
        <p style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 0 }}>
          Compared across consecutive Meraki snapshots per circuit. <strong>Public IP change</strong> uses the WAN
          uplink&apos;s public IP from Meraki telemetry (same interface as the circuit mapping).
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <label className="label" htmlFor="ce-days" style={{ margin: 0 }}>
            Days
          </label>
          <select
            id="ce-days"
            className="input"
            style={{ width: "5rem" }}
            value={circuitEventDays}
            onChange={(e) => setCircuitEventDays(Number.parseInt(e.target.value, 10) || 30)}
          >
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={90}>90</option>
          </select>
          <button type="button" className="btn" onClick={() => void loadCircuitEvents()}>
            Load events
          </button>
        </div>
        {circuitEventsErr ? (
          <p style={{ color: "var(--danger)", fontSize: "0.9rem" }} role="alert">
            {circuitEventsErr}
          </p>
        ) : null}
        {circuitEvents?.storageWarning ? (
          <p style={{ color: "var(--warning, #b45309)", fontSize: "0.85rem", marginBottom: "0.75rem" }} role="status">
            {circuitEvents.storageWarning}
          </p>
        ) : null}
        {circuitEvents?.events && circuitEvents.events.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  <th style={th}>Detected</th>
                  <th style={th}>Type</th>
                  <th style={th}>Previous</th>
                  <th style={th}>New</th>
                  <th style={th}>Location</th>
                  <th style={th}>Provider / circuit</th>
                  <th style={th}>Iface</th>
                  <th style={th}>Related outage</th>
                  <th style={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {circuitEvents.events.map((ev) => (
                  <tr key={ev.id}>
                    <td style={td}>{new Date(ev.detectedAt).toLocaleString()}</td>
                    <td style={td}>{ev.kindLabel}</td>
                    <td style={td}>{ev.previousValue ?? "—"}</td>
                    <td style={td}>{ev.newValue ?? "—"}</td>
                    <td style={td}>{ev.locationName}</td>
                    <td style={td}>
                      {ev.providerName} — {ev.carrierCircuitId}
                    </td>
                    <td style={td}>
                      <code>{ev.merakiInterface}</code>
                    </td>
                    <td style={td}>
                      {ev.relatedOutage ? (
                        <span style={{ fontSize: "0.72rem", lineHeight: 1.35 }}>
                          Ended {ev.relatedOutage.endedAt ? new Date(ev.relatedOutage.endedAt).toLocaleString() : "—"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 220 }}>{ev.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {circuitEvents && (!circuitEvents.events || circuitEvents.events.length === 0) && !circuitEventsErr
        && !circuitEvents.storageWarning ? (
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>
            No circuit events in this window. Events appear after Meraki ingest compares two snapshots and detects a
            change (e.g. new public IP on the mapped WAN).
          </p>
        ) : null}
      </section>
    </div>
  );
}
