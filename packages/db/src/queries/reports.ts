import { and, asc, desc, eq, gte, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";

import type { Database } from "../index";
import { categories, statements, transactionAllocations, transactions } from "../schema/index";

const isCashSql = sql<number>`${transactions.type} = 'cash_withdrawal'`;
const totalCount = sql<number>`count(*) over ()`;

const hasAllocations = (db: Database) =>
  db
    .select({ one: sql`1` })
    .from(transactionAllocations)
    .where(eq(transactionAllocations.transactionId, transactions.id));

function bookingDateIn(range: { start?: string; end?: string }) {
  return and(
    range.start ? gte(transactions.bookingDate, range.start) : undefined,
    range.end ? lt(transactions.bookingDate, range.end) : undefined,
  );
}

/** Money in, money out and transaction count per booking month, plus statement closing balances. */
export async function getMonthlyTotalsRaw(
  db: Database,
  params: { userId: string; range: { start?: string; end?: string } },
) {
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
      .where(and(eq(transactions.userId, params.userId), bookingDateIn(params.range)))
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
        and(eq(statements.userId, params.userId), inArray(statements.status, ["parsed", "needs_review"])),
      ),
  ]);
  return { rows, balances };
}

/** Debit spend for `spendByCategory`: unsplit totals, split rows (joined to allocations), and categories. */
export async function getSpendByCategoryRaw(
  db: Database,
  params: { userId: string; range: { start?: string; end?: string } },
) {
  const inRange = and(
    eq(transactions.userId, params.userId),
    lt(transactions.amount, 0),
    bookingDateIn(params.range),
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
      .innerJoin(transactionAllocations, eq(transactionAllocations.transactionId, transactions.id))
      .where(inRange)
      .orderBy(
        asc(transactions.id),
        asc(transactionAllocations.createdAt),
        asc(transactionAllocations.id),
      ),
    db
      .select({ id: categories.id, name: categories.name, color: categories.color, kind: categories.kind })
      .from(categories)
      .where(eq(categories.userId, params.userId)),
  ]);
  return { unsplit, splitRows, categoryRows };
}

/** Every statement with its period, status, balances and transaction count. */
export async function listReportStatements(db: Database, params: { userId: string }) {
  return db
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
    .where(eq(statements.userId, params.userId))
    .orderBy(
      desc(sql`coalesce(${statements.periodStart}, date(${statements.createdAt} / 1000, 'unixepoch'))`),
    );
}

/** Raw rows for the needs-review dashboard section: failed/unreconciled statements, low-confidence
 * or uncategorized transactions, and unallocated cash withdrawals. */
export async function getNeedsReviewRaw(
  db: Database,
  params: { userId: string; lowConfidenceThreshold: number; limit: number },
) {
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
      .where(and(eq(statements.userId, params.userId), inArray(statements.status, ["failed", "needs_review"])))
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
          eq(transactions.userId, params.userId),
          // Unallocated cash is listed in its own section below.
          sql`${transactions.type} <> 'cash_withdrawal'`,
          notExists(hasAllocations(db)),
          or(
            isNull(transactions.categoryId),
            and(
              or(isNull(transactions.categorySource), sql`${transactions.categorySource} <> 'user'`),
              lt(transactions.confidence, params.lowConfidenceThreshold),
            ),
          ),
        ),
      )
      .orderBy(desc(transactions.bookingDate), asc(transactions.rowIndex))
      .limit(params.limit),
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
          eq(transactions.userId, params.userId),
          eq(transactions.type, "cash_withdrawal"),
          lt(transactions.amount, 0),
        ),
      )
      .groupBy(transactions.id)
      .having(sql`${allocated} < abs(${transactions.amount})`)
      .orderBy(desc(transactions.bookingDate), asc(transactions.id))
      .limit(params.limit),
  ]);

  return { statementRows, categoryRows, cashRows };
}
