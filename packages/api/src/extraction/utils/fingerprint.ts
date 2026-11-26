import type { ExtractedTransaction } from "../schema";

/**
 * Normalizes a transaction label for comparison: Unicode compatibility form, Latin accents
 * and Arabic diacritics removed, lower case, punctuation collapsed to single spaces.
 * Arabic and Latin letters and digits are kept, so French and Arabic labels both survive.
 */
export function normalizeDescription(description: string): string {
  return description
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "") // Arabic tatweel
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes one fingerprint per row, in order.
 *
 * The key is user + booking date + amount + normalized description + balance after, so
 * re-running a statement and overlapping statements yield the same fingerprints. Two
 * genuinely identical rows in one statement (for example two equal ATM withdrawals on the
 * same day, without a printed balance) would share that key, so an occurrence counter (the
 * nth identical row within the statement) is appended to keep both.
 */
export async function fingerprintTransactions(
  userId: string,
  rows: Pick<ExtractedTransaction, "booking_date" | "amount" | "description" | "balance_after">[],
): Promise<string[]> {
  const seen = new Map<string, number>();
  const keys = rows.map((row) => {
    const base = [
      userId,
      row.booking_date,
      String(row.amount),
      normalizeDescription(row.description),
      row.balance_after === null ? "" : String(row.balance_after),
    ].join("|");
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}|${occurrence}`;
  });
  return Promise.all(keys.map((key) => sha256Hex(key)));
}
