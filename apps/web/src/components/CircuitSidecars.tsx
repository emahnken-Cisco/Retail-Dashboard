import { Fragment, useEffect, type CSSProperties, type ReactNode } from "react";
import type { DashboardCircuit } from "../lib/sitePayloads.js";
import { formatDashboardCircuitSpeed } from "../lib/sitePayloads.js";

const CONNECTIVITY_LABELS: Record<string, string> = {
  DIA: "Direct Internet Access (DIA)",
  BROADBAND: "Broadband",
  SATELLITE: "Satellite",
  CELLULAR_4G_5G: "4G / 5G cellular",
};

const label: CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 4,
};

function useEscapeClose(open: boolean, onClose: () => void) {
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

export function SidecarFrame({
  onClose,
  title,
  subtitle,
  children,
}: {
  onClose: () => void;
  title: string;
  subtitle: string | null;
  children: ReactNode;
}) {
  return (
    <Fragment>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 1100,
        }}
        onClick={onClose}
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
            <h2 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.3 }}>{title}</h2>
            {subtitle ? (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>{subtitle}</p>
            ) : null}
          </div>
          <button type="button" className="btn secondary" style={{ flexShrink: 0 }} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0.75rem 1rem 1rem" }}>{children}</div>
      </aside>
    </Fragment>
  );
}

/** Shown when user clicks WAN1 / WAN2 on the location WAN table. */
export function WanCircuitClickSidecar({
  open,
  onClose,
  locationName,
  wan,
  applianceModel,
  applianceSerial,
  merakiStatus,
  circuits,
  onGoToUtilization,
}: {
  open: boolean;
  onClose: () => void;
  locationName: string;
  wan: "wan1" | "wan2" | "cellular" | "wan3" | "wan4";
  applianceModel: string;
  applianceSerial: string;
  merakiStatus: string | null;
  circuits: DashboardCircuit[];
  /** Opens uplink traffic / latency / loss (last 12h) for this appliance and WAN. */
  onGoToUtilization?: () => void;
}) {
  useEscapeClose(open, onClose);
  if (!open) {
    return null;
  }
  const wanLabel =
    wan === "wan1" ? "WAN 1"
    : wan === "wan2" ? "WAN 2"
    : wan === "cellular" ? "Cellular"
    : wan === "wan3" ? "WAN 3"
    : "WAN 4";
  const subtitle = `${locationName} · ${applianceModel} (${applianceSerial}) · Meraki: ${merakiStatus ?? "—"}`;

  return (
    <SidecarFrame onClose={onClose} title={`${wanLabel} circuit`} subtitle={subtitle}>
      {onGoToUtilization ?
        <div style={{ marginBottom: "0.75rem" }}>
          <button type="button" className="btn secondary" onClick={onGoToUtilization}>
            Go to utilization
          </button>
        </div>
      : null}
      {circuits.length === 0 ? (
      <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.5 }}>
        No circuit is linked to <strong>{wanLabel}</strong> for this appliance. Add one under{" "}
        <strong>Circuits</strong> and set the Meraki interface to <code>{wan}</code>
        {applianceSerial ? (
          <>
            {" "}
            and optional appliance serial <code>{applianceSerial}</code>
          </>
        ) : null}
        .
      </p>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {circuits.map((c) => (
          <div
            key={c.id}
            style={{
              padding: "0.75rem 0.85rem",
              borderRadius: 8,
              border: "1px solid var(--surface2)",
              background: "var(--surface2)",
            }}
          >
            <div style={label}>Provider</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{c.providerName}</div>
            <div style={{ ...label, marginTop: 10 }}>Speed</div>
            <div style={{ fontSize: "0.88rem" }}>{formatDashboardCircuitSpeed(c)}</div>
            <div style={{ ...label, marginTop: 10 }}>Carrier circuit ID</div>
            <div style={{ fontSize: "0.82rem", fontFamily: "ui-monospace, monospace" }}>{c.carrierCircuitId}</div>
            <div style={{ ...label, marginTop: 10 }}>Type</div>
            <div style={{ fontSize: "0.82rem" }}>
              {CONNECTIVITY_LABELS[c.connectivityKind] ?? c.connectivityKind} ·{" "}
              {c.isSynchronous ? "Synchronous" : "Asynchronous"}
            </div>
            {[c.localContactName, c.localContactPhone, c.localContactEmail].some((x) => x?.trim()) ? (
              <>
                <div style={{ ...label, marginTop: 10 }}>Local contact</div>
                <div style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>
                  {c.siteLocalContactSlot ?
                    <span style={{ color: "var(--muted)", fontSize: "0.7rem", display: "block", marginBottom: 4 }}>
                      Location {c.siteLocalContactSlot === "PRIMARY" ? "primary" : "secondary"}
                    </span>
                  : null}
                  {c.localContactName?.trim() ? <div>{c.localContactName}</div> : null}
                  {c.localContactPhone?.trim() ? (
                    <div>
                      <a href={`tel:${c.localContactPhone.replace(/\s/g, "")}`}>{c.localContactPhone}</a>
                    </div>
                  ) : null}
                  {c.localContactEmail?.trim() ? (
                    <div>
                      <a href={`mailto:${c.localContactEmail}`}>{c.localContactEmail}</a>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    )}
    </SidecarFrame>
  );
}

/** Full list of location circuits with local contacts. */
export function LocationCircuitsSidecar({
  open,
  onClose,
  locationName,
  circuits,
  onGoToUtilization,
}: {
  open: boolean;
  onClose: () => void;
  locationName: string;
  circuits: DashboardCircuit[];
  /** Per-circuit: open uplink utilization / loss / latency for that interface. */
  onGoToUtilization?: (circuit: DashboardCircuit) => void;
}) {
  useEscapeClose(open, onClose);
  if (!open) {
    return null;
  }

  return (
    <SidecarFrame onClose={onClose} title="Circuits" subtitle={locationName}>
      {circuits.length === 0 ? (
      <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.5 }}>
        No circuits defined for this location. Use the <strong>Circuits</strong> page to add provider, speed, and Meraki
        interface mapping; local contacts are set per location on <strong>Locations</strong>.
      </p>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
        {circuits.map((c) => (
          <div
            key={c.id}
            style={{
              padding: "0.85rem 0.95rem",
              borderRadius: 8,
              border: "1px solid var(--surface2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.95rem" }}>{c.providerName}</strong>
              <code style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{c.merakiInterface}</code>
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 6 }}>
              {CONNECTIVITY_LABELS[c.connectivityKind] ?? c.connectivityKind} ·{" "}
              {c.isSynchronous ? "Sync" : "Async"} · Circuit ID:{" "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{c.carrierCircuitId}</span>
            </div>
            <div style={{ ...label, marginTop: 10 }}>Speed</div>
            <div style={{ fontSize: "0.88rem" }}>{formatDashboardCircuitSpeed(c)}</div>
            <div style={{ ...label, marginTop: 10 }}>Local contact</div>
            {c.siteLocalContactSlot ? (
              <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: 4 }}>
                Location {c.siteLocalContactSlot === "PRIMARY" ? "primary" : "secondary"} contact
              </div>
            ) : null}
            <div style={{ fontSize: "0.85rem", lineHeight: 1.45 }}>
              {c.localContactName?.trim() ? <div>{c.localContactName}</div> : null}
              {c.localContactPhone?.trim() ? (
                <div>
                  <a href={`tel:${c.localContactPhone.replace(/\s/g, "")}`}>{c.localContactPhone}</a>
                </div>
              ) : null}
              {c.localContactEmail?.trim() ? (
                <div>
                  <a href={`mailto:${c.localContactEmail}`}>{c.localContactEmail}</a>
                </div>
              ) : null}
              {!c.localContactName?.trim() && !c.localContactPhone?.trim() && !c.localContactEmail?.trim() ? (
                <span style={{ color: "var(--muted)" }}>—</span>
              ) : null}
            </div>
            {c.notes?.trim() ? (
              <>
                <div style={{ ...label, marginTop: 10 }}>Notes</div>
                <div style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>{c.notes}</div>
              </>
            ) : null}
            {c.merakiApplianceSerial?.trim() ? (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
                Appliance serial: <code>{c.merakiApplianceSerial}</code>
              </p>
            ) : null}
            {onGoToUtilization ?
              <button
                type="button"
                className="btn secondary"
                style={{ marginTop: "0.65rem", fontSize: "0.78rem" }}
                onClick={() => onGoToUtilization(c)}
              >
                Go to utilization
              </button>
            : null}
          </div>
        ))}
      </div>
      )}
    </SidecarFrame>
  );
}
