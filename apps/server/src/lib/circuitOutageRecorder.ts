import { prisma } from "./prisma.js";
import type { Prisma } from "@prisma/client";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Meraki uplink statuses we treat as usable (path up or transitioning). */
export function merakiUplinkHealthy(status: string | null | undefined): boolean {
  if (status == null || String(status).trim() === "") {
    return false;
  }
  const s = String(status).toLowerCase().trim();
  return s === "active" || s === "ready" || s === "connecting";
}

type ApplianceRow = {
  serial: string;
  uplinks: Array<{ interface: string; status: string | null; publicIp: string | null }>;
};

function parseWanAppliances(payload: unknown): ApplianceRow[] {
  if (!isRecord(payload)) {
    return [];
  }
  const wan = payload.wan;
  if (!isRecord(wan)) {
    return [];
  }
  const raw = wan.appliances;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ApplianceRow[] = [];
  for (const a of raw) {
    if (!isRecord(a)) {
      continue;
    }
    const serial = String(a.serial ?? "");
    const uplinksRaw = a.uplinks;
    const uplinks: ApplianceRow["uplinks"] = [];
    if (Array.isArray(uplinksRaw)) {
      for (const u of uplinksRaw) {
        if (!isRecord(u)) {
          continue;
        }
        uplinks.push({
          interface: String(u.interface ?? ""),
          status: u.status != null ? String(u.status) : null,
          publicIp: u.publicIp != null && String(u.publicIp).trim() !== "" ? String(u.publicIp).trim() : null,
        });
      }
    }
    if (serial) {
      out.push({ serial, uplinks });
    }
  }
  return out;
}

function findUplinkStatus(
  appliances: ApplianceRow[],
  applianceSerial: string | null | undefined,
  ifaceRaw: string,
): string | null {
  const iface = ifaceRaw.trim().toLowerCase();
  const list =
    applianceSerial?.trim() ?
      appliances.filter((a) => a.serial === applianceSerial.trim())
    : appliances;
  const target = list.length > 0 ? list : appliances;
  for (const a of target) {
    const u = a.uplinks.find((x) => String(x.interface).toLowerCase() === iface);
    if (u) {
      return u.status;
    }
  }
  return null;
}

/** WAN public IP for the mapped uplink (Meraki snapshot), if present. */
export function findUplinkPublicIp(
  appliances: ApplianceRow[],
  applianceSerial: string | null | undefined,
  ifaceRaw: string,
): string | null {
  const iface = ifaceRaw.trim().toLowerCase();
  const list =
    applianceSerial?.trim() ?
      appliances.filter((a) => a.serial === applianceSerial.trim())
    : appliances;
  const target = list.length > 0 ? list : appliances;
  for (const a of target) {
    const u = a.uplinks.find((x) => String(x.interface).toLowerCase() === iface);
    if (u) {
      return u.publicIp;
    }
  }
  return null;
}

export { parseWanAppliances };

/**
 * After a new Meraki snapshot row is written, compare to the prior snapshot and record circuit outage open/close rows.
 */
export async function recordCircuitOutagesAfterSnapshot(
  siteId: string,
  newPayload: Prisma.JsonValue,
  capturedAt: Date,
): Promise<void> {
  const circuits = await prisma.circuit.findMany({ where: { siteId } });
  if (circuits.length === 0) {
    return;
  }

  const snaps = await prisma.metricSnapshot.findMany({
    where: { siteId, source: "meraki" },
    orderBy: { capturedAt: "desc" },
    take: 2,
    select: { payload: true, capturedAt: true },
  });
  if (snaps.length < 2) {
    return;
  }

  const currentAppliances = parseWanAppliances(newPayload);
  const prevAppliances = parseWanAppliances(snaps[1].payload);

  for (const c of circuits) {
    const curStatus = findUplinkStatus(currentAppliances, c.merakiApplianceSerial, c.merakiInterface);
    const prevStatus = findUplinkStatus(prevAppliances, c.merakiApplianceSerial, c.merakiInterface);

    const curOk = merakiUplinkHealthy(curStatus);
    const prevOk = merakiUplinkHealthy(prevStatus);

    if (prevOk && !curOk) {
      const statusLabel = curStatus?.trim() || "unknown";
      await prisma.circuitOutageEvent.create({
        data: {
          circuitId: c.id,
          startedAt: capturedAt,
          statusObserved: statusLabel,
          source: "meraki_ingest",
        },
      });
    } else if (!prevOk && curOk) {
      const open = await prisma.circuitOutageEvent.findFirst({
        where: { circuitId: c.id, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
      if (open) {
        await prisma.circuitOutageEvent.update({
          where: { id: open.id },
          data: {
            endedAt: capturedAt,
            clearedToStatus: curStatus?.trim() ?? null,
          },
        });
      }
    }
  }
}
