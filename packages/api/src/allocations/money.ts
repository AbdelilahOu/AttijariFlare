// Conversions between user-facing MAD strings and integer centimes.

/**
 * Parses a MAD amount typed by the user ("100", "99.5", "1 234,56") into centimes.
 * Returns null for empty, negative, or malformed input, or more than 2 decimals.
 */
export function parseMadToCentimes(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/[\s\u00a0]/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const centimes = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(centimes) ? centimes : null;
}

/** Formats centimes as a plain MAD decimal string, e.g. 10050 -> "100.50", -300 -> "-3.00". */
export function centimesToMad(centimes: number): string {
  const sign = centimes < 0 ? "-" : "";
  const abs = Math.abs(centimes);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}
