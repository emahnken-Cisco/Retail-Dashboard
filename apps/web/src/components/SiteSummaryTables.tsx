import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type {
  DashboardCircuit,
  MerakiAlertHistoryRow,
  MerakiDeviceRow,
  MerakiSnapshot,
  MerakiWanAppliance,
  MerakiWanUplinkDetail,
  LocationPinStatus,
  TEAgentRow,
  TEEndpointAgentRow,
  TESnapshot,
  TETestRow,
} from "../lib/sitePayloads.js";
import {
  alertsForDeviceSerial,
  circuitsMatchingUplink,
  filterEquipmentDevices,
  isMerakiCameraModel,
  isMerakiMrOrMs,
  normalizeMerakiUplinkParam,
  teAgentToServerTestsForSelection,
  teTestsForAgentSelection,
} from "../lib/sitePayloads.js";
import { EndpointAgentSidecar } from "./EndpointAgentSidecar.js";
import { MerakiCameraSidecar } from "./MerakiCameraSidecar.js";
import { MerakiEquipmentAlertsSidecar } from "./MerakiEquipmentAlertsSidecar.js";
import { LocationCircuitsSidecar, WanCircuitClickSidecar } from "./CircuitSidecars.js";
import { UplinkHistorySidecar } from "./UplinkHistorySidecar.js";
import { api } from "../api.js";
import { openWeatherIconTooltip } from "../lib/siteWeatherDisplay.js";
import { WeatherGlyph } from "./WeatherGlyph.js";

const th: CSSProperties = {
  textAlign: "left",
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
  padding: "0.35rem 0.5rem",
  borderBottom: "1px solid var(--surface2)",
  whiteSpace: "nowrap",
};
const td: CSSProperties = {
  fontSize: "0.8rem",
  padding: "0.35rem 0.5rem",
  borderBottom: "1px solid var(--surface2)",
  verticalAlign: "top",
};

function MiniTable({
  title,
  titleExtra,
  children,
  empty,
  maxBodyHeight = 220,
}: {
  title: string;
  titleExtra?: ReactNode;
  children: ReactNode;
  empty?: boolean;
  maxBodyHeight?: number;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--surface2)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "var(--muted)",
          padding: "0.4rem 0.55rem",
          background: "var(--surface2)",
          borderBottom: "1px solid var(--surface2)",
        }}
      >
        <span style={{ minWidth: 0 }}>{title}</span>
        {titleExtra ?? null}
      </div>
      {empty ? (
        <p style={{ margin: 0, padding: "0.6rem 0.55rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          No data in latest snapshot.
        </p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: maxBodyHeight }}>{children}</div>
      )}
    </div>
  );
}

const compactMaxHeight = 220;
const panelMaxHeight = 360;

/** Resolve appliance + WAN for uplink history from a dashboard circuit row. */
function uplinkHistoryFromDashboardCircuit(
  c: DashboardCircuit,
  meraki: MerakiSnapshot | null,
): { serial: string; model: string; uplink: string; status: string | null } | null {
  const uplink = normalizeMerakiUplinkParam(c.merakiInterface);
  if (!uplink) {
    return null;
  }
  const serial = c.merakiApplianceSerial?.trim() || meraki?.wan?.appliances?.[0]?.serial;
  if (!serial?.trim()) {
    return null;
  }
  const app = meraki?.wan?.appliances?.find((a) => a.serial === serial);
  const fallback = meraki?.wan?.appliances?.[0];
  const model = app?.model ?? fallback?.model ?? "—";
  let status: string | null = null;
  if (app) {
    const row = app.uplinks.find((u) => normalizeMerakiUplinkParam(u.interface) === uplink);
    status = row?.status ?? null;
  }
  return { serial, model, uplink, status };
}

function TestsTableBody({ rows }: { rows: TETestRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Test</th>
          <th style={th}>Type</th>
          <th style={th}>Enabled</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.testId + r.testName}>
            <td style={td}>{r.testName}</td>
            <td style={{ ...td, color: "var(--muted)" }}>{r.type}</td>
            <td style={td}>
              <span style={{ color: r.enabled ? "var(--ok)" : "var(--muted)" }}>
                {r.enabled ? "Yes" : "No"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatAlertTime(iso: string): string {
  if (!iso || iso === "—") {
    return "—";
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function AlertsHistoryTableBody({ rows }: { rows: MerakiAlertHistoryRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Time</th>
          <th style={th}>Alert</th>
          <th style={th}>Type id</th>
          <th style={th}>Device</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.occurredAt}-${r.alertTypeId}-${r.deviceSerial}-${i}`}>
            <td style={{ ...td, whiteSpace: "nowrap", fontSize: "0.75rem" }}>{formatAlertTime(r.occurredAt)}</td>
            <td style={td}>{r.alertType}</td>
            <td style={{ ...td, color: "var(--muted)", fontSize: "0.75rem" }}>{r.alertTypeId}</td>
            <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: "0.75rem" }}>{r.deviceSerial}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EquipmentTableBody({
  rows,
  onOpenMv,
  onOpenMrMsAlerts,
  networkAlerts = [],
}: {
  rows: MerakiDeviceRow[];
  onOpenMv?: (r: MerakiDeviceRow) => void;
  onOpenMrMsAlerts?: (r: MerakiDeviceRow) => void;
  networkAlerts?: MerakiAlertHistoryRow[];
}) {
  const showLive = typeof onOpenMv === "function";
  const showAlerts = typeof onOpenMrMsAlerts === "function";
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Model</th>
          <th style={th}>Name</th>
          <th style={th}>Status</th>
          {showLive ? <th style={th}>Live</th> : null}
          {showAlerts ? <th style={th}>Alerts</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const alertCount =
            showAlerts && isMerakiMrOrMs(r.model) ? alertsForDeviceSerial(networkAlerts, r.serial).length : 0;
          return (
            <tr key={r.serial + r.name}>
              <td style={{ ...td, fontWeight: 600 }}>{r.model}</td>
              <td style={td}>{r.name}</td>
              <td style={{ ...td, color: equipmentStatusColor(r.status), fontWeight: 600 }}>
                {r.status}
              </td>
              {showLive ? (
                <td style={td}>
                  {isMerakiCameraModel(r.model) ? (
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ fontSize: "0.72rem", padding: "0.2rem 0.45rem" }}
                      onClick={() => onOpenMv!(r)}
                    >
                      Open feed
                    </button>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
              ) : null}
              {showAlerts ? (
                <td style={td}>
                  {isMerakiMrOrMs(r.model) ? (
                    <button
                      type="button"
                      className="btn secondary"
                      style={{
                        fontSize: "0.72rem",
                        padding: "0.2rem 0.5rem",
                        fontWeight: 600,
                        ...(alertCount > 0
                          ? {
                              color: "var(--danger)",
                              background: "rgba(240, 91, 91, 0.14)",
                              border: "1px solid rgba(240, 91, 91, 0.45)",
                            }
                          : {
                              color: "var(--ok)",
                              background: "rgba(61, 214, 140, 0.12)",
                              border: "1px solid rgba(61, 214, 140, 0.4)",
                            }),
                      }}
                      onClick={() => onOpenMrMsAlerts!(r)}
                    >
                      {alertCount > 0 ? `${alertCount} alert${alertCount === 1 ? "" : "s"}` : "No alerts"}
                    </button>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function equipmentStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "online") {
    return "var(--ok)";
  }
  if (s === "offline") {
    return "var(--danger)";
  }
  if (s === "alerting") {
    return "var(--warn)";
  }
  if (s === "dormant" || s === "unknown" || s === "—") {
    return "var(--muted)";
  }
  return "var(--text)";
}

function uplinkStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "active") {
    return "var(--ok)";
  }
  if (s === "ready") {
    return "var(--warn)";
  }
  if (s === "failed" || s === "not connected") {
    return "var(--danger)";
  }
  if (s === "connecting") {
    return "var(--accent)";
  }
  return "var(--text)";
}

function WanApplianceCardTable({
  appliances,
  wanInteractive = false,
  onWanClick,
}: {
  appliances: MerakiWanAppliance[];
  wanInteractive?: boolean;
  onWanClick?: (p: {
    applianceSerial: string;
    applianceModel: string;
    uplink: "wan1" | "wan2" | "cellular";
    status: string | null;
  }) => void;
}) {
  function wanCell(
    a: MerakiWanAppliance,
    uplink: "wan1" | "wan2",
    status: string | null,
  ) {
    const text = status ?? "—";
    const color = status ? uplinkStatusColor(status) : "var(--muted)";
    if (!wanInteractive || !onWanClick) {
      return (
        <td style={{ ...td, color }}>
          {text}
        </td>
      );
    }
    return (
      <td style={{ ...td, padding: 0, verticalAlign: "stretch" }}>
        <button
          type="button"
          onClick={() =>
            onWanClick({ applianceSerial: a.serial, applianceModel: a.model, uplink, status })
          }
          title="Uplink traffic, latency, and loss (last 12 hours)"
          style={{
            width: "100%",
            minHeight: "100%",
            margin: 0,
            padding: "0.35rem 0.45rem",
            textAlign: "left",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color,
            font: "inherit",
            lineHeight: 1.35,
          }}
        >
          {text}
        </button>
      </td>
    );
  }

  function cellularCell(a: MerakiWanAppliance, status: string | null) {
    const text = status ?? "—";
    const color = status ? uplinkStatusColor(status) : "var(--muted)";
    if (!wanInteractive || !onWanClick) {
      return (
        <td style={{ ...td, color }}>
          {text}
        </td>
      );
    }
    return (
      <td style={{ ...td, padding: 0, verticalAlign: "stretch" }}>
        <button
          type="button"
          onClick={() =>
            onWanClick({ applianceSerial: a.serial, applianceModel: a.model, uplink: "cellular", status })
          }
          title="Uplink traffic, latency, and loss (last 12 hours)"
          style={{
            width: "100%",
            minHeight: "100%",
            margin: 0,
            padding: "0.35rem 0.45rem",
            textAlign: "left",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color,
            font: "inherit",
            lineHeight: 1.35,
          }}
        >
          {text}
        </button>
      </td>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Appliance</th>
          <th style={th}>Failover / path</th>
          <th style={th}>WAN 1</th>
          <th style={th}>WAN 2</th>
          <th style={th}>Cellular</th>
        </tr>
      </thead>
      <tbody>
        {appliances.map((a) => (
          <tr key={a.serial}>
            <td style={td}>
              <strong>{a.model}</strong>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{a.serial}</div>
              {a.highAvailability ? (
                <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>
                  HA: {a.highAvailability.enabled ? "on" : "off"} · {a.highAvailability.role}
                </div>
              ) : null}
            </td>
            <td style={{ ...td, fontSize: "0.78rem", lineHeight: 1.35 }}>{a.pathSummary}</td>
            {wanCell(a, "wan1", a.wan1Status)}
            {wanCell(a, "wan2", a.wan2Status)}
            {cellularCell(a, a.cellularStatus)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WanUplinksDetailTable({
  uplinks,
  interactive = false,
  onStatusClick,
}: {
  uplinks: MerakiWanUplinkDetail[];
  interactive?: boolean;
  onStatusClick?: (iface: string, status: string) => void;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Interface</th>
          <th style={th}>Status</th>
          <th style={th}>Public IP</th>
          <th style={th}>IP</th>
          <th style={th}>Gateway</th>
          <th style={th}>DNS</th>
          <th style={th}>Assigned by</th>
        </tr>
      </thead>
      <tbody>
        {uplinks.map((u) => {
          const key = normalizeMerakiUplinkParam(u.interface);
          const statusText = u.status ?? "—";
          const color = uplinkStatusColor(u.status);
          const statusCell =
            interactive && onStatusClick && key ?
              <td style={{ ...td, padding: 0, verticalAlign: "stretch" }}>
                <button
                  type="button"
                  onClick={() => onStatusClick(u.interface, u.status)}
                  title="Uplink traffic, latency, and loss (last 12 hours)"
                  style={{
                    width: "100%",
                    minHeight: "100%",
                    margin: 0,
                    padding: "0.35rem 0.45rem",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color,
                    font: "inherit",
                    lineHeight: 1.35,
                  }}
                >
                  {statusText}
                </button>
              </td>
            : <td style={{ ...td, color }}>{statusText}</td>;
          return (
            <tr key={u.interface + u.status}>
              <td style={{ ...td, fontWeight: 600 }}>{u.interface}</td>
              {statusCell}
              <td style={{ ...td, fontSize: "0.75rem" }}>{u.publicIp ?? "—"}</td>
              <td style={{ ...td, fontSize: "0.75rem" }}>{u.ip ?? "—"}</td>
              <td style={{ ...td, fontSize: "0.75rem" }}>{u.gateway ?? "—"}</td>
              <td style={{ ...td, fontSize: "0.72rem" }}>
                {u.primaryDns ?? "—"}
                {u.secondaryDns ? ` / ${u.secondaryDns}` : ""}
              </td>
              <td style={{ ...td, fontSize: "0.72rem", color: "var(--muted)" }}>{u.ipAssignedBy ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TeAgentTestScopePicker({
  agents,
  value,
  onChange,
}: {
  agents: TEAgentRow[];
  value: string | "all";
  onChange: (v: string | "all") => void;
}) {
  const selectId = useId();
  if (agents.length <= 1) {
    return null;
  }
  return (
    <div className="form-group" style={{ marginBottom: "0.5rem", maxWidth: 420 }}>
      <label className="label" htmlFor={selectId}>
        Show ThousandEyes tests for
      </label>
      <select
        id={selectId}
        className="input"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "all" ? "all" : v);
        }}
      >
        <option value="all">All agents at this location</option>
        {agents.map((a) => (
          <option key={a.agentId} value={a.agentId}>
            {a.agentName} ({a.agentId})
          </option>
        ))}
      </select>
    </div>
  );
}

function AgentsTableBody({ rows }: { rows: TEAgentRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Agent</th>
          <th style={th}>Type</th>
          <th style={th}>State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.agentId + r.agentName}>
            <td style={td}>{r.agentName}</td>
            <td style={{ ...td, color: "var(--muted)", fontSize: "0.75rem" }}>{r.agentType}</td>
            <td style={td}>{r.agentState !== "—" ? r.agentState : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EndpointAgentsTableBody({
  rows,
  onOpen,
}: {
  rows: TEEndpointAgentRow[];
  onOpen: (id: string) => void;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Hostname</th>
          <th style={th}>Platform</th>
          <th style={th}>Status</th>
          <th style={th}>Last seen</th>
          <th style={th} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={td}>
              <strong>{r.hostname}</strong>
              {r.publicIP ? (
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{r.publicIP}</div>
              ) : null}
            </td>
            <td style={{ ...td, color: "var(--muted)", fontSize: "0.78rem" }}>{r.platform}</td>
            <td style={td}>{r.status}</td>
            <td style={{ ...td, fontSize: "0.75rem", whiteSpace: "nowrap" }}>
              {r.lastSeen ? new Date(r.lastSeen).toLocaleString() : "—"}
            </td>
            <td style={td}>
              <button type="button" className="btn secondary" style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }} onClick={() => onOpen(r.id)}>
                Details
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SiteDetailPanel({
  siteId,
  locationName,
  merakiNetworkId,
  thousandEyesTag,
  merakiCapturedAt,
  teCapturedAt,
  meraki,
  te,
  onClose,
  anchorRef,
  expectWan2Healthy = false,
  expectCellularHealthy = false,
  pinStatus,
  healthSummary,
  showEndpointAgents = true,
  siteLat,
  siteLng,
  openWeatherConfigured = false,
  circuits = [],
}: {
  siteId: string;
  locationName: string;
  merakiNetworkId: string | null;
  thousandEyesTag: string | null;
  merakiCapturedAt: string | null;
  teCapturedAt: string | null;
  meraki: MerakiSnapshot | null;
  te: TESnapshot | null;
  onClose: () => void;
  anchorRef?: Ref<HTMLDivElement>;
  expectWan2Healthy?: boolean;
  expectCellularHealthy?: boolean;
  pinStatus?: LocationPinStatus;
  healthSummary?: string;
  showEndpointAgents?: boolean;
  siteLat: number | null;
  siteLng: number | null;
  openWeatherConfigured?: boolean;
  /** Carrier circuits for this location (dashboard payload). */
  circuits?: DashboardCircuit[];
}) {
  const equipment = meraki ? filterEquipmentDevices(meraki.devices) : [];
  const agents = te?.agents ?? [];
  const [teAgentScope, setTeAgentScope] = useState<string | "all">("all");
  const [endpointDetailId, setEndpointDetailId] = useState<string | null>(null);
  const [mvCamera, setMvCamera] = useState<MerakiDeviceRow | null>(null);
  const [mrMsAlertsDevice, setMrMsAlertsDevice] = useState<MerakiDeviceRow | null>(null);
  const [wanCircuitSidecar, setWanCircuitSidecar] = useState<{
    serial: string;
    model: string;
    wan: "wan1" | "wan2" | "cellular" | "wan3" | "wan4";
    status: string | null;
  } | null>(null);
  const [uplinkHistory, setUplinkHistory] = useState<{
    serial: string;
    model: string;
    uplink: string;
    status: string | null;
  } | null>(null);
  const [circuitsSidecarOpen, setCircuitsSidecarOpen] = useState(false);
  const [showSiteWeather, setShowSiteWeather] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherErr, setWeatherErr] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState<{
    summary: string;
    locationLabel: string;
    conditionMain: string;
    conditionDescription: string;
    iconCode: string | null;
    tempF: number;
    feelsLikeF: number;
    humidity: number;
    windMph: number;
    fetchedAt: string;
  } | null>(null);
  useEffect(() => {
    setTeAgentScope("all");
  }, [locationName]);
  useEffect(() => {
    setEndpointDetailId(null);
    setMvCamera(null);
    setMrMsAlertsDevice(null);
    setWanCircuitSidecar(null);
    setUplinkHistory(null);
    setCircuitsSidecarOpen(false);
  }, [siteId, locationName]);
  useEffect(() => {
    setShowSiteWeather(false);
    setWeatherErr(null);
    setWeatherData(null);
    setWeatherLoading(false);
  }, [siteId]);

  const canLoadWeather =
    openWeatherConfigured && siteLat != null && siteLng != null;

  async function loadSiteWeather() {
    if (!canLoadWeather) {
      return;
    }
    setWeatherLoading(true);
    setWeatherErr(null);
    try {
      const r = await api<{
        summary: string;
        locationLabel?: string;
        conditionMain: string;
        conditionDescription: string;
        iconCode: string | null;
        tempF: number;
        feelsLikeF: number;
        humidity: number;
        windMph: number;
        fetchedAt: string;
      }>(`/api/dashboard/sites/${encodeURIComponent(siteId)}/weather`);
      setWeatherData({
        summary: r.summary,
        locationLabel: r.locationLabel ?? "",
        conditionMain: r.conditionMain,
        conditionDescription: r.conditionDescription,
        iconCode: r.iconCode,
        tempF: r.tempF,
        feelsLikeF: r.feelsLikeF,
        humidity: r.humidity,
        windMph: r.windMph,
        fetchedAt: r.fetchedAt,
      });
    } catch (e) {
      setWeatherErr(e instanceof Error ? e.message : "Weather request failed");
    } finally {
      setWeatherLoading(false);
    }
  }

  const tests = teTestsForAgentSelection(te, teAgentScope);
  const agentToServerTests = teAgentToServerTestsForSelection(te, teAgentScope);
  const uplinkTeEnterpriseTests = useMemo(() => {
    if (!te) {
      return [] as TETestRow[];
    }
    const a = teTestsForAgentSelection(te, teAgentScope);
    const b = teAgentToServerTestsForSelection(te, teAgentScope);
    const m = new Map<string, TETestRow>();
    for (const t of [...a, ...b]) {
      if (t.testId && t.testId !== "—") {
        m.set(t.testId, t);
      }
    }
    return [...m.values()].sort((x, y) => (x.testName || x.testId).localeCompare(y.testName || y.testId));
  }, [te, teAgentScope]);
  const endpointSubtitle = te?.endpointAgents.find((e) => e.id === endpointDetailId)?.hostname;

  return (
    <div
      ref={anchorRef}
      id="site-detail-panel"
      className="card site-detail-panel"
      style={{ marginTop: "1rem", borderColor: "var(--accent-dim)" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "start",
          columnGap: "1rem",
          rowGap: "0.75rem",
          width: "100%",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1.15rem",
            lineHeight: 1.25,
            minWidth: 0,
            justifySelf: "start",
          }}
        >
          {locationName}
        </h2>
        <div
          style={{
            maxWidth: "26rem",
            width: "min(26rem, 100%)",
            justifySelf: "center",
          }}
        >
          <div
            style={{
              width: "100%",
              border: "1px solid var(--surface2)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--bg)",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "var(--muted)",
                padding: "0.4rem 0.55rem",
                background: "var(--surface2)",
                borderBottom: "1px solid var(--surface2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <span>Location weather</span>
              {canLoadWeather ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontWeight: 600 }}>
                  <label
                    style={{
                      display: "inline-flex",
                      gap: "0.3rem",
                      alignItems: "center",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showSiteWeather}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setShowSiteWeather(on);
                        if (on && canLoadWeather && !weatherLoading && weatherData == null) {
                          void loadSiteWeather();
                        }
                      }}
                    />
                    Show
                  </label>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ fontSize: "0.68rem", padding: "0.18rem 0.45rem" }}
                    disabled={weatherLoading || !showSiteWeather}
                    onClick={() => void loadSiteWeather()}
                  >
                    {weatherLoading ? "…" : "Refresh"}
                  </button>
                </span>
              ) : null}
            </div>
            <div style={{ padding: "0.55rem 0.6rem", fontSize: "0.78rem" }}>
              {!canLoadWeather ? (
                <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.4, fontSize: "0.75rem" }}>
                  {!openWeatherConfigured ? (
                    <>Add an OpenWeather key under <strong>API keys</strong>.</>
                  ) : (
                    <>
                      Set coordinates on the <strong>Locations</strong> tab (Meraki position appears there after ingest,
                      or enable <strong>manual latitude / longitude</strong> for map and weather).
                    </>
                  )}
                </p>
              ) : !showSiteWeather ? (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.75rem" }}>
                  Check <strong>Show</strong> to load conditions (counts toward daily OpenWeather cap).
                </p>
              ) : weatherErr ? (
                <span style={{ color: "var(--danger)" }}>{weatherErr}</span>
              ) : weatherData ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                    gap: "0.5rem 0.65rem",
                  }}
                >
                  <span
                    role="img"
                    aria-label={`Weather: ${weatherData.conditionDescription}`}
                    style={{
                      cursor: "help",
                      flexShrink: 0,
                      lineHeight: 0,
                      borderRadius: 10,
                      background: "rgba(255, 255, 255, 0.07)",
                      padding: "6px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <WeatherGlyph
                      iconCode={weatherData.iconCode}
                      conditionMain={weatherData.conditionMain}
                      size={56}
                      title={openWeatherIconTooltip(
                        weatherData.iconCode,
                        weatherData.conditionMain,
                        weatherData.conditionDescription,
                      )}
                    />
                  </span>
                  <div style={{ flex: "1 1 12rem", minWidth: 0, lineHeight: 1.45 }}>
                    {weatherData.locationLabel ? (
                      <strong style={{ color: "var(--text)" }}>{weatherData.locationLabel}</strong>
                    ) : null}
                    {weatherData.locationLabel ? " " : null}
                    <strong style={{ color: "var(--text)" }}>{Math.round(weatherData.tempF)}°F</strong>
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      · {weatherData.conditionDescription} · feels {Math.round(weatherData.feelsLikeF)}° ·{" "}
                      {Math.round(weatherData.humidity)}% · wind{" "}
                      {weatherData.windMph < 10 ? weatherData.windMph.toFixed(1) : Math.round(weatherData.windMph)} mph
                    </span>
                    <div style={{ marginTop: 6, fontSize: "0.65rem", color: "var(--muted)" }}>
                      OpenWeather · {new Date(weatherData.fetchedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ) : weatherLoading ? (
                <span style={{ color: "var(--muted)" }}>Loading conditions…</span>
              ) : (
                <span style={{ color: "var(--muted)" }}>…</span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn secondary"
          style={{ flexShrink: 0, justifySelf: "end", alignSelf: "start" }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div style={{ marginTop: "0.35rem" }}>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
          {merakiNetworkId ? <>Meraki: {merakiNetworkId}</> : <>No Meraki network linked</>}
          {" · "}
          {thousandEyesTag ? <>TE tag: {thousandEyesTag}</> : <>No TE tag</>}
        </p>
      </div>
      <div style={{ marginTop: "0.2rem" }}>
        <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)" }}>
          {merakiCapturedAt ? <>Meraki snapshot: {new Date(merakiCapturedAt).toLocaleString()}</> : null}
          {merakiCapturedAt && teCapturedAt ? " · " : null}
          {teCapturedAt ? <>ThousandEyes snapshot: {new Date(teCapturedAt).toLocaleString()}</> : null}
        </p>
      </div>

      {expectWan2Healthy || expectCellularHealthy ? (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
          <strong>Circuit expectations</strong> (Locations tab): WAN1 must be <code>active</code> or <code>ready</code>{" "}
          whenever monitoring is on.
          {expectWan2Healthy ? (
            <>
              {" "}
              WAN2 must also be healthy.
            </>
          ) : null}
          {expectCellularHealthy ? (
            <>
              {" "}
              Cellular must also be healthy.
            </>
          ) : null}{" "}
          Orange pin if traffic still flows but an expected path is down.
        </p>
      ) : null}

      {pinStatus === "degraded" && healthSummary ? (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.65rem 0.85rem",
            borderRadius: 8,
            border: "1px solid rgba(234, 88, 12, 0.55)",
            background: "rgba(234, 88, 12, 0.12)",
            fontSize: "0.82rem",
            lineHeight: 1.45,
          }}
        >
          <strong style={{ color: "#ea580c" }}>Circuit degraded</strong>
          <div style={{ marginTop: 6, color: "var(--text)" }}>{healthSummary}</div>
        </div>
      ) : null}

      <div className="site-detail-grid" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 }}>
          {meraki ? (
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              <strong>{meraki.organizationName}</strong>
              {" → "}
              {meraki.networkName}
              <span style={{ color: "var(--muted)" }}> ({meraki.deviceCount} devices in network)</span>
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>No Meraki snapshot.</p>
          )}
        </div>
        <MiniTable title="ThousandEyes agents at site" empty={agents.length === 0} maxBodyHeight={panelMaxHeight}>
          {agents.length > 0 ? <AgentsTableBody rows={agents} /> : null}
        </MiniTable>
      </div>

      {meraki?.wan?.appliances?.length ? (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <MiniTable
            title="WAN — Meraki appliance uplinks (live status)"
            titleExtra={
              <button
                type="button"
                className="btn secondary"
                style={{ fontSize: "0.65rem", padding: "0.2rem 0.45rem", flexShrink: 0 }}
                onClick={() => setCircuitsSidecarOpen(true)}
              >
                Circuits
              </button>
            }
            empty={false}
            maxBodyHeight={panelMaxHeight}
          >
            <WanApplianceCardTable
              appliances={meraki.wan.appliances}
              wanInteractive
              onWanClick={(p) =>
                setUplinkHistory({
                  serial: p.applianceSerial,
                  model: p.applianceModel,
                  uplink: p.uplink,
                  status: p.status,
                })
              }
            />
          </MiniTable>
          {meraki.wan.appliances.map((a) => (
            <MiniTable
              key={a.serial}
              title={`Interfaces — ${a.model} (${a.serial})`}
              empty={a.uplinks.length === 0}
              maxBodyHeight={panelMaxHeight}
            >
              {a.uplinks.length > 0 ?
                <WanUplinksDetailTable
                  uplinks={a.uplinks}
                  interactive
                  onStatusClick={(iface, status) => {
                    const key = normalizeMerakiUplinkParam(iface);
                    if (!key) {
                      return;
                    }
                    setUplinkHistory({
                      serial: a.serial,
                      model: a.model,
                      uplink: key,
                      status,
                    });
                  }}
                />
              : null}
            </MiniTable>
          ))}
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
            Source: Meraki <code>GET /organizations/…/appliance/uplink/statuses</code>.{" "}
            <strong>active</strong> = carrying traffic; <strong>ready</strong> = standby link up;{" "}
            <strong>failed</strong> / <strong>not connected</strong> = down or unplugged. Your API key needs appliance /
            SD-WAN read scope where required.
          </p>
        </div>
      ) : meraki ? (
        <div style={{ margin: "1rem 0 0" }}>
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
            No WAN uplink telemetry in this snapshot (no appliance in network, API error, or missing telemetry scope).
          </p>
          {meraki.wanNote ? (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--warn)", lineHeight: 1.4 }}>
              {meraki.wanNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {meraki && (meraki.alerts.length > 0 || meraki.alertsNote) ? (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <MiniTable
            title="Meraki alert history (recent)"
            empty={meraki.alerts.length === 0}
            maxBodyHeight={panelMaxHeight}
          >
            {meraki.alerts.length > 0 ? <AlertsHistoryTableBody rows={meraki.alerts} /> : null}
          </MiniTable>
          {meraki.alertsNote ? (
            <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--warn)", lineHeight: 1.4 }}>
              Alerts API: {meraki.alertsNote}
            </p>
          ) : null}
          <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.4 }}>
            Source: Meraki <code>GET /networks/…/alerts/history</code> (up to 50 events per ingest for linked
            locations). Requires <strong>dashboard:general:telemetry:read</strong> (or equivalent) on the API key.
          </p>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
          marginTop: "1rem",
        }}
      >
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <TeAgentTestScopePicker agents={agents} value={teAgentScope} onChange={setTeAgentScope} />
          <MiniTable
            title="HTTP tests on selected agent(s)"
            empty={tests.length === 0}
            maxBodyHeight={panelMaxHeight}
          >
            {tests.length > 0 ? <TestsTableBody rows={tests} /> : null}
          </MiniTable>
          <MiniTable
            title="Agent-to-server tests (enterprise agent)"
            empty={agentToServerTests.length === 0}
            maxBodyHeight={panelMaxHeight}
          >
            {agentToServerTests.length > 0 ? <TestsTableBody rows={agentToServerTests} /> : null}
          </MiniTable>
        </div>
        <MiniTable
          title="Equipment (MR / MS / MX / CW / MV)"
          empty={equipment.length === 0}
          maxBodyHeight={panelMaxHeight}
        >
          {equipment.length > 0 ? (
            <EquipmentTableBody
              rows={equipment}
              onOpenMv={(r) => setMvCamera(r)}
              onOpenMrMsAlerts={(r) => setMrMsAlertsDevice(r)}
              networkAlerts={meraki?.alerts ?? []}
            />
          ) : null}
        </MiniTable>
      </div>
      <p style={{ margin: "0.75rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
        Equipment status comes from Meraki <code>GET /organizations/…/devices/availabilities</code> (online / offline /
        alerting / dormant), merged by serial. HTTP tests are types whose name includes &quot;http&quot;; agent-to-server
        tests are listed separately. Source: ThousandEyes <code>GET /agents?expand=test</code>. Use the dropdown when
        several agents match the location TE tag.
      </p>

      {showEndpointAgents && te ? (
        <div style={{ marginTop: "1rem" }}>
          <MiniTable
            title="ThousandEyes Endpoint agents (near location)"
            empty={te.endpointAgents.length === 0}
            maxBodyHeight={panelMaxHeight}
          >
            {te.endpointAgents.length > 0 ? (
              <EndpointAgentsTableBody rows={te.endpointAgents} onOpen={setEndpointDetailId} />
            ) : null}
          </MiniTable>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
            Matched by <strong>TE tag</strong> on computer/agent name or ~<strong>80 km</strong> of location coordinates.
            Details calls ThousandEyes live APIs (expanded agent, path-vis / HTTP results for scheduled tests).
          </p>
        </div>
      ) : null}

      <EndpointAgentSidecar
        siteId={siteId}
        agentId={endpointDetailId}
        open={endpointDetailId != null}
        onClose={() => setEndpointDetailId(null)}
        subtitle={endpointSubtitle}
      />
      <MerakiCameraSidecar
        siteId={siteId}
        camera={mvCamera}
        open={mvCamera != null}
        onClose={() => setMvCamera(null)}
      />
      <MerakiEquipmentAlertsSidecar
        device={mrMsAlertsDevice}
        open={mrMsAlertsDevice != null}
        onClose={() => setMrMsAlertsDevice(null)}
        networkAlerts={meraki?.alerts ?? []}
        alertsNote={meraki?.alertsNote}
        snapshotCapturedAt={merakiCapturedAt}
      />
      <UplinkHistorySidecar
        open={uplinkHistory != null}
        onClose={() => setUplinkHistory(null)}
        siteId={siteId}
        locationName={locationName}
        applianceSerial={uplinkHistory?.serial ?? "—"}
        applianceModel={uplinkHistory?.model ?? "—"}
        uplink={uplinkHistory?.uplink ?? "wan1"}
        merakiStatus={uplinkHistory?.status ?? null}
        teEnterpriseTests={uplinkTeEnterpriseTests}
        onViewCircuitMapping={
          uplinkHistory ?
            () => {
              const { serial, model, uplink, status } = uplinkHistory;
              setUplinkHistory(null);
              setWanCircuitSidecar({
                serial,
                model,
                wan: uplink as "wan1" | "wan2" | "cellular" | "wan3" | "wan4",
                status,
              });
            }
          : undefined
        }
      />
      <WanCircuitClickSidecar
        open={wanCircuitSidecar != null}
        onClose={() => setWanCircuitSidecar(null)}
        locationName={locationName}
        wan={wanCircuitSidecar?.wan ?? "wan1"}
        applianceModel={wanCircuitSidecar?.model ?? "—"}
        applianceSerial={wanCircuitSidecar?.serial ?? "—"}
        merakiStatus={wanCircuitSidecar?.status ?? null}
        circuits={
          wanCircuitSidecar ?
            circuitsMatchingUplink(circuits, wanCircuitSidecar.wan, wanCircuitSidecar.serial)
          : []
        }
        onGoToUtilization={
          wanCircuitSidecar ?
            () => {
              const w = wanCircuitSidecar;
              setWanCircuitSidecar(null);
              setUplinkHistory({
                serial: w.serial,
                model: w.model,
                uplink: w.wan,
                status: w.status,
              });
            }
          : undefined
        }
      />
      <LocationCircuitsSidecar
        open={circuitsSidecarOpen}
        onClose={() => setCircuitsSidecarOpen(false)}
        locationName={locationName}
        circuits={circuits}
        onGoToUtilization={(c) => {
          const next = uplinkHistoryFromDashboardCircuit(c, meraki);
          if (!next) {
            return;
          }
          setCircuitsSidecarOpen(false);
          setUplinkHistory(next);
        }}
      />
    </div>
  );
}

export function LocationCardSummary({
  siteId,
  locationName,
  merakiNetworkId,
  thousandEyesTag,
  meraki,
  te,
  merakiCapturedAt,
  teCapturedAt,
  showAgentsColumn = true,
  showTestsTable = true,
  showEquipmentTable = true,
  showEndpointAgents = true,
  pinStatus,
  healthSummary,
  circuits = [],
}: {
  siteId: string;
  locationName: string;
  merakiNetworkId: string | null;
  thousandEyesTag: string | null;
  meraki: MerakiSnapshot | null;
  te: TESnapshot | null;
  merakiCapturedAt: string | null;
  teCapturedAt: string | null;
  /** When false, TE agents table beside the title is hidden (e.g. Lenses off). */
  showAgentsColumn?: boolean;
  showTestsTable?: boolean;
  showEquipmentTable?: boolean;
  showEndpointAgents?: boolean;
  pinStatus?: LocationPinStatus;
  healthSummary?: string;
  circuits?: DashboardCircuit[];
}) {
  const equipment = meraki ? filterEquipmentDevices(meraki.devices) : [];
  const agents = te?.agents ?? [];
  const [teAgentScope, setTeAgentScope] = useState<string | "all">("all");
  const [endpointDetailId, setEndpointDetailId] = useState<string | null>(null);
  const [mvCamera, setMvCamera] = useState<MerakiDeviceRow | null>(null);
  const [mrMsAlertsDevice, setMrMsAlertsDevice] = useState<MerakiDeviceRow | null>(null);
  const [wanCircuitSidecar, setWanCircuitSidecar] = useState<{
    serial: string;
    model: string;
    wan: "wan1" | "wan2" | "cellular" | "wan3" | "wan4";
    status: string | null;
  } | null>(null);
  const [uplinkHistory, setUplinkHistory] = useState<{
    serial: string;
    model: string;
    uplink: string;
    status: string | null;
  } | null>(null);
  const [circuitsSidecarOpen, setCircuitsSidecarOpen] = useState(false);
  useEffect(() => {
    setTeAgentScope("all");
  }, [locationName]);
  useEffect(() => {
    setEndpointDetailId(null);
    setMvCamera(null);
    setMrMsAlertsDevice(null);
    setWanCircuitSidecar(null);
    setUplinkHistory(null);
    setCircuitsSidecarOpen(false);
  }, [siteId, locationName]);
  const tests = teTestsForAgentSelection(te, teAgentScope);
  const agentToServerTests = teAgentToServerTestsForSelection(te, teAgentScope);
  const enabledTests = tests.filter((t) => t.enabled).length;
  const enabledA2s = agentToServerTests.filter((t) => t.enabled).length;
  const uplinkTeEnterpriseTests = useMemo(() => {
    if (!te) {
      return [] as TETestRow[];
    }
    const a = teTestsForAgentSelection(te, teAgentScope);
    const b = teAgentToServerTestsForSelection(te, teAgentScope);
    const m = new Map<string, TETestRow>();
    for (const t of [...a, ...b]) {
      if (t.testId && t.testId !== "—") {
        m.set(t.testId, t);
      }
    }
    return [...m.values()].sort((x, y) => (x.testName || x.testId).localeCompare(y.testName || y.testId));
  }, [te, teAgentScope]);
  const endpointSubtitle = te?.endpointAgents.find((e) => e.id === endpointDetailId)?.hostname;

  return (
    <div className="location-card-summary">
      {pinStatus === "degraded" && healthSummary ? (
        <div
          style={{
            marginBottom: "0.65rem",
            padding: "0.45rem 0.55rem",
            borderRadius: 6,
            border: "1px solid rgba(234, 88, 12, 0.5)",
            background: "rgba(234, 88, 12, 0.1)",
            fontSize: "0.76rem",
            lineHeight: 1.4,
          }}
        >
          <strong style={{ color: "#ea580c" }}>Circuit degraded</strong> — {healthSummary}
        </div>
      ) : null}
      <div
        className={
          showAgentsColumn
            ? "location-card-summary__row location-card-summary__row--header"
            : "location-card-summary__row location-card-summary__row--header location-card-summary__row--title-only"
        }
      >
        <div className="location-card-summary__title">
          <h2 style={{ margin: 0, fontSize: "1.1rem", lineHeight: 1.3 }}>{locationName}</h2>
          <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.35rem" }}>
            {merakiNetworkId ? <>Meraki net: {merakiNetworkId}</> : <>No Meraki network linked</>}
            <br />
            {thousandEyesTag ? <>TE tag: {thousandEyesTag}</> : <>No TE tag</>}
          </div>
        </div>
        {showAgentsColumn ? (
          <div className="location-card-summary__side">
            <MiniTable title="ThousandEyes agents" empty={agents.length === 0} maxBodyHeight={compactMaxHeight}>
              {agents.length > 0 ? <AgentsTableBody rows={agents.slice(0, 12)} /> : null}
            </MiniTable>
          </div>
        ) : null}
      </div>

      <div className="location-card-summary__row">
        <div className="location-card-summary__main">
          {meraki ? (
            <div style={{ fontSize: "0.85rem", lineHeight: 1.45 }}>
              <div>
                <span style={{ color: "var(--muted)" }}>Network</span>{" "}
                <strong>{meraki.networkName}</strong>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 2 }}>
                {meraki.organizationName} · {meraki.deviceCount} devices · {equipment.length} MR/MS/MX/CW/MV in snapshot
              </div>
              {merakiCapturedAt ? (
                <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>
                  Updated {new Date(merakiCapturedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>No Meraki snapshot yet.</p>
          )}
        </div>
      </div>

      {meraki?.wan?.appliances?.length ? (
        <div style={{ marginTop: "0.75rem" }}>
          <MiniTable
            title="WAN (MX / Z uplink status)"
            titleExtra={
              <button
                type="button"
                className="btn secondary"
                style={{ fontSize: "0.65rem", padding: "0.2rem 0.45rem", flexShrink: 0 }}
                onClick={() => setCircuitsSidecarOpen(true)}
              >
                Circuits
              </button>
            }
            empty={false}
            maxBodyHeight={compactMaxHeight + 40}
          >
            <WanApplianceCardTable
              appliances={meraki.wan.appliances}
              wanInteractive
              onWanClick={(p) =>
                setUplinkHistory({
                  serial: p.applianceSerial,
                  model: p.applianceModel,
                  uplink: p.uplink,
                  status: p.status,
                })
              }
            />
          </MiniTable>
        </div>
      ) : meraki?.wanNote ? (
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.72rem", color: "var(--warn)", lineHeight: 1.4 }}>
          WAN: {meraki.wanNote}
        </p>
      ) : null}

      {meraki && (meraki.alerts.length > 0 || meraki.alertsNote) ? (
        <div style={{ marginTop: "0.75rem" }}>
          <MiniTable
            title="Meraki alerts (recent)"
            empty={meraki.alerts.length === 0}
            maxBodyHeight={compactMaxHeight}
          >
            {meraki.alerts.length > 0 ? <AlertsHistoryTableBody rows={meraki.alerts.slice(0, 8)} /> : null}
          </MiniTable>
          {meraki.alertsNote ? (
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.68rem", color: "var(--warn)", lineHeight: 1.35 }}>
              {meraki.alertsNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {showTestsTable || showEquipmentTable ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "0.75rem",
            marginTop: "0.75rem",
          }}
        >
          {showTestsTable ? (
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <TeAgentTestScopePicker agents={agents} value={teAgentScope} onChange={setTeAgentScope} />
              <MiniTable
                title={`HTTP tests (${enabledTests} enabled)`}
                empty={tests.length === 0}
                maxBodyHeight={compactMaxHeight}
              >
                {tests.length > 0 ? <TestsTableBody rows={tests.slice(0, 10)} /> : null}
              </MiniTable>
              <MiniTable
                title={`Agent-to-server (${enabledA2s} enabled)`}
                empty={agentToServerTests.length === 0}
                maxBodyHeight={compactMaxHeight}
              >
                {agentToServerTests.length > 0 ? <TestsTableBody rows={agentToServerTests.slice(0, 10)} /> : null}
              </MiniTable>
            </div>
          ) : null}
          {showEquipmentTable ? (
            <MiniTable
              title="Equipment (MR / MS / MX / CW / MV)"
              empty={equipment.length === 0}
              maxBodyHeight={compactMaxHeight}
            >
              {equipment.length > 0 ? (
                <EquipmentTableBody
                  rows={equipment.slice(0, 10)}
                  onOpenMv={(r) => setMvCamera(r)}
                  onOpenMrMsAlerts={(r) => setMrMsAlertsDevice(r)}
                  networkAlerts={meraki?.alerts ?? []}
                />
              ) : null}
            </MiniTable>
          ) : null}
        </div>
      ) : null}

      {te ? (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
          ThousandEyes:{" "}
          {te.matchedByTag ?
            "Agents filtered by location TE tag."
          : "Fallback agents (no tag); tests unioned for those agents."}
          {teCapturedAt ? ` · ${new Date(teCapturedAt).toLocaleString()}` : ""}
        </p>
      ) : null}

      {showEndpointAgents && te ? (
        <div style={{ marginTop: "0.75rem" }}>
          <MiniTable
            title="Endpoint agents (near location)"
            empty={te.endpointAgents.length === 0}
            maxBodyHeight={compactMaxHeight}
          >
            {te.endpointAgents.length > 0 ? (
              <EndpointAgentsTableBody rows={te.endpointAgents.slice(0, 8)} onOpen={setEndpointDetailId} />
            ) : null}
          </MiniTable>
        </div>
      ) : null}

      <EndpointAgentSidecar
        siteId={siteId}
        agentId={endpointDetailId}
        open={endpointDetailId != null}
        onClose={() => setEndpointDetailId(null)}
        subtitle={endpointSubtitle}
      />
      <MerakiCameraSidecar
        siteId={siteId}
        camera={mvCamera}
        open={mvCamera != null}
        onClose={() => setMvCamera(null)}
      />
      <MerakiEquipmentAlertsSidecar
        device={mrMsAlertsDevice}
        open={mrMsAlertsDevice != null}
        onClose={() => setMrMsAlertsDevice(null)}
        networkAlerts={meraki?.alerts ?? []}
        alertsNote={meraki?.alertsNote}
        snapshotCapturedAt={merakiCapturedAt}
      />
      <UplinkHistorySidecar
        open={uplinkHistory != null}
        onClose={() => setUplinkHistory(null)}
        siteId={siteId}
        locationName={locationName}
        applianceSerial={uplinkHistory?.serial ?? "—"}
        applianceModel={uplinkHistory?.model ?? "—"}
        uplink={uplinkHistory?.uplink ?? "wan1"}
        merakiStatus={uplinkHistory?.status ?? null}
        teEnterpriseTests={uplinkTeEnterpriseTests}
        onViewCircuitMapping={
          uplinkHistory ?
            () => {
              const { serial, model, uplink, status } = uplinkHistory;
              setUplinkHistory(null);
              setWanCircuitSidecar({
                serial,
                model,
                wan: uplink as "wan1" | "wan2" | "cellular" | "wan3" | "wan4",
                status,
              });
            }
          : undefined
        }
      />
      <WanCircuitClickSidecar
        open={wanCircuitSidecar != null}
        onClose={() => setWanCircuitSidecar(null)}
        locationName={locationName}
        wan={wanCircuitSidecar?.wan ?? "wan1"}
        applianceModel={wanCircuitSidecar?.model ?? "—"}
        applianceSerial={wanCircuitSidecar?.serial ?? "—"}
        merakiStatus={wanCircuitSidecar?.status ?? null}
        circuits={
          wanCircuitSidecar ?
            circuitsMatchingUplink(circuits, wanCircuitSidecar.wan, wanCircuitSidecar.serial)
          : []
        }
        onGoToUtilization={
          wanCircuitSidecar ?
            () => {
              const w = wanCircuitSidecar;
              setWanCircuitSidecar(null);
              setUplinkHistory({
                serial: w.serial,
                model: w.model,
                uplink: w.wan,
                status: w.status,
              });
            }
          : undefined
        }
      />
      <LocationCircuitsSidecar
        open={circuitsSidecarOpen}
        onClose={() => setCircuitsSidecarOpen(false)}
        locationName={locationName}
        circuits={circuits}
        onGoToUtilization={(c) => {
          const next = uplinkHistoryFromDashboardCircuit(c, meraki);
          if (!next) {
            return;
          }
          setCircuitsSidecarOpen(false);
          setUplinkHistory(next);
        }}
      />
    </div>
  );
}
