import { and, asc, count, desc, eq, gte, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm";

import type { Database } from "../index";
import type { TransactionType } from "../schema/enums";
import {
  categories,
  merchants,
  statements,
  transactionAllocations,
  transactions,
} from "../schema/index";

/** Category filter value for rows without a category. */
export const UNCATEGORIZED = "none";

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export type ListTransactionsParams = {
  userId: string;
  month?: string;
  categoryId?: string;
  statementId?: string;
  type?: TransactionType;
  /** Both the raw and normalized forms of the search text. */
  search?: { raw: string; normalized: string };
  page: number;
  pageSize: number;
};

/** Filtered, paginated transactions, newest first, with category, merchant and split info. */
export async function listTransactions(db: Database, params: ListTransactionsParams) {
  const filters: (SQL | undefined)[] = [eq(transactions.userId, params.userId)];
  if (params.month) {
    filters.push(
      gte(transactions.bookingDate, `${params.month}-01`),
      lte(transactions.bookingDate, `${params.month}-31`),
    );
  }
  if (params.categoryId === UNCATEGORIZED) filters.push(isNull(transactions.categoryId));
  else if (params.categoryId) filters.push(eq(transactions.categoryId, params.categoryId));
  if (params.statementId) filters.push(eq(transactions.statementId, params.statementId));
  if (params.type) filters.push(eq(transactions.type, params.type));
  if (params.search) {
    const raw = likePattern(params.search.raw);
    const normalized = likePattern(params.search.normalized);
    filters.push(
      or(
        sql`${transactions.descriptionRaw} like ${raw} escape '\\'`,
        sql`${transactions.descriptionNormalized} like ${normalized} escape '\\'`,
        sql`${merchants.normalizedName} like ${normalized} escape '\\'`,
      ),
    );
  }
  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: transactions.id,
        statementId: transactions.statementId,
        statementFileName: statements.fileName,
        bookingDate: transactions.bookingDate,
        valueDate: transactions.valueDate,
        descriptionRaw: transactions.descriptionRaw,
        amount: transactions.amount,
        type: transactions.type,
        balanceAfter: transactions.balanceAfter,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        categorySource: transactions.categorySource,
        confidence: transactions.confidence,
        merchantId: transactions.merchantId,
        merchantName: merchants.normalizedName,
        allocationParts: sql<number>`(select count(*) from ${transactionAllocations} where ${transactionAllocations.transactionId} = ${transactions.id})`,
      })
      .from(transactions)
      .innerJoin(statements, eq(statements.id, transactions.statementId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(where)
      .orderBy(
        desc(transactions.bookingDate),
        asc(transactions.statementId),
        asc(transactions.rowIndex),
      )
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db
      .select({ n: count() })
      .from(transactions)
      .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(where),
  ]);

  return { rows, total: total?.n ?? 0 };
}

/** Booking months that have transactions, newest first (`YYYY-MM`). */
export async function listTransactionMonths(db: Database, params: { userId: string }) {
  const month = sql<string>`substr(${transactions.bookingDate}, 1, 7)`;
  const rows = await db
    .selectDistinct({ month })
    .from(transactions)
    .where(eq(transactions.userId, params.userId))
    .orderBy(desc(month));
  return rows.map((row) => row.month);
}

export async function getTransactionWithMerchant(
  db: Database,
  params: { userId: string; transactionId: string },
) {
  const [row] = await db
    .select({ id: transactions.id, merchantId: transactions.merchantId })
    .from(transactions)
    .where(and(eq(transactions.id, params.transactionId), eq(transactions.userId, params.userId)))
    .limit(1);
  return row;
}

export async function getOwnedCategory(
  db: Database,
  params: { userId: string; categoryId: string },
) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, params.categoryId), eq(categories.userId, params.userId)))
    .limit(1);
  return row;
}

/** Rows the categorizer may still change: everything not set by the user. */
export function notUserSetFilter() {
  return or(isNull(transactions.categorySource), ne(transactions.categorySource, "user"));
}

/** Sets a transaction's category with source `user` (no merchant involved). */
export async function setTransactionCategoryByUser(
  db: Database,
  params: { transactionId: string; categoryId: string },
) {
  await db
    .update(transactions)
    .set({ categoryId: params.categoryId, categorySource: "user", confidence: null })
    .where(eq(transactions.id, params.transactionId));
}

export type CorrectionBatch = {
  userId: string;
  transactionId: string;
  categoryId: string;
  merchantId: string;
  applyToMerchant: boolean;
  /** Confidence stored on rows that take the category via `applyToMerchant`. */
  merchantDefaultConfidence: number;
};

/**
 * Applies a user category correction in one D1 batch: sets the row's category (source
 * `user`), makes it the merchant's default, and (when `applyToMerchant`) applies it to the
 * merchant's other rows the categorizer may still change.
 */
export async function applyCategoryCorrection(db: Database, params: CorrectionBatch) {
  const otherRows = and(
    eq(transactions.userId, params.userId),
    eq(transactions.merchantId, params.merchantId),
    ne(transactions.id, params.transactionId),
    notUserSetFilter(),
  );

  const [, [merchant], applied] = await db.batch([
    db
      .update(transactions)
      .set({ categoryId: params.categoryId, categorySource: "user", confidence: null })
      .where(eq(transactions.id, params.transactionId)),
    db
      .update(merchants)
      .set({ defaultCategoryId: params.categoryId })
      .where(and(eq(merchants.id, params.merchantId), eq(merchants.userId, params.userId)))
      .returning({
        id: merchants.id,
        userId: merchants.userId,
        normalizedName: merchants.normalizedName,
        vectorId: merchants.vectorId,
        defaultCategoryId: merchants.defaultCategoryId,
      }),
    params.applyToMerchant
      ? db
          .update(transactions)
          .set({
            categoryId: params.categoryId,
            categorySource: "vector",
            confidence: params.merchantDefaultConfidence,
          })
          .where(otherRows)
          .returning({ id: transactions.id })
      : db
          .select({ id: transactions.id })
          .from(transactions)
          .where(sql`0`),
  ]);

  const [pending] = await db
    .select({ n: count() })
    .from(transactions)
    .where(
      and(
        otherRows,
        or(isNull(transactions.categoryId), ne(transactions.categoryId, params.categoryId)),
      ),
    );

  return { merchant, applied: applied.length, sameMerchantPending: pending?.n ?? 0 };
}
