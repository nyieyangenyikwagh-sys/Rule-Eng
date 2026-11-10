import type { Period } from "./plans/schema.js";
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return (
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000
  );
}
export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function edmontonDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function windowStart(
  date: string,
  period: Period,
  loss?: string,
  rollingDays?: number,
): string {
  if (period === "calendar_year") return `${date.slice(0, 4)}-01-01`;
  if (period === "per_accident") return loss ?? date;
  return period === "rolling_12m"
    ? addDays(addMonths(date, -12), 1)
    : addDays(date, 1 - (rollingDays ?? 365));
}
