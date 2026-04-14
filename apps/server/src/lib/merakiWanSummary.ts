import type { MerakiApplianceUplinkStatusItem } from "./merakiClient.js";

export type MerakiWanApplianceSummary = {
  serial: string;
  model: string;
  lastReportedAt: string | null;
  highAvailability: { enabled: boolean; role: string } | null;
  uplinks: MerakiApplianceUplinkStatusItem["uplinks"];
  pathSummary: string;
  activeInterfaces: string[];
  wan1Status: string | null;
  wan2Status: string | null;
  cellularStatus: string | null;
};

function norm(s: string | undefined): string | null {
  if (s == null || s === "") {
    return null;
  }
  return s;
}

/**
 * Interprets Meraki uplink statuses: `active` = path in use, `ready` = standby link up, `failed`, `not connected`, `connecting`.
 */
export function summarizeApplianceWanPaths(device: MerakiApplianceUplinkStatusItem): MerakiWanApplianceSummary {
  const uplinks = device.uplinks ?? [];
  const byIface = (iface: string) => uplinks.find((u) => String(u.interface).toLowerCase() === iface);

  const wan1 = byIface("wan1");
  const wan2 = byIface("wan2");
  const cellular = byIface("cellular");

  const wan1Status = norm(wan1?.status) ?? null;
  const wan2Status = norm(wan2?.status) ?? null;
  const cellularStatus = norm(cellular?.status) ?? null;

  const activeInterfaces = uplinks
    .filter((u) => String(u.status).toLowerCase() === "active")
    .map((u) => String(u.interface));

  const w1 = wan1Status?.toLowerCase() ?? "";
  const w2 = wan2Status?.toLowerCase() ?? "";

  let pathSummary: string;

  if (activeInterfaces.includes("wan1") && !activeInterfaces.includes("wan2") && !activeInterfaces.includes("cellular")) {
    pathSummary = "WAN 1 is primary (active internet path).";
  } else if (activeInterfaces.includes("wan2") && !activeInterfaces.includes("wan1") && !activeInterfaces.includes("cellular")) {
    if (w1 === "failed" || w1 === "not connected") {
      pathSummary = "Failover: WAN 1 down; WAN 2 is active.";
    } else if (w1 === "ready") {
      pathSummary = "Traffic on WAN 2; WAN 1 is standby (ready) — may indicate failover or uplink preference.";
    } else {
      pathSummary = "WAN 2 is the active internet path (WAN 1 not active).";
    }
  } else if (activeInterfaces.includes("cellular") && !activeInterfaces.some((x) => x === "wan1" || x === "wan2")) {
    pathSummary = "Cellular is active; wired WAN interfaces are not carrying traffic.";
  } else if (activeInterfaces.includes("wan1") && activeInterfaces.includes("wan2")) {
    pathSummary = "Both WAN 1 and WAN 2 report active (unusual — may be dual-uplink or transitional state).";
  } else if (activeInterfaces.length === 0) {
    pathSummary = "No uplink reported as active; check Meraki dashboard or device connectivity.";
  } else {
    pathSummary = `Active: ${activeInterfaces.join(", ")}.`;
  }

  const ha = device.highAvailability;
  const highAvailability =
    ha && (ha.enabled !== undefined || ha.role)
      ? { enabled: Boolean(ha.enabled), role: String(ha.role ?? "unknown") }
      : null;

  return {
    serial: device.serial,
    model: String(device.model ?? "—"),
    lastReportedAt: device.lastReportedAt ? String(device.lastReportedAt) : null,
    highAvailability,
    uplinks,
    pathSummary,
    activeInterfaces,
    wan1Status,
    wan2Status,
    cellularStatus,
  };
}
