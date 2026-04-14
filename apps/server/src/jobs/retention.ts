import { prisma } from "../lib/prisma.js";
import { getAdminSettings } from "../lib/settings.js";

export async function runRetentionPurge(): Promise<{ deleted: number }> {
  const settings = await getAdminSettings();
  const days = Math.max(1, settings.retentionDays);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await prisma.metricSnapshot.deleteMany({
    where: { capturedAt: { lt: cutoff } },
  });

  return { deleted: result.count };
}
