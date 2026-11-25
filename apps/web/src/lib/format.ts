import { centimesToMad } from "@finance-ttijari/api/allocations/money";

// Display formatting for money, months and dates. Amounts are integer centimes.

const NBSP = " ";
const NARROW_NBSP = " ";
const MINUS = "−";

/** Centimes as "1 234,56 MAD": narrow no-break space for thousands, comma for decimals. */
export function formatMad(centimes: number, options: { currency?: boolean } = {}): string {
  const [whole = "0", fraction = "00"] = centimesToMad(Math.abs(centimes)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  const sign = centimes < 0 ? MINUS : "";
  const value = `${sign}${grouped},${fraction}`;
  return options.currency === false ? value : `${value}${NBSP}MAD`;
}

/** Like formatMad, with an explicit "+" on credits so the sign is always visible. */
export function formatSignedMad(centimes: number, options: { currency?: boolean } = {}): string {
  const value = formatMad(centimes, options);
  return centimes > 0 ? `+${value}` : value;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-03" -> "Mar 2026" (or "Mar" when `short`). */
export function formatMonth(month: string, short = false): string {
  const [year, mon] = month.split("-");
  const name = MONTH_NAMES[Number(mon) - 1] ?? mon;
  return short ? `${name}` : `${name} ${year}`;
}

/** "2026-03-14" -> "14 Mar 2026"; anything else is returned unchanged. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, mon, day] = match;
  return `${Number(day)} ${MONTH_NAMES[Number(mon) - 1] ?? mon} ${year}`;
}

/** "2026-03-14" -> "14 Mar". */
export function formatDayMonth(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[3])} ${MONTH_NAMES[Number(match[2]) - 1] ?? match[2]}`;
}

/** Statement period as "1 Mar 2026 to 31 Mar 2026". */
export function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "Period unknown";
  return `${formatDate(start) || "?"} to ${formatDate(end) || "?"}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
