import { normalizeDescription } from "../extraction/fingerprint";

/** Longest merchant name kept, in words. Long tails are usually city names or references. */
const MAX_MERCHANT_WORDS = 5;

/**
 * Operation prefixes printed by the bank before the counterparty, matched on the normalized
 * description (lower case, single spaces). Each maps to a canonical prefix kept in the
 * merchant name ("" drops it), so incoming and outgoing transfers stay separate merchants
 * and every ATM withdrawal collapses into one.
 * Order matters: longer forms first.
 */
const OPERATION_PREFIXES: readonly (readonly [RegExp, string])[] = [
  [/^(?:retrait|ret) (?:gab|dab|guichet)\b.*$/, "retrait gab"],
  [/^retrait\b.*$/, "retrait gab"],
  [
    /^(?:vir|virement) (?:web |mobile |instantane |inst )*(?:recu|en faveur)(?: de)?\b/,
    "virement recu",
  ],
  [
    /^(?:vir|virement) emis(?: web| mobile| instantane| inst)*(?: vers| a| au profit de)?\b/,
    "virement emis",
  ],
  [/^(?:vir|virement) (?:web |mobile )*(?:vers|a)\b/, "virement emis"],
  [/^(?:prlv|prelevement|prel)(?: sepa)?\b/, "prelevement"],
  [/^(?:paiement|paie|pmt|achat) (?:par )?(?:cb|carte|tpe|internet|en ligne)\b/, ""],
  [/^(?:paiement|achat|pmt)\b/, ""],
];

/** Words that carry no merchant identity wherever they appear. */
const NOISE_WORDS = new Set(["hb", "web", "cb", "tpe", "ref", "carte", "mobile"]);

/** Day-month(-year) groups left by normalizeDescription, for example "05 10 2026" or "13 10 26". */
const DATE_PATTERN = /\b\d{1,2} \d{1,2}(?: (?:\d{4}|\d{2}))?\b/g;

/** Time of day such as "14 32" is caught by DATE_PATTERN; "14h32" by this one. */
const TIME_PATTERN = /\b\d{1,2}h\d{2}\b/g;

function isNoiseToken(token: string): boolean {
  if (NOISE_WORDS.has(token)) return true;
  // Card numbers, references, ATM and terminal ids: any token made only of digits.
  if (/^\d+$/.test(token)) return true;
  // Masked card numbers ("xxxx", "4567xxxxxx1234") and alphanumeric references
  // carrying at least four digits ("ref123456", "gab0123").
  if (/^[\dx*]+$/.test(token) && /x|\*/.test(token)) return true;
  if ((token.match(/\d/g) ?? []).length >= 4) return true;
  return false;
}

/**
 * Maps a transaction description to a stable merchant name: card numbers, dates, times,
 * references and ATM ids are stripped, the bank's operation prefix is replaced by a canonical
 * one, and the result is capped at a few words. Accepts a raw or already normalized
 * description. Returns null when nothing identifying is left.
 */
export function merchantName(description: string): string | null {
  const normalized = normalizeDescription(description);
  if (!normalized) return null;

  let text = normalized.replace(TIME_PATTERN, " ").replace(DATE_PATTERN, " ");
  text = text.replace(/\s+/g, " ").trim();

  let prefix = "";
  for (const [pattern, canonical] of OPERATION_PREFIXES) {
    const match = pattern.exec(text);
    if (match) {
      prefix = canonical;
      text = text.slice(match[0].length).trim();
      break;
    }
  }

  // Every ATM withdrawal is the same merchant: drop the location and terminal id.
  if (prefix === "retrait gab") return prefix;

  const words = text
    .split(" ")
    .filter((token) => token.length > 0 && !isNoiseToken(token))
    .slice(0, MAX_MERCHANT_WORDS);

  // A lone "de" / "vers" left after a prefix is not a name.
  while (words.length > 0 && ["de", "vers", "a", "au", "du"].includes(words[0] ?? "")) {
    words.shift();
  }

  const name = [prefix, ...words].filter(Boolean).join(" ");
  return name || null;
}
