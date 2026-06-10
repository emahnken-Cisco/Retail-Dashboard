/**
 * Semicircular SVG gauge used by the DHCP and Wireless health sidecars.
 * Render-only: parent decides label, value, max, and tone thresholds.
 *
 * Tones (mapped to CSS vars from `index.css`):
 *   - "ok"     = var(--ok)
 *   - "warn"   = var(--warn)
 *   - "danger" = var(--danger)
 *   - "muted"  = var(--muted)  (used when value is null / not available)
 */
import { useId } from "react";

export type GaugeTone = "ok" | "warn" | "danger" | "muted";

export type SemiGaugeProps = {
  /** Gauge fill value in the same units as `max`. Pass null when data is unavailable. */
  value: number | null;
  max: number;
  /** Display label rendered below the gauge — e.g. "Airtime", "Usage". */
  label: string;
  /** Big number rendered inside the gauge. Defaults to `value` formatted. */
  display?: string;
  /** Small suffix appended to `display` (e.g. "%", "clients"). */
  suffix?: string;
  /** Override tone; otherwise computed from `value/max` using ok/warn/danger thresholds at 60% / 80%. */
  tone?: GaugeTone;
  /** Pixel width of the SVG. Height is computed as width * 0.65 to give the dial enough breathing room. */
  size?: number;
};

const TONE_VAR: Record<GaugeTone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  muted: "var(--muted)",
};

/** Default thresholds used when `tone` is not provided: <60% ok, <80% warn, else danger. */
export function toneForFraction(fraction: number | null): GaugeTone {
  if (fraction == null || !Number.isFinite(fraction)) {
    return "muted";
  }
  if (fraction < 0.6) return "ok";
  if (fraction < 0.8) return "warn";
  return "danger";
}

export function SemiGauge({
  value,
  max,
  label,
  display,
  suffix,
  tone,
  size = 140,
}: SemiGaugeProps) {
  // Stable IDs are required so multiple gauges on the same page don't collide
  // on SVG defs (we'd otherwise mask gauges with each other's clip path).
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const gradId = `semi-grad-${safeId}`;

  const height = Math.round(size * 0.65);
  const cx = size / 2;
  const cy = size * 0.55;
  // Radius leaves margin for stroke + value text below the arc.
  const r = (size / 2) - 14;

  const fraction =
    value == null || !Number.isFinite(value) || max <= 0
      ? null
      : Math.max(0, Math.min(1, value / max));
  const resolvedTone = tone ?? toneForFraction(fraction);
  const color = TONE_VAR[resolvedTone];

  // 180° arc: from angle π (left) to 0 (right). Total length = π * r.
  const arcLen = Math.PI * r;
  const filledLen = fraction != null ? arcLen * fraction : 0;
  const remainingLen = arcLen - filledLen;

  // Path: start at (cx - r, cy), arc to (cx + r, cy).
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const formattedValue =
    display != null
      ? display
      : value == null || !Number.isFinite(value)
        ? "—"
        : Number.isInteger(value)
          ? String(value)
          : String(Math.round(value * 10) / 10);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg
        width={size}
        height={height}
        viewBox={`0 0 ${size} ${height}`}
        role="img"
        aria-label={`${label}: ${formattedValue}${suffix ?? ""}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity={0.7} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
        </defs>
        {/* Track. */}
        <path
          d={arcPath}
          fill="none"
          stroke="var(--surface2)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* Filled segment — when value is null, render nothing (track + muted color label only). */}
        {fraction != null ? (
          <path
            d={arcPath}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${filledLen} ${remainingLen}`}
          />
        ) : null}
        {/* Value text. */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize={size * 0.22}
          fontWeight={700}
          fill="var(--text)"
        >
          {formattedValue}
          {suffix ? (
            <tspan fontSize={size * 0.12} fill="var(--muted)" dx={2}>
              {suffix}
            </tspan>
          ) : null}
        </text>
      </svg>
      <span
        style={{
          fontSize: "0.72rem",
          color: "var(--muted)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function ToneDot({ tone, title }: { tone: GaugeTone; title?: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: TONE_VAR[tone],
        boxShadow: `0 0 0 2px var(--surface)`,
      }}
    />
  );
}
