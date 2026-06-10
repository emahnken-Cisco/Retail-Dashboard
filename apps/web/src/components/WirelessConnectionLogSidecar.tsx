/**
 * Slide-out panel showing the recent dashboard event log for a single Meraki
 * MR / CW access point. Driven by
 * `GET /api/dashboard/sites/:siteId/wireless/:serial/connection-log?window=...`.
 *
 * The window defaults to whatever the admin has set under
 * `lenses.wirelessConnLogDefaultWindow` (1h / 12h / 24h / 7d) and the user can
 * override per-open via the toggle bar at the top of the sidecar. Events are
 * Meraki's free-form dashboard events (association, deauth, 8021x, etc.)
 * returned newest-first.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "../api.js";
import { SidecarFrame } from "./CircuitSidecars.js";

export type WirelessConnectionLogWindow = "1h" | "12h" | "24h" | "7d";

export const WIRELESS_CONN_LOG_WINDOW_LABELS: Record<WirelessConnectionLogWindow, string> = {
  "1h": "Last hour",
  "12h": "Last 12 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

export type WirelessConnectionLogEvent = {
  occurredAt: string;
  type: string;
  description?: string | null;
  category?: string | null;
  clientId?: string | null;
  clientDescription?: string | null;
  clientMac?: string | null;
  deviceSerial?: string | null;
  deviceName?: string | null;
  ssidNumber?: number | null;
  ssidName?: string | null;
  eventData?: Record<string, unknown> | null;
};

export type WirelessConnectionLogPayload = {
  serial: string;
  deviceName: string | null;
  networkId: string;
  window: WirelessConnectionLogWindow;
  windowSeconds: number;
  capturedAt: string;
  events: WirelessConnectionLogEvent[];
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

const WINDOW_ORDER: WirelessConnectionLogWindow[] = ["1h", "12h", "24h", "7d"];

/** Classify an event type into a tone so admins can scan the log quickly. */
function toneForEventType(type: string): "ok" | "warn" | "danger" | "muted" {
  const t = type.toLowerCase();
  if (t.includes("association") && !t.includes("dis") && !t.includes("fail")) return "ok";
  if (t.includes("authentic") && !t.includes("fail")) return "ok";
  if (t.includes("dhcp_lease") || t === "dhcp") return "ok";
  if (t.includes("disassoc") || t.includes("deauth")) return "warn";
  if (t.includes("fail") || t.includes("error") || t.includes("reject") || t.includes("no_lease")) {
    return "danger";
  }
  return "muted";
}

const TONE_COLOR: Record<"ok" | "warn" | "danger" | "muted", string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  muted: "var(--muted)",
};

/** Render a single event row. Compact: timestamp, type pill, client/SSID summary, expandable raw eventData. */
function EventRow({ ev }: { ev: WirelessConnectionLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneForEventType(ev.type);
  const hasData = ev.eventData && Object.keys(ev.eventData).length > 0;
  const clientLabel =
    ev.clientDescription ||
    ev.clientMac ||
    ev.clientId ||
    null;

  return (
    <div
      className="card"
      style={{
        padding: "0.5rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        borderLeft: `3px solid ${TONE_COLOR[tone]}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
          {new Date(ev.occurredAt).toLocaleString()}
        </span>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            color: TONE_COLOR[tone],
            background: "var(--surface2)",
            padding: "1px 7px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {ev.type}
        </span>
        {ev.ssidName ? (
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
            SSID <span style={{ color: "var(--text)", fontWeight: 600 }}>{ev.ssidName}</span>
          </span>
        ) : null}
      </div>
      {ev.description ? (
        <div style={{ fontSize: "0.78rem", color: "var(--text)" }}>{ev.description}</div>
      ) : null}
      {clientLabel ? (
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
          {clientLabel}
        </div>
      ) : null}
      {hasData ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            alignSelf: "flex-start",
            marginTop: 2,
            fontSize: "0.7rem",
            background: "transparent",
            color: "var(--muted)",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      ) : null}
      {expanded && ev.eventData ? (
        <pre
          style={{
            margin: "4px 0 0",
            padding: "6px 8px",
            background: "var(--surface2)",
            borderRadius: 4,
            fontSize: "0.7rem",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(ev.eventData, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** Window toggle bar — segmented control across the four supported windows. */
function WindowToggle({
  value,
  onChange,
  loading,
}: {
  value: WirelessConnectionLogWindow;
  onChange: (next: WirelessConnectionLogWindow) => void;
  loading: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Time window"
      style={{
        display: "flex",
        gap: 0,
        background: "var(--surface2)",
        borderRadius: 6,
        padding: 2,
        width: "fit-content",
      }}
    >
      {WINDOW_ORDER.map((w) => {
        const selected = w === value;
        return (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={loading}
            onClick={() => onChange(w)}
            style={{
              fontSize: "0.74rem",
              padding: "3px 10px",
              fontWeight: selected ? 700 : 500,
              background: selected ? "var(--surface)" : "transparent",
              color: selected ? "var(--text)" : "var(--muted)",
              border: "none",
              borderRadius: 4,
              cursor: loading ? "wait" : "pointer",
              opacity: loading && !selected ? 0.5 : 1,
            }}
          >
            {WIRELESS_CONN_LOG_WINDOW_LABELS[w]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Module-level cache of the admin's `wirelessConnLogDefaultWindow` lens. The
 * sidecar can be opened many times per session — fetch once on first need,
 * reuse forever. A page refresh re-fetches, so admin changes propagate after
 * reload (acceptable for a UX preference).
 */
let _lensDefaultPromise: Promise<WirelessConnectionLogWindow | null> | null = null;
function fetchLensDefault(): Promise<WirelessConnectionLogWindow | null> {
  if (_lensDefaultPromise) {
    return _lensDefaultPromise;
  }
  _lensDefaultPromise = api<{ lenses?: { wirelessConnLogDefaultWindow?: string } }>(
    "/api/dashboard/ui-config",
  )
    .then((cfg) => {
      const v = cfg.lenses?.wirelessConnLogDefaultWindow;
      return v === "1h" || v === "12h" || v === "24h" || v === "7d" ? v : null;
    })
    .catch(() => null);
  return _lensDefaultPromise;
}

export function WirelessConnectionLogSidecar({
  open,
  onClose,
  siteId,
  serial,
  deviceLabel,
}: {
  open: boolean;
  onClose: () => void;
  siteId: string;
  serial: string;
  /** Display name like "4473-MR01" for the subtitle. */
  deviceLabel: string;
}) {
  useEscapeClose(open, onClose);

  const [window, setWindow] = useState<WirelessConnectionLogWindow>("12h");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<WirelessConnectionLogPayload | null>(null);

  // On first open after a session start, resolve the admin default and apply
  // it. Subsequent opens of *this same component instance* keep whatever the
  // user picked via the toggle — they're already in a triage flow.
  const [appliedDefault, setAppliedDefault] = useState(false);
  useEffect(() => {
    if (!open || appliedDefault) {
      return;
    }
    let cancelled = false;
    void fetchLensDefault().then((v) => {
      if (cancelled) return;
      if (v) {
        setWindow(v);
      }
      setAppliedDefault(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, appliedDefault]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api<WirelessConnectionLogPayload>(
        `/api/dashboard/sites/${encodeURIComponent(siteId)}/wireless/${encodeURIComponent(
          serial,
        )}/connection-log?window=${window}`,
      );
      setData(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Request failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [siteId, serial, window]);

  // Defer the first fetch until the admin default has been applied so we
  // don't issue a wasted request on the hardcoded "12h" before flipping to
  // whatever the lens says.
  useEffect(() => {
    if (!open || !appliedDefault) {
      return;
    }
    void load();
  }, [open, appliedDefault, load]);

  // Group events by category for the summary bar so users see breakdowns at a glance.
  const summary = useMemo(() => {
    if (!data) return null;
    const counts: Record<"ok" | "warn" | "danger" | "muted", number> = {
      ok: 0,
      warn: 0,
      danger: 0,
      muted: 0,
    };
    for (const ev of data.events) {
      counts[toneForEventType(ev.type)] += 1;
    }
    return counts;
  }, [data]);

  if (!open) {
    return null;
  }

  return (
    <SidecarFrame
      onClose={onClose}
      title="Wireless connection log"
      subtitle={`${deviceLabel} · ${serial}`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <WindowToggle value={window} onChange={setWindow} loading={loading} />
          <button
            type="button"
            className="btn secondary"
            onClick={() => void load()}
            disabled={loading}
            style={{ fontSize: "0.74rem", padding: "3px 10px" }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {err ? (
          <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.85rem" }}>{err}</p>
        ) : null}

        {data?.note ? (
          <p
            style={{
              margin: 0,
              fontSize: "0.78rem",
              color: "var(--warn)",
              background: "var(--surface2)",
              padding: "0.45rem 0.65rem",
              borderRadius: 6,
            }}
          >
            {data.note}
          </p>
        ) : null}

        {data ? (
          <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)" }}>
            {data.events.length} event{data.events.length === 1 ? "" : "s"} in the {WIRELESS_CONN_LOG_WINDOW_LABELS[window].toLowerCase()} ·
            captured {new Date(data.capturedAt).toLocaleTimeString()}
          </p>
        ) : null}

        {summary ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(
              [
                ["ok", "OK"],
                ["warn", "Warn"],
                ["danger", "Errors"],
                ["muted", "Other"],
              ] as const
            )
              .filter(([k]) => summary[k] > 0)
              .map(([k, label]) => (
                <span
                  key={k}
                  style={{
                    fontSize: "0.72rem",
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--surface2)",
                    color: TONE_COLOR[k],
                    fontWeight: 600,
                  }}
                >
                  {label} {summary[k]}
                </span>
              ))}
          </div>
        ) : null}

        {!loading && data && data.events.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
            No wireless events recorded by Meraki for this AP in the selected window.
          </p>
        ) : null}

        {data ? (
          <div style={listStyle}>
            {data.events.map((ev, i) => (
              <EventRow key={`${ev.occurredAt}-${i}`} ev={ev} />
            ))}
          </div>
        ) : loading ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>Loading events…</p>
        ) : null}
      </div>
    </SidecarFrame>
  );
}

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.45rem",
};
