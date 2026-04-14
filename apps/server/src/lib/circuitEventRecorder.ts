import { prisma } from "./prisma.js";
import type { Prisma } from "@prisma/client";
import { findUplinkPublicIp, parseWanAppliances } from "./circuitOutageRecorder.js";

/** Stored in CircuitEvent.kind */
export const CIRCUIT_EVENT_KIND_PUBLIC_IP_CHANGE = "public_ip_change";

const RELATED_OUTAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function normalizePublicIp(v: string | null | undefined): string | null {
  if (v == null) {
    return null;
  }
  const t = String(v).trim();
  return t === "" ? null : t;
}

/**
 * After a new Meraki snapshot, compare WAN public IP per circuit to the prior snapshot.
 * Records CircuitEvent rows when the mapped uplink's public IP changes (carrier reassignment, etc.).
 * If a recent outage ended before this reading, links it and notes correlation.
 */
export async function recordCircuitEventsAfterSnapshot(
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
    const prevIp = normalizePublicIp(
      findUplinkPublicIp(prevAppliances, c.merakiApplianceSerial, c.merakiInterface),
    );
    const curIp = normalizePublicIp(
      findUplinkPublicIp(currentAppliances, c.merakiApplianceSerial, c.merakiInterface),
    );

    if (prevIp === curIp) {
      continue;
    }
    if (prevIp == null && curIp == null) {
      continue;
    }

    let relatedOutageEventId: string | null = null;
    let note: string | null = null;

    const recentEnded = await prisma.circuitOutageEvent.findFirst({
      where: {
        circuitId: c.id,
        endedAt: { not: null, lte: capturedAt },
      },
      orderBy: { endedAt: "desc" },
    });
    if (recentEnded?.endedAt) {
      const delta = capturedAt.getTime() - recentEnded.endedAt.getTime();
      if (delta >= 0 && delta <= RELATED_OUTAGE_MAX_AGE_MS) {
        relatedOutageEventId = recentEnded.id;
        note =
          "Public IP change observed after a recent outage recovery; carrier may have reassigned addressing.";
      }
    }

    await prisma.circuitEvent.create({
      data: {
        circuitId: c.id,
        detectedAt: capturedAt,
        kind: CIRCUIT_EVENT_KIND_PUBLIC_IP_CHANGE,
        previousValue: prevIp,
        newValue: curIp,
        relatedOutageEventId,
        note,
        source: "meraki_ingest",
      },
    });
  }
}
