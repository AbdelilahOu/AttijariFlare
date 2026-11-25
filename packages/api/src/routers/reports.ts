import type { Database } from "@finance-ttijari/db";
import {
  categories,
  statements,
  transactionAllocations,
  transactions,
} from "@finance-ttijari/db/schema/index";
import { and, asc, desc, eq, gte, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  LOW_CONFIDENCE_THRESHOLD,
  MONTH_PATTERN,
  REVIEW_LIST_LIMIT,
  buildMonthlyTotals,
  buildSpendByCategory,
  groupSplitRows,
  monthBounds,
  summarizeStatementError,
} from "../reports";

// Reports for the dashboard. Sums are done in D1 so the Worker only merges small,
// already-aggregated result sets (free plan: 10 ms CPU per request). Only debits that
// have allocations are fetched row by row, so splits use the same pure allocation math
// as the allocation editor.

const month = z.string().regex(MONTH_PATTERN, "Expected YYYY-MM");

const rangeInput = z
  .object({ from: month, to: month })
  .refine((range) => range.from <= range.to, { message: "`from` must not be after `to`" });

const optionalRangeInput = z.object({ from: month.optional(), to: month.optional() }).default({});

function bookingDateIn(range: { from?: string; to?: string }) {
  const start = range.from ? monthBounds(range.from, range.from).start : undefined;
  const end = range.to ? monthBounds(range.to, range.to).end : undefined;
  return and(
    start ? gte(transactions.bookingDate, start) : undefined,
    end ? lt(transactions.bookingDate, end) : undefined,
  );
}

const hasAllocations = (db: Database) =>
  db
    .select({ one: sql`1` })
    .from(transactionAllocations)
    .where(eq(transactionAllocations.transactionId, transactions.id));

const isCashSql = sql<number>`${transactions.type} = 'cash_withdrawal'`;
const totalCount = sql<number>`count(*) over ()`;

export const reportsRouter = {
  /** Money in, money out, net and statement closing balance per booking month. */
  monthly: protectedProcedure.input(optionalRangeInput).handler(async ({ context, input }) => {
    const { db } = context;
    const userId = context.session.user.id;
    const monthSql = sql<string>`substr(${transactions.bookingDate}, 1, 7)`;
    const [rows, balances] = await Promise.all([
      db
        .select({
          month: monthSql,
          moneyIn: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
          moneyOut: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), 0)`,
          transactionCount: sql<number>`count(*)`,
        })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), bookingDateIn(input)))
        .groupBy(monthSql)
        .orderBy(monthSql),
      db
        .select({
          periodStart: statements.periodStart,
          periodEnd: statements.periodEnd,
          closingBalance: statements.closingBalance,
        })
        .from(statements)
        .where(
          and(
            eq(statements.userId, userId),
            inArray(statements.status, ["parsed", "needs_review"]),
          ),
        ),
    ]);
    const totals = buildMonthlyTotals(rows, balances);
    return totals.filter(
      (row) => (!input.from || row.month >= input.from) && (!input.to || row.month <= input.to),
    );
  }),

  /**
   * Debit spend per category for the months `from` to `to` inclusive, with allocations
   * applied. Unallocated cash withdrawals and uncategorized spend are reported apart.
   */
  spendByCategory: protectedProcedure.input(rangeInput).handler(async ({ context, input }) => {
    const { db } = context;
    const userId = context.session.user.id;
    const inRange = and(
      eq(transactions.userId, userId),
      lt(transactions.amount, 0),
      bookingDateIn(input),
    );
    const [unsplit, splitRows, categoryRows] = await Promise.all([
      db
        .select({
          categoryId: transactions.categoryId,
          isCash: isCashSql,
          amount: sql<number>`sum(${transactions.amount})`,
        })
        .from(transactions)
        .where(and(inRange, notExists(hasAllocations(db))))
        .groupBy(transactions.categoryId, isCashSql),
      db
        .select({
          transactionId: transactions.id,
          amount: transactions.amount,
          categoryId: transactions.categoryId,
          isCash: isCashSql,
          allocationAmount: transactionAllocations.amount,
          allocationCategoryId: transactionAllocations.categoryId,
        })
        .from(transactions)
        .innerJoin(
          transactionAllocations,
          eq(transactionAllocations.transactionId, transactions.id),
        )
        .where(inRange)
        .orderBy(
          asc(transactions.id),
          asc(transactionAllocations.createdAt),
          asc(transactionAllocations.id),
        ),
      db
        .select({
          id: categories.id,
          name: categories.name,
          color: categories.color,
          kind: categories.kind,
        })
        .from(categories)
        .where(eq(categories.userId, userId)),
    ]);
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
    context.db
      .select({
        id: statements.id,
        fileName: statements.fileName,
        periodStart: statements.periodStart,
        periodEnd: statements.periodEnd,
        openingBalance: statements.openingBalance,
        closingBalance: statements.closingBalance,
        status: statements.status,
        createdAt: statements.createdAt,
        transactionCount: sql<number>`(select count(*) from ${transactions} where ${transactions.statementId} = ${statements.id})`,
      })
      .from(statements)
      .where(eq(statements.userId, context.session.user.id))
      .orderBy(
        desc(
          sql`coalesce(${statements.periodStart}, date(${statements.createdAt} / 1000, 'unixepoch'))`,
        ),
      ),
  ),

  /**
   * What needs the user's attention: statements that failed or did not reconcile,
   * transactions without a category or with a low-confidence machine category
   * (debits that are split are skipped, their allocations decide the category), and
   * cash withdrawals with an unallocated remainder. Each list is capped; `total` is
   * the full count.
   */
  needsReview: protectedProcedure.handler(async ({ context }) => {
    const { db } = context;
    const userId = context.session.user.id;
    const allocated = sql<number>`coalesce(sum(${transactionAllocations.amount}), 0)`;

    const [statementRows, categoryRows, cashRows] = await Promise.all([
      db
        .select({
          id: statements.id,
          fileName: statements.fileName,
          periodStart: statements.periodStart,
          periodEnd: statements.periodEnd,
          status: statements.status,
          error: statements.error,
        })
        .from(statements)
        .where(
          and(
            eq(statements.userId, userId),
            inArray(statements.status, ["failed", "needs_review"]),
          ),
        )
        .orderBy(desc(statements.createdAt)),
      db
        .select({
          id: transactions.id,
          bookingDate: transactions.bookingDate,
          descriptionRaw: transactions.descriptionRaw,
          amount: transactions.amount,
          type: transactions.type,
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          categorySource: transactions.categorySource,
          confidence: transactions.confidence,
          total: totalCount,
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(
          and(
            eq(transactions.userId, userId),
            // Unallocated cash is listed in its own section below.
            sql`${transactions.type} <> 'cash_withdrawal'`,
            notExists(hasAllocations(db)),
            or(
              isNull(transactions.categoryId),
              and(
                or(
                  isNull(transactions.categorySource),
                  sql`${transactions.categorySource} <> 'user'`,
                ),
                lt(transactions.confidence, LOW_CONFIDENCE_THRESHOLD),
              ),
            ),
          ),
        )
        .orderBy(desc(transactions.bookingDate), asc(transactions.rowIndex))
        .limit(REVIEW_LIST_LIMIT),
      db
        .select({
          id: transactions.id,
          bookingDate: transactions.bookingDate,
          descriptionRaw: transactions.descriptionRaw,
          amount: transactions.amount,
          allocated,
          total: totalCount,
        })
        .from(transactions)
        .leftJoin(transactionAllocations, eq(transactionAllocations.transactionId, transactions.id))
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "cash_withdrawal"),
            lt(transactions.amount, 0),
          ),
        )
        .groupBy(transactions.id)
        .having(sql`${allocated} < abs(${transactions.amount})`)
        .orderBy(desc(transactions.bookingDate), asc(transactions.id))
        .limit(REVIEW_LIST_LIMIT),
    ]);

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
