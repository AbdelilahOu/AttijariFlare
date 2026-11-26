import { listTransactionMonths, listTransactions } from "@finance-ttijari/db/queries";
import { ORPCError } from "@orpc/server";

import { CorrectCategoryError, correctCategory } from "../categorization/correct";
import { normalizeDescription } from "../extraction/fingerprint";
import { protectedProcedure } from "../index";
import { listTransactionsSchema, setTransactionCategorySchema } from "../schemas/transactions";

function toORPCError(error: unknown): unknown {
  if (error instanceof CorrectCategoryError) {
    return new ORPCError(error.code, { message: error.message });
  }
  return error;
}

export const transactionsRouter = {
  /** Filtered, paginated transactions, newest first, with category, merchant and split info. */
  list: protectedProcedure.input(listTransactionsSchema).handler(async ({ context, input }) => {
    const { rows, total } = await listTransactions(context.db, {
      userId: context.session.user.id,
      month: input.month,
      categoryId: input.categoryId,
      statementId: input.statementId,
      type: input.type,
      search: input.search
        ? { raw: input.search, normalized: normalizeDescription(input.search) }
        : undefined,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      items: rows.map((row) => ({ ...row, allocationParts: Number(row.allocationParts) })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /** Booking months that have transactions, newest first (`YYYY-MM`). */
  months: protectedProcedure.handler(({ context }) =>
    listTransactionMonths(context.db, { userId: context.session.user.id }),
  ),

  /**
   * User correction: sets the row's category with source `user`, makes it the merchant's
   * default (so the next occurrence of the merchant gets it) and marks the merchant's vector
   * as confirmed for kNN. With `applyToMerchant`, the merchant's other rows that the user
   * did not set themselves take the category too. Returns how many such rows still differ,
   * so the UI can offer to apply it.
   */
  setCategory: protectedProcedure
    .input(setTransactionCategorySchema)
    .handler(async ({ context, input }) => {
      try {
        return await correctCategory(
          { db: context.db, env: context.env, userId: context.session.user.id },
          input,
        );
      } catch (error) {
        throw toORPCError(error);
      }
    }),
};
