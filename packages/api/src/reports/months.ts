// Calendar month helpers. A month is `YYYY-MM`; dates are ISO `YYYY-MM-DD` text,
// so month bounds can be compared as strings in SQL (and use the booking_date index).

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** The `YYYY-MM` month of an ISO date, or null when the date is missing or malformed. */
export function monthOf(date: string | null | undefined): string | null {
  if (!date) return null;
  const month = date.slice(0, 7);
  return isMonth(month) ? month : null;
}

/** Adds `count` months (may be negative) to a `YYYY-MM` month. */
export function addMonths(month: string, count: number): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + count;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Every month from `from` to `to` inclusive, ascending. Empty when `from` is after `to`. */
export function listMonths(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

/**
 * Half-open date bounds `[start, end)` covering the months `from` to `to` inclusive,
 * e.g. ("2026-01", "2026-02") -> { start: "2026-01-01", end: "2026-03-01" }.
 */
export function monthBounds(from: string, to: string): { start: string; end: string } {
  return { start: `${from}-01`, end: `${addMonths(to, 1)}-01` };
}
