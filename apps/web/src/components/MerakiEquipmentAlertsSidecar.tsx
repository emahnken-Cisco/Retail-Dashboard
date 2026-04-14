import { useEffect, type CSSProperties } from "react";
import type { MerakiAlertHistoryRow, MerakiDeviceRow } from "../lib/sitePayloads.js";
import { alertsForDeviceSerial } from "../lib/sitePayloads.js";

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

function formatAlertTime(iso: string): string {
  if (!iso || iso === "—") {
    return "—";
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function MerakiEquipmentAlertsSidecar({
  device,
  networkAlerts,
  alertsNote,
  snapshotCapturedAt,
  open,
  onClose,
}: {
  device: MerakiDeviceRow | null;
  networkAlerts: MerakiAlertHistoryRow[];
  alertsNote?: string | null;
  snapshotCapturedAt: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const rows = device ? alertsForDeviceSerial(networkAlerts, device.serial) : [];

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

  if (!open || !device) {
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
          width: "min(520px, 100vw)",
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
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.3 }}>Recent alerts</h2>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>{device.name}</p>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.72rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {device.model} · {device.serial}
            </p>
          </div>
          <button type="button" className="btn secondary" style={{ flexShrink: 0 }} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0.75rem 1rem 1rem" }}>
          {alertsNote ? (
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "var(--warn)", lineHeight: 1.45 }}>
              Alerts API note: {alertsNote}
            </p>
          ) : null}
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
            From Meraki <code>GET /networks/…/alerts/history</code> in the latest ingest (up to 50 events per network).
            Only rows whose device serial matches this MR/MS are shown.
            {snapshotCapturedAt ? ` Snapshot: ${new Date(snapshotCapturedAt).toLocaleString()}.` : ""}
          </p>
          {rows.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.45 }}>
              No alert history entries matched this serial in the current snapshot. The device may have had no recent
              alerts, or Meraki attributed events to another identifier.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Alert</th>
                  <th style={th}>Type id</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.occurredAt}-${r.alertTypeId}-${i}`}>
                    <td style={{ ...td, whiteSpace: "nowrap", fontSize: "0.75rem" }}>{formatAlertTime(r.occurredAt)}</td>
                    <td style={td}>{r.alertType}</td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: "0.75rem" }}>{r.alertTypeId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  );
}
