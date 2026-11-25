/**
 * Converts a MAD amount to signed integer centimes.
 * Numbers are taken as decimal MAD. Strings may use French formatting: spaces or dots as
 * thousands separators, a comma as decimal separator, a trailing "MAD"/"DH", a leading
 * minus or trailing minus. Returns null when the value is not an amount.
 */
export function parseAmountToCentimes(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }

  let text = value
    .replace(/[\s  ]/g, "")
    .replace(/(MAD|DHS?|DH)$/i, "")
    .trim();
  let negative = false;
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = true;
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  // The last "," or "." followed by one or two digits is the decimal separator;
  // every other separator groups thousands.
  const decimal = /[.,](\d{1,2})$/.exec(text);
  let integerPart = text;
  let fraction = "";
  if (decimal) {
    integerPart = text.slice(0, decimal.index);
    fraction = decimal[1] ?? "";
  }
  integerPart = integerPart.replace(/[.,']/g, "");
  if (!/^\d+$/.test(integerPart) || !/^\d{0,2}$/.test(fraction)) {
    return null;
  }

  const centimes = Number(integerPart) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(centimes)) {
    return null;
  }
  return negative ? -centimes : centimes;
}

/** Formats centimes as a plain MAD decimal (for logs and review details). */
export function formatCentimes(centimes: number): string {
  const sign = centimes < 0 ? "-" : "";
  const abs = Math.abs(centimes);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
