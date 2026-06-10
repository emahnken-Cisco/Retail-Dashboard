import { useEffect, useId, useMemo, useState } from "react";
import { api } from "../api.js";
import type { TETestRow } from "../lib/sitePayloads.js";
import { SidecarFrame } from "./CircuitSidecars.js";

const UPLINK_HISTORY_TIMESPAN_SEC = 43200;

const CHART_BLUE = "#3d8bfd";
const CHART_FILL = "rgba(61, 139, 253, 0.22)";

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

type Point = { t: string; v: number | null };

type UplinkOutageEvent = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  providerName: string;
  carrierCircuitId: string;
};

type UplinkHistoryPayload = {
  serial: string;
  uplink: string;
  targetIp: string;
  timespanSeconds: number;
  resolutionSecondsUsage?: number;
  resolutionSecondsLoss?: number;
  trafficMbps: Point[];
  latencyMs: Point[];
  lossPercent: Point[];
  goodputKbps: Point[];
  /** Carrier-circuit outages mapped to this uplink (Meraki ingest), overlapping the chart window. */
  outageEvents?: UplinkOutageEvent[];
  errors?: { usage?: string; lossLatency?: string };
};

type TeEnterpriseMetricsPayload = {
  testId: string;
  testName: string;
  testType: string;
  timespanSeconds: number;
  teWindow: string;
  teResource: string;
  latencyMs: Point[];
  lossPercent: Point[];
};

function validPoints(points: Point[]): { t: string; v: number }[] {
  return points.filter((p): p is { t: string; v: number } => p.v != null && !Number.isNaN(p.v));
}

function formatOutageTimeRange(startedAt: string, endedAt: string | null): string {
  const s = new Date(startedAt);
  const e = endedAt ? new Date(endedAt) : null;
  const tf: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (!e) {
    return `${s.toLocaleString(undefined, tf)} – ongoing`;
  }
  return `${s.toLocaleString(undefined, tf)} – ${e.toLocaleString(undefined, tf)}`;
}

function formatOutageDurationMs(startMs: number, endMs: number | null, nowMs: number): string {
  const end = endMs ?? nowMs;
  const sec = Math.max(0, Math.round((end - startMs) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const m = Math.floor(sec / 60);
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
}

function AreaLineChart({
  points,
  yLabel,
  formatY,
  height = 132,
  outageEvents,
  domainOverride,
}: {
  points: { t: string; v: number }[];
  yLabel: string;
  formatY: (n: number) => string;
  height?: number;
  outageEvents?: UplinkOutageEvent[];
  /** When there are no traffic samples, still position outage markers using this x-domain (ms). */
  domainOverride?: { t0: number; t1: number };
}) {
  const w = 460;
  const pad = { l: 44, r: 10, t: 10, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const chartGeom = useMemo(() => {
    const hasDomain =
      points.length > 0 ||
      (domainOverride != null && domainOverride.t1 > domainOverride.t0);
    if (!hasDomain) {
      return {
        pathD: "",
        areaD: "",
        xLabels: [] as { x: number; text: string }[],
        yTicks: [] as { y: number; text: string }[],
        t0: 0,
        t1: 0,
        span: 1,
        xOfMs: (_ms: number) => pad.l,
        yOf: (_v: number) => pad.t + innerH,
        yMin: 0,
        yMax: 1,
      };
    }

    const t0 = points.length > 0 ? Date.parse(points[0].t) : domainOverride!.t0;
    const t1 = points.length > 0 ? Date.parse(points[points.length - 1].t) : domainOverride!.t1;
    const span = Math.max(1, t1 - t0);
    const xOfMs = (ms: number) => pad.l + ((ms - t0) / span) * innerW;

    let yMin = 0;
    let yMax = 1;
    let yOf = (v: number) => pad.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    if (points.length > 0) {
      const vals = points.map((p) => p.v);
      let minV = Math.min(...vals);
      let maxV = Math.max(...vals);
      if (minV === maxV) {
        maxV = minV + 1e-6;
      }
      const padY = (maxV - minV) * 0.08;
      yMin = Math.max(0, minV - padY);
      yMax = maxV + padY;
      yOf = (v: number) => pad.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    }

    const xOf = (t: string) => xOfMs(Date.parse(t));

    const parts: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const x = xOf(points[i].t);
      const y = yOf(points[i].v);
      parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const pathD = parts.join(" ");

    let areaD = "";
    if (points.length > 0) {
      const firstX = xOf(points[0].t);
      const lastX = xOf(points[points.length - 1].t);
      areaD = `${pathD} L ${lastX.toFixed(1)} ${(pad.t + innerH).toFixed(1)} L ${firstX.toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;
    }

    const xLabels: { x: number; text: string }[] = [];
    if (points.length > 0) {
      const step = Math.max(1, Math.floor(points.length / 5));
      for (let i = 0; i < points.length; i += step) {
        const d = new Date(points[i].t);
        xLabels.push({
          x: xOf(points[i].t),
          text: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
        });
      }
    } else {
      for (let i = 0; i <= 4; i++) {
        const ms = t0 + (i / 4) * (t1 - t0);
        xLabels.push({
          x: xOfMs(ms),
          text: new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
        });
      }
    }

    const yTicks: { y: number; text: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (i / 4) * (yMax - yMin);
      const y = yOf(v);
      yTicks.push({ y, text: formatY(v) });
    }

    return { pathD, areaD, xLabels, yTicks, t0, t1, span, xOfMs, yOf, yMin, yMax };
  }, [points, innerW, innerH, pad.l, pad.t, pad.b, formatY, domainOverride]);

  const outageOverlay = useMemo(() => {
    const t0 = chartGeom.t0;
    const t1 = chartGeom.t1;
    if (!outageEvents?.length || t1 <= t0) {
      return { bands: [] as { x1: number; x2: number; key: string }[], stars: [] as { x: number; key: string }[] };
    }
    const span = Math.max(1, t1 - t0);
    const xOfMs = (ms: number) => pad.l + ((ms - t0) / span) * innerW;
    const nowMs = Date.now();
    const bands: { x1: number; x2: number; key: string }[] = [];
    const stars: { x: number; key: string }[] = [];
    for (const ev of outageEvents) {
      const startMs = Date.parse(ev.startedAt);
      const endMs = ev.endedAt ? Date.parse(ev.endedAt) : nowMs;
      const clipStart = Math.max(startMs, t0);
      const clipEnd = Math.min(endMs, t1);
      if (clipEnd <= clipStart) {
        continue;
      }
      bands.push({
        x1: xOfMs(clipStart),
        x2: xOfMs(clipEnd),
        key: ev.id,
      });
      const starMs = Math.min(Math.max(startMs, t0), t1);
      stars.push({ x: xOfMs(starMs), key: `star-${ev.id}` });
    }
    return { bands, stars };
  }, [outageEvents, chartGeom.t0, chartGeom.t1, pad.l, innerW]);

  const { pathD, areaD, xLabels, yTicks } = chartGeom;

  const hasTrafficLine = points.length > 0;
  const hasOutageOnlyChart =
    !hasTrafficLine &&
    domainOverride != null &&
    domainOverride.t1 > domainOverride.t0 &&
    (outageEvents?.length ?? 0) > 0;
  if (!hasTrafficLine && !hasOutageOnlyChart) {
    return (
      <div style={{ fontSize: "0.82rem", color: "var(--muted)", padding: "0.5rem 0" }}>No data in this range.</div>
    );
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${height}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      aria-label={yLabel}
    >
      {yTicks.map((tk, i) => (
        <g key={i}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={tk.y}
            y2={tk.y}
            stroke="var(--surface2)"
            strokeWidth={1}
          />
          <text x={pad.l - 6} y={tk.y + 4} textAnchor="end" fill="var(--muted)" fontSize={9}>
            {tk.text}
          </text>
        </g>
      ))}
      {outageOverlay.bands.map((b) => (
        <rect
          key={b.key}
          x={b.x1}
          y={pad.t}
          width={Math.max(0, b.x2 - b.x1)}
          height={innerH}
          fill="rgba(239, 68, 68, 0.14)"
          pointerEvents="none"
        />
      ))}
      {pathD ? <path d={areaD} fill={CHART_FILL} stroke="none" /> : null}
      {pathD ? (
        <path d={pathD} fill="none" stroke={CHART_BLUE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ) : null}
      {outageOverlay.stars.map((s) => (
        <text
          key={s.key}
          x={s.x}
          y={pad.t + 16}
          textAnchor="middle"
          fill="#dc2626"
          fontSize={14}
          fontWeight={700}
          pointerEvents="none"
        >
          *
        </text>
      ))}
      {xLabels.map((xl, i) => (
        <text key={i} x={xl.x} y={height - 6} textAnchor="middle" fill="var(--muted)" fontSize={9}>
          {xl.text}
        </text>
      ))}
      <text x={pad.l} y={14} fill="var(--muted)" fontSize={9}>
        {yLabel}
      </text>
    </svg>
  );
}

/** Non-linear tick positions similar to Meraki (0, 1, 5, 25, 100) for loss % */
function lossDisplayY(loss: number, innerH: number, padT: number): number {
  const x = Math.min(100, Math.max(0, loss));
  let f: number;
  if (x <= 1) {
    f = x / 1 * 0.25;
  } else if (x <= 5) {
    f = 0.25 + ((x - 1) / 4) * 0.25;
  } else if (x <= 25) {
    f = 0.5 + ((x - 5) / 20) * 0.25;
  } else {
    f = 0.75 + ((x - 25) / 75) * 0.25;
  }
  return padT + innerH - f * innerH;
}

function LossChart({ points, height = 132 }: { points: { t: string; v: number }[]; height?: number }) {
  const w = 460;
  const pad = { l: 44, r: 10, t: 10, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const { pathD, areaD, xLabels } = useMemo(() => {
    if (points.length === 0) {
      return { pathD: "", areaD: "", xLabels: [] as { x: number; text: string }[] };
    }
    const t0 = Date.parse(points[0].t);
    const t1 = Date.parse(points[points.length - 1].t);
    const span = Math.max(1, t1 - t0);
    const xOf = (t: string) => pad.l + ((Date.parse(t) - t0) / span) * innerW;

    const parts: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const x = xOf(points[i].t);
      const y = lossDisplayY(points[i].v, innerH, pad.t);
      parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const pathD = parts.join("");
    const firstX = xOf(points[0].t);
    const lastX = xOf(points[points.length - 1].t);
    const baseY = pad.t + innerH;
    const areaD = `${pathD} L ${lastX.toFixed(1)} ${baseY} L ${firstX.toFixed(1)} ${baseY} Z`;

    const xLabels: { x: number; text: string }[] = [];
    const step = Math.max(1, Math.floor(points.length / 5));
    for (let i = 0; i < points.length; i += step) {
      const d = new Date(points[i].t);
      xLabels.push({
        x: xOf(points[i].t),
        text: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      });
    }
    return { pathD, areaD, xLabels };
  }, [points, innerW, innerH, pad.l, pad.t]);

  const yTickVals = [0, 1, 5, 25, 100];

  if (points.length === 0) {
    return (
      <div style={{ fontSize: "0.82rem", color: "var(--muted)", padding: "0.5rem 0" }}>No data in this range.</div>
    );
  }

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ display: "block", maxWidth: "100%" }} aria-label="Loss">
      {yTickVals.map((v) => {
        const y = lossDisplayY(v, innerH, pad.t);
        return (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--surface2)" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fill="var(--muted)" fontSize={9}>
              {v}%
            </text>
          </g>
        );
      })}
      <path d={areaD} fill={CHART_FILL} stroke="none" />
      <path d={pathD} fill="none" stroke={CHART_BLUE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {xLabels.map((xl, i) => (
        <text key={i} x={xl.x} y={height - 6} textAnchor="middle" fill="var(--muted)" fontSize={9}>
          {xl.text}
        </text>
      ))}
      <text x={pad.l} y={14} fill="var(--muted)" fontSize={9}>
        %
      </text>
    </svg>
  );
}

function uplinkLabel(u: string): string {
  switch (u.toLowerCase()) {
    case "wan1":
      return "WAN 1";
    case "wan2":
      return "WAN 2";
    case "wan3":
      return "WAN 3";
    case "wan4":
      return "WAN 4";
    case "cellular":
      return "Cellular";
    default:
      return u;
  }
}

export function UplinkHistorySidecar({
  open,
  onClose,
  siteId,
  locationName,
  applianceSerial,
  applianceModel,
  uplink,
  merakiStatus,
  teEnterpriseTests = [],
  onViewCircuitMapping,
}: {
  open: boolean;
  onClose: () => void;
  siteId: string;
  locationName: string;
  applianceSerial: string;
  applianceModel: string;
  uplink: string;
  merakiStatus: string | null;
  /** HTTP + agent-to-server + agent-to-agent tests from the location TE snapshot (same scope as dashboard test tables). */
  teEnterpriseTests?: TETestRow[];
  /** Opens circuit mapping sidecar (WAN / cellular) when provided. */
  onViewCircuitMapping?: () => void;
}) {
  useEscapeClose(open, onClose);
  const ipListId = useId();
  const [targetIp, setTargetIp] = useState("8.8.8.8");
  const [latencyLossKey, setLatencyLossKey] = useState<string>("meraki");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<UplinkHistoryPayload | null>(null);
  const [teLoading, setTeLoading] = useState(false);
  const [teErr, setTeErr] = useState<string | null>(null);
  const [teMetrics, setTeMetrics] = useState<TeEnterpriseMetricsPayload | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLatencyLossKey("meraki");
    setTeMetrics(null);
    setTeErr(null);
  }, [open, siteId, applianceSerial, uplink]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErr(null);
    setLoading(true);
    setData(null);
    const ip = targetIp.trim() || "8.8.8.8";
    const qs = new URLSearchParams({
      serial: applianceSerial,
      uplink: uplink.toLowerCase(),
      ip,
      timespan: String(UPLINK_HISTORY_TIMESPAN_SEC),
      resolution: "300",
    });
    void api<UplinkHistoryPayload>(`/api/dashboard/sites/${encodeURIComponent(siteId)}/uplink-history?${qs}`)
      .then((r) => {
        setData(r);
        setErr(null);
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "Request failed");
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, siteId, applianceSerial, uplink, targetIp]);

  useEffect(() => {
    if (!open || latencyLossKey === "meraki") {
      setTeLoading(false);
      setTeErr(null);
      setTeMetrics(null);
      return;
    }
    let cancelled = false;
    setTeLoading(true);
    setTeErr(null);
    setTeMetrics(null);
    const qs = new URLSearchParams({
      testId: latencyLossKey,
      timespan: String(UPLINK_HISTORY_TIMESPAN_SEC),
    });
    void api<TeEnterpriseMetricsPayload>(
      `/api/dashboard/sites/${encodeURIComponent(siteId)}/thousandeyes-enterprise-test-metrics?${qs}`,
    )
      .then((r) => {
        if (!cancelled) {
          setTeMetrics(r);
          setTeErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setTeErr(e instanceof Error ? e.message : "Request failed");
          setTeMetrics(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, siteId, latencyLossKey]);

  const trafficPts = useMemo(() => {
    if (!data) {
      return [];
    }
    const raw = validPoints(data.trafficMbps);
    if (raw.length > 0) {
      return raw;
    }
    const g = validPoints(
      data.goodputKbps.map((p) => ({ t: p.t, v: p.v != null ? p.v / 1000 : null })),
    );
    return g;
  }, [data]);

  /** Aligns outage markers with the traffic series time axis; when there is no traffic, uses the same window as the API. */
  const trafficChartDomain = useMemo(() => {
    if (!data) {
      return undefined;
    }
    if (trafficPts.length > 0) {
      return { t0: Date.parse(trafficPts[0].t), t1: Date.parse(trafficPts[trafficPts.length - 1].t) };
    }
    const end = Date.now();
    return { t0: end - data.timespanSeconds * 1000, t1: end };
  }, [data, trafficPts]);

  const useTeLatencyLoss = latencyLossKey !== "meraki";
  const latencyPts = useMemo(() => {
    if (useTeLatencyLoss && teMetrics) {
      return validPoints(teMetrics.latencyMs);
    }
    return validPoints(data?.latencyMs ?? []);
  }, [useTeLatencyLoss, teMetrics, data]);
  const lossPts = useMemo(() => {
    if (useTeLatencyLoss && teMetrics) {
      return validPoints(teMetrics.lossPercent);
    }
    return validPoints(data?.lossPercent ?? []);
  }, [useTeLatencyLoss, teMetrics, data]);

  const teSelectionLabel =
    useTeLatencyLoss && teMetrics ? `${teMetrics.testName} (${teMetrics.testType})` : "ThousandEyes";

  const subtitle = `${locationName} · ${applianceModel} (${applianceSerial}) · ${uplinkLabel(uplink)} · Meraki: ${merakiStatus ?? "—"}`;

  if (!open) {
    return null;
  }

  return (
    <SidecarFrame onClose={onClose} title="Historical uplink data" subtitle={subtitle}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {onViewCircuitMapping ? (
            <button type="button" className="btn secondary" style={{ alignSelf: "flex-start" }} onClick={onViewCircuitMapping}>
              Circuit Information
            </button>
          ) : null}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.65rem",
              fontSize: "0.82rem",
            }}
          >
            <span style={{ fontWeight: 700 }}>Last 12 hours</span>
            {data ?
              <span style={{ color: "var(--muted)" }}>
                (usage {(data.resolutionSecondsUsage ?? 300) / 60}‑min · loss/latency{" "}
                {(data.resolutionSecondsLoss ?? 600) / 60}‑min buckets — Meraki allows different steps per API)
              </span>
            : null}
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", marginLeft: "auto", flexWrap: "wrap" }}>
              <span style={{ color: "var(--muted)" }}>Connectivity to</span>
              <input
                className="input"
                list={ipListId}
                style={{ maxWidth: 200, padding: "0.25rem 0.4rem", fontSize: "0.8rem" }}
                value={targetIp}
                onChange={(e) => setTargetIp(e.target.value.trim())}
                placeholder="8.8.8.8"
                aria-label="Connectivity test IP"
                disabled={useTeLatencyLoss}
                title={useTeLatencyLoss ? "Meraki connectivity target applies only when Meraki is selected for latency / loss." : undefined}
              />
              <datalist id={ipListId}>
                <option value="8.8.8.8" />
                <option value="1.1.1.1" />
                <option value="208.67.222.222" />
              </datalist>
            </label>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: "min(100%, 22rem)" }}>
              <span style={{ fontWeight: 700, color: "var(--muted)", fontSize: "0.72rem" }}>Latency & loss source</span>
              <select
                className="input"
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.45rem" }}
                value={latencyLossKey}
                onChange={(e) => setLatencyLossKey(e.target.value)}
                aria-label="Latency and loss data source"
              >
                <option value="meraki">Meraki (WAN connectivity test)</option>
                {teEnterpriseTests.map((t) => (
                  <option key={t.testId} value={t.testId}>
                    ThousandEyes: {t.testName || t.testId} ({t.type})
                  </option>
                ))}
              </select>
            </label>
            {teEnterpriseTests.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: "0.72rem", lineHeight: 1.4, maxWidth: "28rem" }}>
                No enterprise tests in the latest TE snapshot for this view. Run ThousandEyes ingest, or widen the agent
                scope above the test tables.
              </span>
            ) : null}
          </div>

          {loading ? <p style={{ margin: 0, color: "var(--muted)" }}>Loading Meraki telemetry…</p> : null}
          {useTeLatencyLoss && teLoading ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>Loading ThousandEyes test metrics…</p>
          ) : null}
          {err ? <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.88rem" }}>{err}</p> : null}
          {teErr ? <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.88rem" }}>{teErr}</p> : null}

          {data?.errors?.usage ? (
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--warn)" }}>
              Usage history: {data.errors.usage}
            </p>
          ) : null}
          {!useTeLatencyLoss && data?.errors?.lossLatency ? (
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--warn)" }}>
              Loss / latency: {data.errors.lossLatency}
            </p>
          ) : null}

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Uplink traffic</h3>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                <span style={{ display: "inline-block", width: 10, height: 10, background: CHART_BLUE, marginRight: 6, verticalAlign: "middle" }} />
                Total (Mb/s)
                {data?.outageEvents?.length ?
                  <>
                    {" "}
                    · <span style={{ color: "#dc2626", fontWeight: 700 }}>*</span> circuit outage
                  </>
                : null}
              </span>
            </div>
            <AreaLineChart
              points={trafficPts}
              yLabel="Mb/s"
              formatY={(n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1))}
              outageEvents={data?.outageEvents}
              domainOverride={trafficPts.length === 0 ? trafficChartDomain : undefined}
            />
            {data?.outageEvents && data.outageEvents.length > 0 ?
              <ul
                style={{
                  margin: "0.35rem 0 0",
                  paddingLeft: "1.1rem",
                  fontSize: "0.72rem",
                  color: "var(--muted)",
                  lineHeight: 1.45,
                }}
              >
                {data.outageEvents.map((ev) => {
                  const startMs = Date.parse(ev.startedAt);
                  const endMs = ev.endedAt ? Date.parse(ev.endedAt) : null;
                  const nowMs = Date.now();
                  const dur = formatOutageDurationMs(startMs, endMs, nowMs);
                  return (
                    <li key={ev.id} style={{ marginBottom: 4 }}>
                      <span style={{ color: "#dc2626", fontWeight: 700 }}>*</span>{" "}
                      <strong style={{ color: "var(--text)" }}>{ev.providerName}</strong> ({ev.carrierCircuitId}):{" "}
                      {formatOutageTimeRange(ev.startedAt, ev.endedAt)} · {dur}
                    </li>
                  );
                })}
              </ul>
            : null}
            {trafficPts.length === 0 && data && !data.errors?.usage ? (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
                No byte counters for this uplink in the window. If loss/latency loaded, goodput (Mb/s) from Meraki may
                appear when usage history is empty.
              </p>
            ) : null}
          </section>

          <section>
            <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem" }}>
              Latency
              {useTeLatencyLoss ? (
                <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: "0.78rem" }}> · {teSelectionLabel}</span>
              ) : null}
            </h3>
            <AreaLineChart points={latencyPts} yLabel="ms" formatY={(n) => n.toFixed(1)} />
          </section>

          <section>
            <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem" }}>
              Loss
              {useTeLatencyLoss ? (
                <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: "0.78rem" }}> · {teSelectionLabel}</span>
              ) : null}
            </h3>
            <LossChart points={lossPts} />
          </section>

          <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
            {useTeLatencyLoss && teMetrics ? (
              <>
                Latency / loss source: ThousandEyes test <strong>{teMetrics.testName}</strong> (
                <code>{teMetrics.testType}</code>, id {teMetrics.testId}) via{" "}
                <code>{`GET /v7/test-results/<testId>/${teMetrics.teResource}`}</code> (window {teMetrics.teWindow}, aligned to the
                same {Math.round(teMetrics.timespanSeconds / 3600)} h span as Meraki). Metrics aggregate rounds across
                agents when multiple enterprise agents run the same test.
              </>
            ) : (
              <>
                Latency / loss source: Meraki <code>GET /devices/…/lossAndLatencyHistory</code> for this WAN using the
                connectivity-test destination IP. Requires <strong>dashboard:general:telemetry:read</strong>. Traffic
                above uses <code>GET /networks/…/appliance/uplinks/usageHistory</code> (
                <strong>sdwan:telemetry:read</strong>).
              </>
            )}
          </p>
        </div>
      </SidecarFrame>
  );
}
