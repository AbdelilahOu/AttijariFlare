import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { Database } from "../index";
import type { TransactionType } from "../schema/enums";
import { categories, transactionAllocations, transactions } from "../schema/index";

export async function getTransactionForAllocation(
  db: Database,
  params: { userId: string; transactionId: string },
) {
  const [row] = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      type: transactions.type,
      categoryId: transactions.categoryId,
      bookingDate: transactions.bookingDate,
      descriptionRaw: transactions.descriptionRaw,
    })
    .from(transactions)
    .where(and(eq(transactions.id, params.transactionId), eq(transactions.userId, params.userId)))
    .limit(1);
  return row;
}

export async function listAllocations(
  db: Database,
  params: { userId: string; transactionId: string },
) {
  return db
    .select({
      id: transactionAllocations.id,
      amount: transactionAllocations.amount,
      categoryId: transactionAllocations.categoryId,
      note: transactionAllocations.note,
    })
    .from(transactionAllocations)
    .where(
      and(
        eq(transactionAllocations.transactionId, params.transactionId),
        eq(transactionAllocations.userId, params.userId),
      ),
    )
    .orderBy(asc(transactionAllocations.createdAt), asc(transactionAllocations.id));
}

export async function listOwnedCategoryIds(
  db: Database,
  params: { userId: string; categoryIds: readonly string[] },
) {
  if (params.categoryIds.length === 0) return [];
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, params.userId), inArray(categories.id, params.categoryIds)));
  return rows.map((row) => row.id);
}

/** Replaces every allocation of one transaction atomically. An empty list clears them. */
export async function replaceAllocations(
  db: Database,
  params: {
    userId: string;
    transactionId: string;
    parts: readonly { amount: number; categoryId: string; note: string | null }[];
  },
) {
  const remove = db
    .delete(transactionAllocations)
    .where(
      and(
        eq(transactionAllocations.transactionId, params.transactionId),
        eq(transactionAllocations.userId, params.userId),
      ),
    );
  const inserts = params.parts.map((part) =>
    db.insert(transactionAllocations).values({
      userId: params.userId,
      transactionId: params.transactionId,
      amount: part.amount,
      categoryId: part.categoryId,
      note: part.note,
    }),
  );
  await db.batch([remove, ...inserts]);
}

export async function deleteAllocation(db: Database, params: { userId: string; id: string }) {
  const [deleted] = await db
    .delete(transactionAllocations)
    .where(
      and(eq(transactionAllocations.id, params.id), eq(transactionAllocations.userId, params.userId)),
    )
    .returning({ transactionId: transactionAllocations.transactionId });
  return deleted;
}

/** Debit transactions for the allocation page: cash withdrawals first, then newest first. */
export async function listDebitTransactions(
  db: Database,
  params: { userId: string; type?: TransactionType; limit: number },
) {
  const allocated = sql<number>`coalesce(sum(${transactionAllocations.amount}), 0)`;
  const rows = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      descriptionRaw: transactions.descriptionRaw,
      amount: transactions.amount,
      type: transactions.type,
      categoryId: transactions.categoryId,
      allocated,
      parts: sql<number>`count(${transactionAllocations.id})`,
    })
    .from(transactions)
    .leftJoin(transactionAllocations, eq(transactionAllocations.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.userId, params.userId),
        lt(transactions.amount, 0),
        params.type ? eq(transactions.type, params.type) : undefined,
      ),
    )
    .groupBy(transactions.id)
    .orderBy(
      desc(sql`${transactions.type} = 'cash_withdrawal'`),
      desc(transactions.bookingDate),
      asc(transactions.id),
    )
    .limit(params.limit);
  return rows;
}

export async function listAllocatableCategories(db: Database, params: { userId: string }) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      color: categories.color,
    })
    .from(categories)
    .where(eq(categories.userId, params.userId))
    .orderBy(asc(categories.name));
}
