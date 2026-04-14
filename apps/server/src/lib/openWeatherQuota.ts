import { prisma } from "./prisma.js";
import { getAdminSettings } from "./settings.js";

/** 1×1 transparent PNG returned when the daily OpenWeather quota is exceeded (map tiles still “load”). */
export const OPENWEATHER_QUOTA_EXCEEDED_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8zqQcAAAAASUVORK5CYII=",
  "base64",
);

function utcDayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export type OpenWeatherQuotaResult = {
  allowed: boolean;
  /** Calls recorded so far today after this operation (only meaningful if allowed). */
  usedAfter: number;
  limit: number;
  dayUtc: string;
};

/**
 * Atomically increments today's counter if below the configured admin limit.
 * Call once per outbound OpenWeather request (tile, probe, test).
 */
export async function tryConsumeOpenWeatherCall(): Promise<OpenWeatherQuotaResult> {
  const settings = await getAdminSettings();
  const limit = settings.openWeatherDailyLimit ?? 1000;
  const dayUtc = utcDayString();

  if (limit <= 0) {
    return { allowed: false, usedAfter: 0, limit: 0, dayUtc };
  }

  return prisma.$transaction(async (tx) => {
    await tx.openWeatherUsageDay.upsert({
      where: { dayUtc },
      create: { dayUtc, callCount: 0 },
      update: {},
    });

    const updated = await tx.openWeatherUsageDay.updateMany({
      where: { dayUtc, callCount: { lt: limit } },
      data: { callCount: { increment: 1 } },
    });

    const row = await tx.openWeatherUsageDay.findUnique({ where: { dayUtc } });
    const count = row?.callCount ?? 0;

    if (updated.count === 1) {
      return { allowed: true, usedAfter: count, limit, dayUtc };
    }

    return { allowed: false, usedAfter: count, limit, dayUtc };
  });
}

export async function getOpenWeatherQuotaSnapshot(): Promise<{
  dayUtc: string;
  callCount: number;
  limit: number;
}> {
  const settings = await getAdminSettings();
  const limit = settings.openWeatherDailyLimit ?? 1000;
  const dayUtc = utcDayString();
  const row = await prisma.openWeatherUsageDay.findUnique({ where: { dayUtc } });
  return {
    dayUtc,
    callCount: row?.callCount ?? 0,
    limit,
  };
}
