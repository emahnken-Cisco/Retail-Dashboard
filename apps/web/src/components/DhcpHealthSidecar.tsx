/**
 * Slide-out panel showing per-VLAN DHCP scope health for the latest Meraki
 * snapshot's MX appliance(s). Driven by `GET /api/dashboard/sites/:siteId/dhcp-scope-health`.
 *
 * Rendering matches the approved canvas mockup: a rollup gauge at the top,
 * then one card per scope with utilization + scope options (lease time, DNS,
 * domain, mode, mandatory DHCP, fixed/reserved counts, and pills for extra
 * DHCP options like option 15 / 42 / 66).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api.js";
import { SidecarFrame } from "./CircuitSidecars.js";
import { SemiGauge, ToneDot, toneForFraction, type GaugeTone } from "./SemiGauge.js";

export type DhcpScope = {
  vlanId: number;
  name: string;
  subnet: string;
  applianceIp: string;
  used: number;
  capacity: number;
  utilizationPct: number | null;
  mode: string;
  leaseTime: string | null;
  dnsServers: string[];
  domainName: string | null;
  fixedAssignments: number;
  reservedRanges: number;
  mandatoryDhcp: boolean;
  extraOptions: Array<{ code: number; name: string; value: string }>;
};

export type DhcpScopeHealthPayload = {
  networkId: string;
  capturedAt: string;
  scopes: DhcpScope[];
  totalUsed: number;
  totalCapacity: number;
  totalUtilizationPct: number | null;
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

const kvLabel: CSSProperties = {
  fontSize: "0.68rem",
  color: "var(--muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const kvValue: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text)",
};

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={kvLabel}>{k}</span>
      <span style={kvValue}>{v}</span>
    </div>
  );
}

function OptionPill({ code, name, value }: { code: number; name: string; value: string }) {
  return (
    <span
      title={value}
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
        maxWidth: 200,
      }}
    >
      <span style={{ fontWeight: 700, color: "var(--accent)" }}>{code}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </span>
  );
}

function ScopeCard({ scope }: { scope: DhcpScope }) {
  const fraction =
    scope.capacity > 0 && scope.utilizationPct != null ? scope.utilizationPct / 100 : null;
  const tone: GaugeTone = toneForFraction(fraction);
  const usageDisplay =
    scope.utilizationPct == null ? "—" : `${Math.round(scope.utilizationPct)}`;

  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.9rem" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
        <SemiGauge
          value={scope.utilizationPct}
          max={100}
          label="usage"
          display={usageDisplay}
          suffix="%"
          tone={tone}
          size={120}
        />
        <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ToneDot tone={tone} title={`Utilization tone: ${tone}`} />
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
              VLAN {scope.vlanId} · {scope.name}
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
            {scope.subnet} · MX {scope.applianceIp}
          </p>
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
            {scope.used.toLocaleString()} / {scope.capacity.toLocaleString()} addresses in use
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem 0.85rem" }}>
        <Kv k="Mode" v={scope.mode} />
        <Kv k="Lease" v={scope.leaseTime ?? "—"} />
        <Kv k="DNS" v={scope.dnsServers.length > 0 ? scope.dnsServers.join(", ") : "—"} />
        <Kv k="Domain" v={scope.domainName ?? "—"} />
        <Kv k="Fixed IPs" v={String(scope.fixedAssignments)} />
        <Kv k="Reserved" v={String(scope.reservedRanges)} />
        <Kv k="Mandatory DHCP" v={scope.mandatoryDhcp ? "Yes" : "No"} />
      </div>

      {scope.extraOptions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={kvLabel}>Extra options</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {scope.extraOptions.map((o) => (
              <OptionPill key={o.code} code={o.code} name={o.name} value={o.value} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DhcpHealthSidecar({
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
  const [data, setData] = useState<DhcpScopeHealthPayload | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoading(true);
    setErr(null);
    setData(null);
    void api<DhcpScopeHealthPayload>(`/api/dashboard/sites/${encodeURIComponent(siteId)}/dhcp-scope-health`)
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

  const rollupFraction =
    data && data.totalCapacity > 0 && data.totalUtilizationPct != null
      ? data.totalUtilizationPct / 100
      : null;
  const rollupTone = toneForFraction(rollupFraction);

  return (
    <SidecarFrame
      onClose={onClose}
      title="DHCP scope health"
      subtitle={`${locationName} · per-VLAN client usage and scope options`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {loading ? <p style={{ margin: 0, color: "var(--muted)" }}>Loading DHCP scopes…</p> : null}
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

            <div
              className="card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "0.9rem",
              }}
            >
              <SemiGauge
                value={data.totalUtilizationPct}
                max={100}
                label="network usage"
                display={
                  data.totalUtilizationPct == null ? "—" : String(Math.round(data.totalUtilizationPct))
                }
                suffix="%"
                tone={rollupTone}
                size={120}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Network rollup</h3>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                  {data.totalUsed.toLocaleString()} / {data.totalCapacity.toLocaleString()} addresses across{" "}
                  {data.scopes.length} scope{data.scopes.length === 1 ? "" : "s"}
                </p>
                <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)" }}>
                  Snapshot {new Date(data.capturedAt).toLocaleString()}
                </p>
              </div>
            </div>

            {data.scopes.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>
                No VLANs returned by this network's MX appliance.
              </p>
            ) : (
              data.scopes.map((s) => <ScopeCard key={s.vlanId} scope={s} />)
            )}
          </>
        ) : null}
      </div>
    </SidecarFrame>
  );
}
