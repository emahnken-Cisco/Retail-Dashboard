import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api.js";
import type { TEEndpointAgentInventory, WirelessEndpointCorrelation } from "../lib/sitePayloads.js";

/** One Meraki wireless event for the matched client MAC. */
type MerakiClientEventRow = {
  occurredAt: string;
  type: string;
  description: string | null;
  deviceSerial: string | null;
  deviceName: string | null;
  ssidName: string | null;
  ssidNumber: number | null;
};

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
  /** Pre-computed correlation persisted in the TE snapshot; absent when no Meraki link. */
  wirelessCorrelation?: WirelessEndpointCorrelation | null;
  /** Recent Meraki wireless events scoped to the matched client MAC (last hour). */
  merakiClientEvents?: MerakiClientEventRow[];
  /** Non-fatal note when the Meraki events fetch failed (rate limit, missing scope, etc.). */
  merakiClientEventsNote?: string | null;
  /**
   * Tier A inventory blob the TE ingest extracted from the EndpointAgent
   * root (serial, NIC, battery, license, etc). Optional — newer snapshots
   * include it; older ones don't, and the sidecar still renders cleanly.
   */
  inventory?: TEEndpointAgentInventory | null;
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

/**
 * Read a field from the live TE EndpointAgent payload first, then fall back
 * to the slim inventory blob the ingest captured. Lets the sidecar render
 * even when only one source has the data (e.g. the live agent fetch fails
 * with 429 but the snapshot is fresh).
 */
function pickField(agent: Record<string, unknown> | null, inventoryValue: unknown, agentKey: string): string {
  const live = agent ? agent[agentKey] : null;
  if (live != null && String(live).trim() !== "") return String(live);
  if (inventoryValue != null && String(inventoryValue).trim() !== "") return String(inventoryValue);
  return "—";
}

/** Format a 0–1 normalized fraction as a percentage with one decimal. */
function pctOrDash(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function AgentFieldGrid({
  agent,
  inventory,
}: {
  agent: unknown;
  inventory: TEEndpointAgentInventory | null;
}) {
  const a = isRecord(agent) ? agent : null;
  if (!a && !inventory) {
    return <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No agent payload.</p>;
  }
  const clients = a && Array.isArray(a.clients) ? a.clients : [];
  let userLine = "—";
  if (clients.length > 0 && isRecord(clients[0])) {
    const up = clients[0].userProfile;
    if (isRecord(up)) {
      userLine = String(up.userPrincipalName || up.userName || "—");
    }
  }
  // Battery: prefer live payload (renders most recent reading), fall back to
  // the snapshot. TE only emits batteryMetrics on devices that have a
  // battery, so a null on both sources is meaningful — show "—" not "0%".
  const liveBattery = a && isRecord(a.batteryMetrics) ? a.batteryMetrics : null;
  const liveBatteryLevel =
    liveBattery && typeof liveBattery.batteryLevelNormalizedPercent === "number"
      ? liveBattery.batteryLevelNormalizedPercent
      : null;
  const liveBatteryHealth =
    liveBattery && typeof liveBattery.batteryHealthNormalizedPercent === "number"
      ? liveBattery.batteryHealthNormalizedPercent
      : null;
  const batteryLevel = liveBatteryLevel ?? inventory?.batteryLevelNormalized ?? null;
  const batteryHealth = liveBatteryHealth ?? inventory?.batteryHealthNormalized ?? null;
  const liveFreeDisk =
    a && typeof a.freeDiskSpaceNormalized === "number" ? a.freeDiskSpaceNormalized : null;
  const freeDisk = liveFreeDisk ?? inventory?.freeDiskSpaceNormalized ?? null;
  // Highlight an out-of-date TE agent version when the spec returned both
  // current `version` and recommended `targetVersion`. We never block on
  // this — it's just informational text alongside the version.
  const agentVersion = pickField(a, inventory?.agentVersion, "version");
  const targetVersion = pickField(a, inventory?.agentTargetVersion, "targetVersion");
  const versionLine =
    targetVersion !== "—" && agentVersion !== "—" && targetVersion !== agentVersion
      ? `${agentVersion} (target ${targetVersion})`
      : agentVersion;

  const rows: [string, string][] = [
    ["Computer name", pickField(a, null, "computerName")],
    ["Agent name", pickField(a, null, "name")],
    ["Platform", pickField(a, null, "platform")],
    ["OS version", pickField(a, inventory?.osVersion, "osVersion")],
    ["Kernel", pickField(a, inventory?.kernelVersion, "kernelVersion")],
    [
      "Manufacturer / model",
      `${pickField(a, inventory?.manufacturer, "manufacturer")} · ${pickField(a, inventory?.model, "model")}`,
    ],
    ["Serial number", pickField(a, inventory?.serialNumber, "serialNumber")],
    ["NIC model", pickField(a, inventory?.nicModel, "nicModel")],
    ["NIC driver version", pickField(a, inventory?.nicDriverVersion, "nicDriverVersion")],
    ["Battery level", pctOrDash(batteryLevel)],
    ["Battery health", pctOrDash(batteryHealth)],
    ["Free disk", pctOrDash(freeDisk)],
    ["Total memory (agent)", pickField(a, inventory?.totalMemory, "totalMemory")],
    ["License", pickField(a, inventory?.licenseType, "licenseType")],
    ["Public IP", pickField(a, null, "publicIP")],
    ["Agent version", versionLine],
    ["NPCAP driver", pickField(a, inventory?.npcapVersion, "npcapVersion")],
    [
      "Last seen",
      a?.lastSeen ? new Date(String(a.lastSeen)).toLocaleString() : "—",
    ],
    ["Logged-in user", userLine],
    ["Status", pickField(a, null, "status")],
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

/**
 * Wi-Fi correlation between this TE Endpoint Agent and the site's Meraki MR
 * fleet (computed during TE ingest; events pulled live when the sidecar
 * opens). Renders three blocks:
 *   1. Tone badge + reason summary
 *   2. Connection details (SSID / BSSID / RSSI / channel / PHY / wireless MAC)
 *   3. Matched MR + recent wireless events for this client MAC
 *
 * Note: SNR + channel-width cells were removed because the TE Endpoint
 * Agents API v7.0.91 schema does NOT contract those fields on
 * WirelessProfile — they were always null on spec-compliant agents.
 * PHY mode (phyMode) IS in the spec and replaces the SNR cell.
 *
 * Always renders something — even for wired endpoints — so the user gets
 * an explicit "Wi-Fi correlation: wired endpoint, no Meraki MR match"
 * confirmation rather than a missing section.
 */
function WirelessCorrelationSection({
  correlation,
  events,
  eventsNote,
  onOpenAPLog,
}: {
  correlation: WirelessEndpointCorrelation | null;
  events: MerakiClientEventRow[];
  eventsNote: string | null;
  onOpenAPLog?: (mr: { serial: string; name: string | null }) => void;
}) {
  const tone = correlation?.tone ?? "neutral";
  const palette = wifiTonePalette(tone);
  // Distinguish "snapshot doesn't have correlation data for this agent yet"
  // (the field is missing on the TE snapshot, usually because TE ingest
  // hasn't run since the feature shipped or the agent was added after the
  // last ingest) from "TE actively reported no Wi-Fi connection info".
  // The two cases used to render identically and that masked deployment
  // staging issues; now we surface a distinct, actionable hint.
  // Reason copy hierarchy:
  //   1) No correlation block at all → ingest hasn't run since feature ship.
  //   2) Correlation says "no-wireless-data" yet SSID/BSSID exist → stale
  //      snapshot from before the matching strategy was extended (the new
  //      ingest will re-classify as healthy / no-match / impacted).
  //   3) Otherwise use the canonical reason label.
  const hasAnyWifiHint = Boolean(correlation?.ssid || correlation?.bssid);
  const reasonText =
    correlation == null
      ? "No correlation data in the latest TE snapshot — run TE ingest to populate (Admin → Run job)."
      : correlation.reason === "no-wireless-data" && hasAnyWifiHint
        ? "Stale correlation in this snapshot — re-run TE ingest (Admin → Run job) to enable BSSID-based MR matching."
        : wifiReasonLabel(correlation.reason);

  return (
    <>
      <h3 style={{ margin: "1rem 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        Wi-Fi correlation (Meraki MR)
      </h3>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "0.5rem",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "0.2rem 0.5rem",
            borderRadius: 999,
            background: palette.bg,
            color: palette.fg,
            border: `1px solid ${palette.border}`,
          }}
        >
          <span style={{ marginRight: "0.35rem" }}>{wifiToneGlyph(tone)}</span>
          {wifiToneLabel(tone)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{reasonText}</span>
      </div>

      {correlation ? (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 38%) 1fr",
            gap: "0.35rem 0.75rem",
            margin: "0 0 0.5rem",
            fontSize: "0.78rem",
          }}
        >
          <dt style={{ color: "var(--muted)", margin: 0 }}>Connection</dt>
          <dd style={{ margin: 0 }}>{correlation.connectionType}</dd>
          {correlation.ssid ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>SSID</dt>
              <dd style={{ margin: 0 }}>{correlation.ssid}</dd>
            </>
          ) : null}
          {correlation.matchedMeraki ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>Access point</dt>
              <dd style={{ margin: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  {correlation.matchedMeraki.name ?? correlation.matchedMeraki.serial}
                </span>
                {correlation.matchMethod === "bssid" ? (
                  <span
                    title="Matched via BSSID — TE did not expose this endpoint's client MAC (typical for Android / iOS / managed-MAC fleets)."
                    style={{
                      marginLeft: "0.4rem",
                      fontSize: "0.65rem",
                      color: "var(--muted)",
                      padding: "0.05rem 0.35rem",
                      border: "1px solid var(--surface2)",
                      borderRadius: 4,
                    }}
                  >
                    via BSSID
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {correlation.bssid ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>BSSID</dt>
              <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>
                {correlation.bssid}
                {correlation.matchedMeraki ? (
                  <span style={{ marginLeft: "0.4rem", fontFamily: "inherit", color: "var(--muted)" }}>
                    · {correlation.matchedMeraki.name ?? correlation.matchedMeraki.serial}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {correlation.rssiDbm != null ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>RSSI</dt>
              <dd style={{ margin: 0 }}>{correlation.rssiDbm} dBm</dd>
            </>
          ) : null}
          {correlation.phyMode ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>PHY mode</dt>
              <dd style={{ margin: 0 }}>{correlation.phyMode}</dd>
            </>
          ) : null}
          {correlation.channel != null ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>Channel</dt>
              <dd style={{ margin: 0 }}>
                {correlation.channel}
                {correlation.channelWidthMhz != null ? ` (${correlation.channelWidthMhz} MHz)` : ""}
                {correlation.band ? ` · ${correlation.band}` : ""}
              </dd>
            </>
          ) : null}
          {correlation.wirelessMac ? (
            <>
              <dt style={{ color: "var(--muted)", margin: 0 }}>Wireless MAC</dt>
              <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>
                {correlation.wirelessMac}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {correlation?.matchedMeraki ? (
        <div
          style={{
            padding: "0.5rem 0.65rem",
            background: "var(--surface2)",
            borderRadius: 6,
            marginBottom: "0.5rem",
            fontSize: "0.78rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600 }}>
                Matched MR: {correlation.matchedMeraki.name ?? correlation.matchedMeraki.serial}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.72rem", fontFamily: "ui-monospace, monospace" }}>
                {correlation.matchedMeraki.serial}
              </div>
              {correlation.matchedMeraki.ssid ? (
                <div style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                  SSID seen by Meraki: {correlation.matchedMeraki.ssid}
                </div>
              ) : null}
            </div>
            {onOpenAPLog ? (
              <button
                type="button"
                className="btn secondary"
                style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem", flexShrink: 0 }}
                onClick={() =>
                  onOpenAPLog({
                    serial: correlation.matchedMeraki!.serial,
                    name: correlation.matchedMeraki!.name,
                  })
                }
              >
                Open AP log →
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <h4 style={{ margin: "0.75rem 0 0.35rem", fontSize: "0.75rem", color: "var(--muted)" }}>
        Recent Meraki wireless events for this client (last hour)
      </h4>
      {eventsNote ? (
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.72rem", color: "var(--danger)", lineHeight: 1.4 }}>
          Could not load events: {eventsNote}
        </p>
      ) : null}
      {correlation?.matchedMeraki == null ? (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.45 }}>
          {correlation?.bssid
            ? "No Meraki match — this BSSID does not belong to an MR known to this org / site. The endpoint may be connected to a non-Meraki AP."
            : "No Meraki match — events scoped to the agent's wireless MAC are not available."}
        </p>
      ) : correlation.matchMethod === "bssid" && events.length === 0 ? (
        // BSSID-matched endpoints share the AP, but Meraki has no client-MAC
        // history we can scope events to (TE never reported the client MAC).
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.45 }}>
          Matched to this AP via BSSID. Per-client event filtering isn't available because TE
          didn't report this endpoint's wireless MAC. Use <strong>Open AP log</strong> above for the
          full AP event stream.
        </p>
      ) : events.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.45 }}>
          No association / auth / DHCP events recorded for this client in the last hour.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Event</th>
                <th style={th}>AP / SSID</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, idx) => (
                <tr key={`${ev.occurredAt}-${idx}`}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontSize: "0.72rem" }}>
                    {new Date(ev.occurredAt).toLocaleString()}
                  </td>
                  <td style={{ ...td, fontSize: "0.72rem" }}>
                    <div style={{ fontWeight: 600 }}>{ev.type}</div>
                    {ev.description ? (
                      <div style={{ color: "var(--muted)", fontSize: "0.7rem", lineHeight: 1.35 }}>
                        {ev.description}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...td, fontSize: "0.7rem", color: "var(--muted)" }}>
                    {ev.deviceName || ev.deviceSerial || "—"}
                    {ev.ssidName ? (
                      <div>SSID: {ev.ssidName}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--muted)", lineHeight: 1.45 }}>
        Tone driven by RSSI (admin-configurable amber/red thresholds) plus association / auth / DHCP
        failures on the matched MR in the last hour. Wired endpoints show as neutral. Want the full
        AP log? Use <strong>Open AP log</strong> above.
      </p>
    </>
  );
}

function wifiTonePalette(
  tone: NonNullable<WirelessEndpointCorrelation>["tone"] | "neutral",
): { bg: string; fg: string; border: string } {
  switch (tone) {
    case "green":
      return { bg: "rgba(34, 197, 94, 0.18)", fg: "#15803d", border: "rgba(34, 197, 94, 0.35)" };
    case "amber":
      return { bg: "rgba(245, 158, 11, 0.18)", fg: "#b45309", border: "rgba(245, 158, 11, 0.4)" };
    case "red":
      return { bg: "rgba(239, 68, 68, 0.18)", fg: "#b91c1c", border: "rgba(239, 68, 68, 0.4)" };
    case "neutral":
    default:
      return { bg: "var(--surface2)", fg: "var(--muted)", border: "var(--surface2)" };
  }
}

function wifiToneGlyph(tone: NonNullable<WirelessEndpointCorrelation>["tone"] | "neutral"): string {
  switch (tone) {
    case "green":
      return "●";
    case "amber":
      return "◐";
    case "red":
      return "▲";
    default:
      return "○";
  }
}

function wifiToneLabel(tone: NonNullable<WirelessEndpointCorrelation>["tone"] | "neutral"): string {
  switch (tone) {
    case "green":
      return "Healthy";
    case "amber":
      return "Borderline";
    case "red":
      return "Impacted";
    default:
      return "n/a";
  }
}

function wifiReasonLabel(reason: NonNullable<WirelessEndpointCorrelation>["reason"]): string {
  switch (reason) {
    case "wired":
      return "Endpoint is on Ethernet — no Wi-Fi correlation";
    case "no-wireless-data":
      return "TE did not report Wi-Fi connection details for this agent";
    case "no-meraki-match":
      return "No Meraki MR client matched the agent's wireless MAC at this site";
    case "weak-rssi":
      return "RSSI below the amber threshold";
    case "poor-rssi":
      return "RSSI below the red threshold (impacted)";
    case "recent-failures":
      return "Recent association / auth / DHCP failures on the matched MR";
    case "healthy":
      return "RSSI healthy and no recent failures on the matched MR";
    default:
      return "—";
  }
}

export function EndpointAgentSidecar({
  siteId,
  agentId,
  subtitle,
  open,
  onClose,
  onOpenAPLog,
}: {
  siteId: string;
  agentId: string | null;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  /**
   * Optional callback to hop directly from the Wi-Fi correlation section to
   * the per-AP connection log sidecar. Closes this sidecar before opening
   * the log so the user only ever sees one slide-out at a time.
   */
  onOpenAPLog?: (mr: { serial: string; name: string | null }) => void;
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
              <AgentFieldGrid agent={data.agent} inventory={data.inventory ?? null} />

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

              <WirelessCorrelationSection
                correlation={data.wirelessCorrelation ?? null}
                events={data.merakiClientEvents ?? []}
                eventsNote={data.merakiClientEventsNote ?? null}
                onOpenAPLog={onOpenAPLog}
              />

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
