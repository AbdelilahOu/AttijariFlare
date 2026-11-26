import { transactionTypes } from "@attijari-flare/db/schema/enums";
import { z } from "zod";

import { parseAmountToCentimes } from "./utils/money";

/**
 * Normalizes a date the model returned to ISO `YYYY-MM-DD`. The prompt asks for ISO, but
 * day-first forms (31/10/2026, 31-10-26, 31.10.2026) are accepted so a near miss does not
 * cost a retry. Returns null when the value is not a real calendar date.
 */
export function normalizeDate(value: string): string | null {
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dayFirst) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    const rawYear = dayFirst[3] ?? "";
    year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const isoDate = z.string().transform((value, ctx) => {
  const normalized = normalizeDate(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: `not a date: ${value}` });
    return z.NEVER;
  }
  return normalized;
});

/** Money as the model returns it (MAD, decimal), converted to signed integer centimes. */
const money = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const centimes = parseAmountToCentimes(value);
  if (centimes === null) {
    ctx.addIssue({ code: "custom", message: `not an amount: ${String(value)}` });
    return z.NEVER;
  }
  return centimes;
});

/** Unknown transaction types fall back to "other" instead of failing the whole chunk. */
const transactionType = z
  .string()
  .nullish()
  .transform((value) => {
    const candidate = (value ?? "").trim().toLowerCase();
    return (transactionTypes as readonly string[]).includes(candidate)
      ? (candidate as (typeof transactionTypes)[number])
      : "other";
  });

export const extractedTransactionSchema = z.object({
  booking_date: isoDate,
  value_date: isoDate.nullish().transform((value) => value ?? null),
  description: z.string().trim().min(1),
  amount: money,
  balance_after: money.nullish().transform((value) => value ?? null),
  type: transactionType,
});

/** What the model returns for one chunk of the statement, validated and in centimes. */
export const chunkExtractionSchema = z.object({
  account_label: z
    .string()
    .nullish()
    .transform((value) => value?.trim() || null),
  period_start: isoDate.nullish().transform((value) => value ?? null),
  period_end: isoDate.nullish().transform((value) => value ?? null),
  opening_balance: money.nullish().transform((value) => value ?? null),
  closing_balance: money.nullish().transform((value) => value ?? null),
  transactions: z.array(extractedTransactionSchema),
});

export type ExtractedTransaction = z.output<typeof extractedTransactionSchema>;
export type ChunkExtraction = z.output<typeof chunkExtractionSchema>;

/**
 * JSON schema sent as `response_format.json_schema`. Written by hand (rather than derived
 * from zod) so it stays small and uses only the keywords Workers AI JSON mode handles.
 * Amounts are decimal MAD numbers here; zod converts them to centimes afterwards.
 */
export const chunkExtractionJsonSchema = {
  type: "object",
  properties: {
    account_label: { type: ["string", "null"] },
    period_start: { type: ["string", "null"], description: "YYYY-MM-DD" },
    period_end: { type: ["string", "null"], description: "YYYY-MM-DD" },
    opening_balance: { type: ["number", "null"] },
    closing_balance: { type: ["number", "null"] },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          booking_date: { type: "string", description: "YYYY-MM-DD" },
          value_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
          description: { type: "string" },
          amount: { type: "number", description: "Negative for debits, positive for credits" },
          balance_after: { type: ["number", "null"] },
          type: { type: "string", enum: [...transactionTypes] },
        },
        required: ["booking_date", "value_date", "description", "amount", "balance_after", "type"],
      },
    },
  },
  required: [
    "account_label",
    "period_start",
    "period_end",
    "opening_balance",
    "closing_balance",
    "transactions",
  ],
} as const;
