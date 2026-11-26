import { transactionTypes } from "@attijari-flare/db/schema/enums";
import { z } from "zod";

export const listTransactionsSchema = z
  .object({
    /** Booking month, `YYYY-MM`. */
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    /** A category id, or "none" for uncategorized rows. */
    categoryId: z.string().min(1).optional(),
    statementId: z.string().min(1).optional(),
    type: z.enum(transactionTypes).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .default({ page: 1, pageSize: 50 });

export const setTransactionCategorySchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
  applyToMerchant: z.boolean().default(false),
});
