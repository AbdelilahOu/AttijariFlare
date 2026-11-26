import { and, eq, inArray, isNotNull, ne, notExists, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../index";
import {
  categories,
  merchants,
  statements,
  transactionAllocations,
  transactions,
  user,
} from "../schema/index";

// Deletion and consent queries. Deletes run in dependency order (allocations, transactions,
// statements, merchants, categories) instead of relying on ON DELETE CASCADE, so they work
// the same whether or not the connection enforces foreign keys, and so the RESTRICT on
// transaction_allocations.category_id never fires mid-way.

/** D1 allows 100 bound parameters per statement. */
const IDS_PER_STATEMENT = 90;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function runBatch(db: Database, queries: BatchItem<"sqlite">[]): Promise<void> {
  const [first, ...rest] = queries;
  if (!first) return;
  // D1 runs a batch as one transaction: either every delete applies or none does.
  await db.batch([first, ...rest]);
}

/**
 * Merchants of the user that no transaction outside `statementId` references: they are
 * left without data once the statement is deleted. Merchants are only ever created from
 * transactions, so a merchant without transactions holds nothing worth keeping.
 */
export async function listMerchantsOrphanedByStatement(
  db: Database,
  params: { userId: string; statementId: string },
) {
  return db
    .select({ id: merchants.id })
    .from(merchants)
    .where(
      and(
        eq(merchants.userId, params.userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(transactions)
            .where(
              and(
                eq(transactions.merchantId, merchants.id),
                ne(transactions.statementId, params.statementId),
              ),
            ),
        ),
      ),
    );
}

/**
 * Deletes one statement's rows in a single batch: its allocations, its transactions, the
 * statement, then the given merchants if no transaction references them any more. Merchants
 * that gained a transaction in the meantime are kept but lose their vector id, since the
 * caller has already deleted their vectors. Returns false when the statement is not the
 * user's (or is already gone).
 */
export async function deleteStatementRows(
  db: Database,
  params: { userId: string; statementId: string; orphanMerchantIds: readonly string[] },
): Promise<boolean> {
  const { userId, statementId } = params;
  const [owned] = await db
    .select({ id: statements.id })
    .from(statements)
    .where(and(eq(statements.id, statementId), eq(statements.userId, userId)))
    .limit(1);
  if (!owned) return false;

  const statementTransactions = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.statementId, statementId), eq(transactions.userId, userId)));

  const merchantQueries = chunked(params.orphanMerchantIds, IDS_PER_STATEMENT).flatMap((ids) => [
    db.delete(merchants).where(
      and(
        eq(merchants.userId, userId),
        inArray(merchants.id, ids),
        notExists(
          db
            .select({ one: sql`1` })
            .from(transactions)
            .where(eq(transactions.merchantId, merchants.id)),
        ),
      ),
    ),
    db
      .update(merchants)
      .set({ vectorId: null })
      .where(and(eq(merchants.userId, userId), inArray(merchants.id, ids))),
  ]);

  await runBatch(db, [
    db
      .delete(transactionAllocations)
      .where(
        and(
          eq(transactionAllocations.userId, userId),
          inArray(transactionAllocations.transactionId, statementTransactions),
        ),
      ),
    db
      .delete(transactions)
      .where(and(eq(transactions.statementId, statementId), eq(transactions.userId, userId))),
    db.delete(statements).where(and(eq(statements.id, statementId), eq(statements.userId, userId))),
    ...merchantQueries,
  ]);
  return true;
}

/** Ids of every statement of the user (their R2 prefixes are `statements/{id}/`). */
export async function listUserStatementIds(db: Database, params: { userId: string }) {
  const rows = await db
    .select({ id: statements.id })
    .from(statements)
    .where(eq(statements.userId, params.userId));
  return rows.map((row) => row.id);
}

/**
 * Ids of every merchant of the user. A merchant's vector id is its own id, and a vector can
 * exist before `vector_id` is set (the enrich step writes the vector first), so every
 * merchant id is a candidate vector to delete.
 */
export async function listUserMerchantIds(db: Database, params: { userId: string }) {
  const rows = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.userId, params.userId));
  return rows.map((row) => row.id);
}

/** Deletes every finance row of the user in one batch. The auth rows are left to better-auth. */
export async function deleteUserFinanceRows(db: Database, params: { userId: string }) {
  const { userId } = params;
  await runBatch(db, [
    db.delete(transactionAllocations).where(eq(transactionAllocations.userId, userId)),
    db.delete(transactions).where(eq(transactions.userId, userId)),
    db.delete(statements).where(eq(statements.userId, userId)),
    db.delete(merchants).where(eq(merchants.userId, userId)),
    // Subcategories before their parents, so parent_id never points at a deleted row.
    db.delete(categories).where(and(eq(categories.userId, userId), isNotNull(categories.parentId))),
    db.delete(categories).where(eq(categories.userId, userId)),
  ]);
}

/** When the user accepted the privacy notice, or null. */
export async function getPrivacyAcceptance(db: Database, params: { userId: string }) {
  const [row] = await db
    .select({
      acceptedAt: user.privacyAcceptedAt,
      version: user.privacyPolicyVersion,
    })
    .from(user)
    .where(eq(user.id, params.userId))
    .limit(1);
  return row ?? null;
}

/** Records that the user accepted the given version of the privacy notice, at `at`. */
export async function recordPrivacyAcceptance(
  db: Database,
  params: { userId: string; version: string; at: Date },
) {
  const [row] = await db
    .update(user)
    .set({ privacyAcceptedAt: params.at, privacyPolicyVersion: params.version })
    .where(eq(user.id, params.userId))
    .returning({ acceptedAt: user.privacyAcceptedAt, version: user.privacyPolicyVersion });
  return row ?? null;
}
