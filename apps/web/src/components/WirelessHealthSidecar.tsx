/**
 * Slide-out panel showing per-AP, per-channel, and per-SSID wireless health
 * for the latest Meraki snapshot of a site. Driven by
 * `GET /api/dashboard/sites/:siteId/wireless-health`.
 *
 * Layout matches the approved canvas mockup:
 *   1) Per-channel block      — congestion rollup across radios
 *   2) Per-AP block           — client count vs capacity, RSSI, per-band airtime / TX
 *   3) Per-SSID block         — traffic and client share across SSIDs
 */
import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api.js";
import { SidecarFrame } from "./CircuitSidecars.js";
import { SemiGauge, ToneDot, toneForFraction, type GaugeTone } from "./SemiGauge.js";

export type WirelessApBand = {
  band: "2.4 GHz" | "5 GHz" | "6 GHz";
  channel: number | null;
  channelWidthMhz: number | null;
  airtimePct: number | null;
  nonWifiPct: number | null;
  txPowerDbm: number | null;
};

export type WirelessAp = {
  name: string;
  model: string;
  serial: string;
  clientCount: number;
  clientCapacity: number;
  avgClientRssiDbm: number | null;
  bands: WirelessApBand[];
};

export type WirelessChannel = {
  band: "2.4 GHz" | "5 GHz" | "6 GHz";
  channel: number;
  apsOnChannel: number;
  avgAirtimePct: number | null;
  avgNonWifiPct: number | null;
};

export type WirelessSsid = {
  number: number;
  name: string;
  enabled: boolean;
  authMode: string | null;
  wpaEncryptionMode: string | null;
  ipAssignmentMode: string | null;
  bandSelection: string | null;
  minBitrateMbps: number | null;
  visible: boolean;
};

export type WirelessHealthPayload = {
  networkId: string;
  capturedAt: string;
  timespanSeconds: number;
  channels: WirelessChannel[];
  aps: WirelessAp[];
  ssids: WirelessSsid[];
  note?: string;
};

function useEscapeClose(open: boolean, onClose: () => void): void {
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
}

/** RSSI tone: -65 dBm or stronger = ok; -75 to -65 = warn; weaker than -75 = danger. */
function toneForRssi(dbm: number | null): GaugeTone {
  if (dbm == null || !Number.isFinite(dbm)) return "muted";
  if (dbm >= -65) return "ok";
  if (dbm >= -75) return "warn";
  return "danger";
}

/** Non-Wi-Fi airtime tone: <5% ok; 5–15% warn; 15%+ danger. */
function toneForNonWifi(pct: number | null): GaugeTone {
  if (pct == null || !Number.isFinite(pct)) return "muted";
  if (pct < 5) return "ok";
  if (pct < 15) return "warn";
  return "danger";
}

const kvLabel: CSSProperties = {
  fontSize: "0.66rem",
  color: "var(--muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const sectionHeader: CSSProperties = {
  fontSize: "0.78rem",
  color: "var(--muted)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  margin: "0 0 0.4rem",
};

function HealthPill({ tone, label }: { tone: GaugeTone; label: string }) {
  const color =
    tone === "ok" ? "var(--ok)" :
    tone === "warn" ? "var(--warn)" :
    tone === "danger" ? "var(--danger)" :
    "var(--muted)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        background: "var(--surface2)",
        borderRadius: 999,
        fontSize: "0.72rem",
        color: "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      <ToneDot tone={tone} />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

function ChannelRow({ ch }: { ch: WirelessChannel }) {
  const airtime = ch.avgAirtimePct ?? 0;
  const nonWifi = ch.avgNonWifiPct ?? 0;
  const wifi = Math.max(0, airtime - nonWifi);
  const airtimeTone = toneForFraction(ch.avgAirtimePct != null ? ch.avgAirtimePct / 100 : null);

  return (
    <div
      className="card"
      style={{
        padding: "0.65rem 0.85rem",
        display: "flex",
        alignItems: "center",
        gap: "0.85rem",
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ToneDot tone={airtimeTone} />
          <strong style={{ fontSize: "0.88rem" }}>
            {ch.band} · ch {ch.channel}
          </strong>
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
            {ch.apsOnChannel} AP{ch.apsOnChannel === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
          avg airtime{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {ch.avgAirtimePct != null ? `${ch.avgAirtimePct.toFixed(1)}%` : "—"}
          </span>{" "}
          · Wi-Fi {wifi.toFixed(1)}% / noise{" "}
          <span style={{ color: toneForNonWifi(ch.avgNonWifiPct) === "danger" ? "var(--danger)" : "var(--text)" }}>
            {nonWifi.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function ApBandRow({ b }: { b: WirelessApBand }) {
  const wifi = Math.max(0, (b.airtimePct ?? 0) - (b.nonWifiPct ?? 0));
  const airtimeTone = toneForFraction(b.airtimePct != null ? b.airtimePct / 100 : null);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.65rem",
        padding: "0.4rem 0",
        borderTop: "1px solid var(--surface2)",
      }}
    >
      <div style={{ flex: "0 0 60px", fontSize: "0.78rem", fontWeight: 600 }}>{b.band}</div>
      <div style={{ flex: "0 0 70px", fontSize: "0.78rem", color: "var(--muted)" }}>
        ch {b.channel ?? "—"}
        {b.channelWidthMhz ? ` / ${b.channelWidthMhz}` : ""}
      </div>
      <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <ToneDot tone={airtimeTone} />
        <span style={{ fontSize: "0.78rem", color: "var(--text)" }}>
          {b.airtimePct != null ? `${b.airtimePct.toFixed(0)}%` : "—"}
        </span>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
          (Wi-Fi {wifi.toFixed(0)}% / noise{" "}
          <span style={{ color: toneForNonWifi(b.nonWifiPct) === "danger" ? "var(--danger)" : "var(--muted)" }}>
            {(b.nonWifiPct ?? 0).toFixed(0)}%
          </span>
          )
        </span>
      </div>
      <div style={{ flex: "0 0 70px", fontSize: "0.72rem", color: "var(--muted)", textAlign: "right" }}>
        TX {b.txPowerDbm != null ? `${b.txPowerDbm} dBm` : "—"}
      </div>
    </div>
  );
}

function ApCard({ ap }: { ap: WirelessAp }) {
  const clientFraction = ap.clientCapacity > 0 ? ap.clientCount / ap.clientCapacity : null;
  const clientTone = toneForFraction(clientFraction);
  const rssiTone = toneForRssi(ap.avgClientRssiDbm);

  return (
    <div className="card" style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>{ap.name}</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
            {ap.model} · {ap.serial}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <HealthPill
            tone={clientTone}
            label={`${ap.clientCount} / ${ap.clientCapacity} clients`}
          />
          <HealthPill
            tone={rssiTone}
            label={`avg RSSI ${ap.avgClientRssiDbm != null ? `${ap.avgClientRssiDbm} dBm` : "—"}`}
          />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {ap.bands.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>No radio data available.</p>
        ) : (
          ap.bands.map((b) => <ApBandRow key={b.band} b={b} />)
        )}
      </div>
    </div>
  );
}

function ssidAuthLabel(authMode: string | null, wpaEncryptionMode: string | null): string {
  if (!authMode) return "—";
  const a = authMode.toLowerCase();
  if (a === "open") return "Open";
  if (a === "open-with-radius") return "Open + RADIUS";
  if (a === "psk") return wpaEncryptionMode ? `PSK · ${wpaEncryptionMode}` : "PSK";
  if (a.startsWith("8021x")) return "802.1X";
  return authMode;
}

function ssidBandLabel(bandSelection: string | null): string {
  if (!bandSelection) return "—";
  if (/band steering/i.test(bandSelection)) return "Dual + band steering";
  if (/5 ghz/i.test(bandSelection)) return "5 GHz only";
  if (/dual/i.test(bandSelection)) return "Dual band";
  return bandSelection;
}

function SsidRow({ s }: { s: WirelessSsid }) {
  return (
    <div className="card" style={{ padding: "0.7rem 0.85rem", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.88rem" }}>{s.name}</strong>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>slot {s.number}</span>
        {!s.visible ? (
          <span
            style={{
              fontSize: "0.66rem",
              color: "var(--muted)",
              padding: "1px 6px",
              borderRadius: 4,
              background: "var(--surface2)",
            }}
          >
            hidden
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "0.35rem 0.85rem",
          fontSize: "0.78rem",
        }}
      >
        <span style={{ color: "var(--muted)" }}>
          Auth{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {ssidAuthLabel(s.authMode, s.wpaEncryptionMode)}
          </span>
        </span>
        <span style={{ color: "var(--muted)" }}>
          IP mode{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{s.ipAssignmentMode ?? "—"}</span>
        </span>
        <span style={{ color: "var(--muted)" }}>
          Band <span style={{ color: "var(--text)", fontWeight: 600 }}>{ssidBandLabel(s.bandSelection)}</span>
        </span>
        <span style={{ color: "var(--muted)" }}>
          Min bitrate{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {s.minBitrateMbps != null ? `${s.minBitrateMbps} Mbps` : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}

export function WirelessHealthSidecar({
  open,
  onClose,
  siteId,
  locationName,
}: {
  open: boolean;
  onClose: () => void;
  siteId: string;
  locationName: string;
}) {
  useEscapeClose(open, onClose);

  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<WirelessHealthPayload | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoading(true);
    setErr(null);
    setData(null);
    void api<WirelessHealthPayload>(`/api/dashboard/sites/${encodeURIComponent(siteId)}/wireless-health`)
      .then((r) => {
        setData(r);
        setErr(null);
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : "Request failed");
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, siteId]);

  if (!open) {
    return null;
  }

  return (
    <SidecarFrame
      onClose={onClose}
      title="Wireless health"
      subtitle={`${locationName} · per channel, AP, and SSID across the network`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {loading ? <p style={{ margin: 0, color: "var(--muted)" }}>Loading wireless telemetry…</p> : null}
        {err ? (
          <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.88rem" }}>{err}</p>
        ) : null}
        {data ? (
          <>
            {data.note ? (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.78rem",
                  color: "var(--warn)",
                  background: "var(--surface2)",
                  padding: "0.5rem 0.65rem",
                  borderRadius: 6,
                }}
              >
                Partial data — {data.note}
              </p>
            ) : null}
            <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)" }}>
              Window {Math.round(data.timespanSeconds / 60)} min · captured{" "}
              {new Date(data.capturedAt).toLocaleString()}
            </p>

            <section>
              <h4 style={sectionHeader}>Per channel</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {data.channels.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
                    No channel utilization returned for this network.
                  </p>
                ) : (
                  data.channels.map((c) => <ChannelRow key={`${c.band}-${c.channel}`} ch={c} />)
                )}
              </div>
            </section>

            <section>
              <h4 style={sectionHeader}>Per access point</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {data.aps.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
                    No wireless APs in the latest snapshot.
                  </p>
                ) : (
                  data.aps.map((a) => <ApCard key={a.serial} ap={a} />)
                )}
              </div>
            </section>

            <section>
              <h4 style={sectionHeader}>Per SSID</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {data.ssids.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
                    No SSIDs reported wireless activity in this window.
                  </p>
                ) : (
                  data.ssids.map((s) => <SsidRow key={s.number} s={s} />)
                )}
                {data.ssids.length > 0 ? (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", color: "var(--muted)" }}>
                    SSID configuration only — Meraki requires per-AP scoping for usage/client
                    histories, so per-SSID load shares are deferred to a follow-up.
                  </p>
                ) : null}
              </div>
            </section>

            <span style={{ ...kvLabel, marginTop: 4 }}>
              Capacity ceilings come from{" "}
              <strong style={{ color: "var(--text)" }}>Admin → Wireless capacity</strong>.
            </span>
          </>
        ) : null}
      </div>
    </SidecarFrame>
  );
}
