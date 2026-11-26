import {
  getMonthlyTotalsRaw,
  getNeedsReviewRaw,
  getSpendByCategoryRaw,
  listReportStatements,
} from "@attijari-flare/db/queries";

import { protectedProcedure } from "../index";
import {
  LOW_CONFIDENCE_THRESHOLD,
  REVIEW_LIST_LIMIT,
  buildMonthlyTotals,
  buildSpendByCategory,
  groupSplitRows,
  monthBounds,
  summarizeStatementError,
} from "../reports";
import { monthRangeSchema, optionalMonthRangeSchema } from "../schemas/reports";

// Reports for the dashboard. Sums are done in D1 so the Worker only merges small,
// already-aggregated result sets (free plan: 10 ms CPU per request). Only debits that
// have allocations are fetched row by row, so splits use the same pure allocation math
// as the allocation editor.

function sqlRange(range: { from?: string; to?: string }) {
  return {
    start: range.from ? monthBounds(range.from, range.from).start : undefined,
    end: range.to ? monthBounds(range.to, range.to).end : undefined,
  };
}

export const reportsRouter = {
  /** Money in, money out, net and statement closing balance per booking month. */
  monthly: protectedProcedure
    .input(optionalMonthRangeSchema)
    .handler(async ({ context, input }) => {
      const { rows, balances } = await getMonthlyTotalsRaw(context.db, {
        userId: context.session.user.id,
        range: sqlRange(input),
      });
      const totals = buildMonthlyTotals(rows, balances);
      return totals.filter(
        (row) => (!input.from || row.month >= input.from) && (!input.to || row.month <= input.to),
      );
    }),

  /**
   * Debit spend per category for the months `from` to `to` inclusive, with allocations
   * applied. Unallocated cash withdrawals and uncategorized spend are reported apart.
   */
  spendByCategory: protectedProcedure
    .input(monthRangeSchema)
    .handler(async ({ context, input }) => {
      const { unsplit, splitRows, categoryRows } = await getSpendByCategoryRaw(context.db, {
        userId: context.session.user.id,
        range: sqlRange(input),
      });
      return {
        from: input.from,
        to: input.to,
        ...buildSpendByCategory(
          unsplit.map((row) => ({
            categoryId: row.categoryId,
            isCash: Boolean(row.isCash),
            amount: Number(row.amount),
          })),
          groupSplitRows(splitRows.map((row) => ({ ...row, isCash: Boolean(row.isCash) }))),
          categoryRows,
        ),
      };
    }),

  /** Every statement with its period, status, balances and transaction count. */
  statements: protectedProcedure.handler(({ context }) =>
    listReportStatements(context.db, { userId: context.session.user.id }),
  ),

  /**
   * What needs the user's attention: statements that failed or did not reconcile,
   * transactions without a category or with a low-confidence machine category
   * (debits that are split are skipped, their allocations decide the category), and
   * cash withdrawals with an unallocated remainder. Each list is capped; `total` is
   * the full count.
   */
  needsReview: protectedProcedure.handler(async ({ context }) => {
    const { statementRows, categoryRows, cashRows } = await getNeedsReviewRaw(context.db, {
      userId: context.session.user.id,
      lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
      limit: REVIEW_LIST_LIMIT,
    });

    return {
      lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
      statements: statementRows.map(({ error, ...row }) => ({
        ...row,
        reason: summarizeStatementError(error),
      })),
      transactions: {
        total: Number(categoryRows[0]?.total ?? 0),
        items: categoryRows.map(({ total: _total, ...row }) => ({
          ...row,
          reason:
            row.categoryId === null ? ("uncategorized" as const) : ("low_confidence" as const),
        })),
      },
      cashWithdrawals: {
        total: Number(cashRows[0]?.total ?? 0),
        items: cashRows.map(({ total: _total, ...row }) => {
          const allocatedAmount = Number(row.allocated);
          return {
            ...row,
            allocated: allocatedAmount,
            remainder: Math.abs(row.amount) - allocatedAmount,
          };
        }),
      },
    };
  }),
};
