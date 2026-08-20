/** Maximum reporting window for circuit outages and circuit events (3 calendar years). */
export const REPORT_MAX_DAYS = 1095;

/** Recent outage rows shown in the Reporting UI table (totals use full-window DB aggregates). */
export const RECENT_OUTAGE_EVENTS_LIST_LIMIT = 100;

/** Circuit events table cap (totals use count queries). */
export const RECENT_CIRCUIT_EVENTS_LIST_LIMIT = 500;

export function parseReportDaysParam(raw: string | undefined, fallback = 30): number {
  const n = Number.parseInt(raw ?? String(fallback), 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(REPORT_MAX_DAYS, Math.max(1, n));
}
