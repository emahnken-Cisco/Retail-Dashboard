import type { ReactNode } from "react";

/**
 * Inline SVG weather illustrations keyed to OpenWeather icon codes (01d, 10n, …).
 * Replaces flat OWM PNGs (e.g. 01d looks like a plain disc on dark UIs).
 */

const SUN = "#fbbf24";
const SUN_RAY = "#f59e0b";
const MOON = "#cbd5e1";
const CLOUD = "#94a3b8";
const CLOUD_DARK = "#64748b";
const RAIN = "#38bdf8";
const SNOW = "#f1f5f9";
const BOLT = "#fcd34d";
const FOG = "#94a3b8";

const RAY_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function SunCore() {
  return (
    <>
      {RAY_DEG.map((deg) => {
        const s = Math.sin(rad(deg));
        const c = Math.cos(rad(deg));
        return (
          <line
            key={deg}
            x1={32 + s * 15}
            y1={32 - c * 15}
            x2={32 + s * 25}
            y2={32 - c * 25}
            stroke={SUN_RAY}
            strokeWidth={3.2}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={32} cy={32} r={12} fill={SUN} stroke={SUN_RAY} strokeWidth={1.5} />
    </>
  );
}

function MoonShape() {
  return (
    <path
      d="M 36 14 C 22 14 12 26 12 40 c 0 12 8 22 20 24 C 26 58 18 48 18 36 c 0-10 8-18 18-22 z"
      fill={MOON}
      opacity={0.95}
    />
  );
}

function CloudPuffy({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  const t = `translate(${x} ${y}) scale(${scale})`;
  return (
    <g transform={t}>
      <path
        d="M 18 44 Q 10 36 16 28 Q 14 18 26 20 Q 30 12 42 14 Q 52 12 56 22 Q 64 24 62 34 Q 64 42 54 46 H 22 Q 16 46 18 44 Z"
        fill={CLOUD}
        stroke={CLOUD_DARK}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </g>
  );
}

function RainLines({ count = 5 }: { count?: number }) {
  const xs = [24, 32, 40, 28, 36].slice(0, count);
  return (
    <g stroke={RAIN} strokeWidth={2.5} strokeLinecap="round" opacity={0.9}>
      {xs.map((x, i) => (
        <line key={i} x1={x} y1={50} x2={x - 3} y2={62} />
      ))}
    </g>
  );
}

function SnowDots() {
  return (
    <g fill={SNOW}>
      <circle cx={26} cy={54} r={2.2} />
      <circle cx={34} cy={58} r={2} />
      <circle cx={42} cy={52} r={2.2} />
      <circle cx={30} cy={50} r={1.8} />
      <circle cx={38} cy={56} r={1.8} />
    </g>
  );
}

function LightningBolt() {
  return (
    <path
      d="M 34 22 L 28 38 L 32 38 L 30 52 L 40 32 L 34 32 Z"
      fill={BOLT}
      stroke="#f59e0b"
      strokeWidth={0.8}
      strokeLinejoin="round"
    />
  );
}

function FogBands() {
  return (
    <g stroke={FOG} strokeWidth={3} strokeLinecap="round" opacity={0.75}>
      <line x1={14} y1={38} x2={50} y2={38} />
      <line x1={18} y1={46} x2={46} y2={46} />
      <line x1={12} y1={54} x2={52} y2={54} />
    </g>
  );
}

function SvgFrame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function Glyph01({ night }: { night: boolean }) {
  return (
    <SvgFrame>
      {night ? <MoonShape /> : <SunCore />}
    </SvgFrame>
  );
}

/** Few clouds — sun/moon with small cloud */
function Glyph02({ night }: { night: boolean }) {
  return (
    <SvgFrame>
      <g transform="translate(-4 -6) scale(0.72)">{night ? <MoonShape /> : <SunCore />}</g>
      <CloudPuffy x={22} y={18} scale={0.85} />
    </SvgFrame>
  );
}

/** Scattered */
function Glyph03({ night }: { night: boolean }) {
  return (
    <SvgFrame>
      {!night ? (
        <g transform="translate(10 -8) scale(0.45)">
          <SunCore />
        </g>
      ) : (
        <g transform="translate(14 -4) scale(0.5)">
          <MoonShape />
        </g>
      )}
      <CloudPuffy x={8} y={12} scale={1} />
    </SvgFrame>
  );
}

/** Broken / overcast */
function Glyph04() {
  return (
    <SvgFrame>
      <CloudPuffy x={4} y={8} scale={0.95} />
      <CloudPuffy x={18} y={20} scale={0.75} />
    </SvgFrame>
  );
}

function Glyph09({ night }: { night: boolean }) {
  return (
    <SvgFrame>
      {!night ? (
        <g transform="translate(8 -10) scale(0.4)">
          <SunCore />
        </g>
      ) : null}
      <CloudPuffy x={6} y={10} scale={0.95} />
      <RainLines count={5} />
    </SvgFrame>
  );
}

function Glyph10({ night }: { night: boolean }) {
  return (
    <SvgFrame>
      {!night ? (
        <g transform="translate(10 -8) scale(0.38)">
          <SunCore />
        </g>
      ) : (
        <g transform="translate(12 -2) scale(0.42)">
          <MoonShape />
        </g>
      )}
      <CloudPuffy x={8} y={14} scale={0.92} />
      <RainLines count={5} />
    </SvgFrame>
  );
}

function Glyph11() {
  return (
    <SvgFrame>
      <CloudPuffy x={6} y={8} scale={0.95} />
      <LightningBolt />
      <RainLines count={4} />
    </SvgFrame>
  );
}

function Glyph13() {
  return (
    <SvgFrame>
      <CloudPuffy x={6} y={6} scale={0.95} />
      <SnowDots />
    </SvgFrame>
  );
}

function Glyph50() {
  return (
    <SvgFrame>
      <CloudPuffy x={8} y={4} scale={0.7} />
      <FogBands />
    </SvgFrame>
  );
}

function parseOwmIcon(iconCode: string | null): { id: string; night: boolean } | null {
  if (!iconCode) {
    return null;
  }
  const c = iconCode.trim().toLowerCase();
  if (!/^[0-9]{2}[dn]$/.test(c)) {
    return null;
  }
  return { id: c.slice(0, 2), night: c.endsWith("n") };
}

function inferIconIdFromMain(main: string): string {
  const m = main.trim().toLowerCase();
  if (m.includes("thunder")) {
    return "11";
  }
  if (m === "drizzle") {
    return "09";
  }
  if (m === "rain") {
    return "10";
  }
  if (m.includes("snow")) {
    return "13";
  }
  if (["mist", "fog", "haze", "smoke", "dust", "sand", "ash"].includes(m)) {
    return "50";
  }
  if (m === "clear") {
    return "01";
  }
  if (m.includes("cloud")) {
    return "04";
  }
  return "02";
}

function resolve(iconCode: string | null, conditionMain: string): { id: string; night: boolean } {
  const p = parseOwmIcon(iconCode);
  if (p) {
    return p;
  }
  return { id: inferIconIdFromMain(conditionMain), night: false };
}

export function WeatherGlyph({
  iconCode,
  conditionMain,
  size = 56,
  title,
}: {
  iconCode: string | null;
  conditionMain: string;
  size?: number;
  title?: string;
}) {
  const { id, night } = resolve(iconCode, conditionMain);

  let inner: ReactNode;
  switch (id) {
    case "01":
      inner = <Glyph01 night={night} />;
      break;
    case "02":
      inner = <Glyph02 night={night} />;
      break;
    case "03":
      inner = <Glyph03 night={night} />;
      break;
    case "04":
      inner = <Glyph04 />;
      break;
    case "09":
      inner = <Glyph09 night={night} />;
      break;
    case "10":
      inner = <Glyph10 night={night} />;
      break;
    case "11":
      inner = <Glyph11 />;
      break;
    case "13":
      inner = <Glyph13 />;
      break;
    case "50":
      inner = <Glyph50 />;
      break;
    default:
      inner = <Glyph02 night={night} />;
  }

  return (
    <span
      title={title}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        lineHeight: 0,
      }}
    >
      {inner}
    </span>
  );
}
