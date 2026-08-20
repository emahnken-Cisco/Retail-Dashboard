import { prisma } from "../lib/prisma.js";
import { getAdminSettings } from "../lib/settings.js";

export type RetentionPurgeResult = {
  /** @deprecated use deletedSnapshots — kept for older admin UI callers */
  deleted: number;
  deletedSnapshots: number;
  deletedOutageEvents: number;
  deletedCircuitEvents: number;
};

export async function runRetentionPurge(): Promise<RetentionPurgeResult> {
  const settings = await getAdminSettings();
  const snapshotDays = Math.max(1, settings.retentionDays);
  const circuitEventDays = Math.max(1, settings.circuitEventRetentionDays ?? 1095);

  const snapshotCutoff = new Date(Date.now() - snapshotDays * 24 * 60 * 60 * 1000);
  const circuitEventCutoff = new Date(Date.now() - circuitEventDays * 24 * 60 * 60 * 1000);

  const [snapshots, outages, circuitEvents] = await Promise.all([
    prisma.metricSnapshot.deleteMany({
      where: { capturedAt: { lt: snapshotCutoff } },
    }),
    prisma.circuitOutageEvent.deleteMany({
      where: { startedAt: { lt: circuitEventCutoff } },
    }),
    prisma.circuitEvent.deleteMany({
      where: { detectedAt: { lt: circuitEventCutoff } },
    }),
  ]);

  return {
    deleted: snapshots.count,
    deletedSnapshots: snapshots.count,
    deletedOutageEvents: outages.count,
    deletedCircuitEvents: circuitEvents.count,
  };
}
