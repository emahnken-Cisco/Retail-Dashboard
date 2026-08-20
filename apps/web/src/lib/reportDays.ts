/** Must match server `REPORT_MAX_DAYS` in apps/server/src/lib/reportDays.ts */
export const REPORT_MAX_DAYS = 1095;

export const REPORT_DAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
  { value: 1095, label: "3 years" },
];
