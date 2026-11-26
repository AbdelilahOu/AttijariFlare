import { and, count, desc, eq } from "drizzle-orm";

import type { Database } from "../index";
import { type NewStatement, statements, transactions } from "../schema/index";

const statementSummaryColumns = {
  id: statements.id,
  fileName: statements.fileName,
  accountLabel: statements.accountLabel,
  periodStart: statements.periodStart,
  periodEnd: statements.periodEnd,
  openingBalance: statements.openingBalance,
  closingBalance: statements.closingBalance,
  status: statements.status,
  error: statements.error,
  model: statements.model,
  createdAt: statements.createdAt,
  updatedAt: statements.updatedAt,
  transactionCount: count(transactions.id),
};

function summaryQuery(db: Database) {
  return db
    .select(statementSummaryColumns)
    .from(statements)
    .leftJoin(transactions, eq(transactions.statementId, statements.id))
    .groupBy(statements.id);
}

export type StatementSummary = Awaited<ReturnType<typeof listStatements>>[number];

/** Every statement of the user, newest period first (unparsed uploads first). */
export async function listStatements(db: Database, params: { userId: string }) {
  return summaryQuery(db)
    .where(eq(statements.userId, params.userId))
    .orderBy(desc(statements.periodStart), desc(statements.createdAt));
}

export async function getStatementSummary(db: Database, params: { userId: string; id: string }) {
  const [row] = await summaryQuery(db)
    .where(and(eq(statements.id, params.id), eq(statements.userId, params.userId)))
    .limit(1);
  return row;
}

export async function findStatementBySha(
  db: Database,
  params: { userId: string; sha256: string },
) {
  const [row] = await db
    .select({ id: statements.id })
    .from(statements)
    .where(and(eq(statements.userId, params.userId), eq(statements.sha256, params.sha256)))
    .limit(1);
  return row;
}

export async function insertStatement(db: Database, values: NewStatement) {
  const [row] = await db.insert(statements).values(values).returning();
  return row;
}

export async function markStatementFailed(db: Database, params: { id: string; error: string }) {
  const [row] = await db
    .update(statements)
    .set({ status: "failed", error: params.error })
    .where(eq(statements.id, params.id))
    .returning();
  return row;
}

export async function getStatementFile(db: Database, params: { userId: string; id: string }) {
  const [row] = await db
    .select({ r2Key: statements.r2Key, fileName: statements.fileName })
    .from(statements)
    .where(and(eq(statements.id, params.id), eq(statements.userId, params.userId)))
    .limit(1);
  return row;
}

export async function deleteStatementRow(db: Database, params: { userId: string; id: string }) {
  const deleted = await db
    .delete(statements)
    .where(and(eq(statements.id, params.id), eq(statements.userId, params.userId)))
    .returning({ id: statements.id });
  return deleted;
}

export async function getStatementForExtraction(db: Database, params: { id: string }) {
  const [row] = await db.select().from(statements).where(eq(statements.id, params.id)).limit(1);
  return row;
}

export async function markStatementExtracting(db: Database, params: { id: string }) {
  await db
    .update(statements)
    .set({ status: "extracting", error: null })
    .where(eq(statements.id, params.id));
}

export async function getStatementForReextract(
  db: Database,
  params: { userId: string; id: string },
) {
  const [row] = await db
    .select({ id: statements.id, status: statements.status, updatedAt: statements.updatedAt })
    .from(statements)
    .where(and(eq(statements.id, params.id), eq(statements.userId, params.userId)))
    .limit(1);
  return row;
}

export async function markStatementUploaded(db: Database, params: { id: string }) {
  await db
    .update(statements)
    .set({ status: "uploaded", error: null })
    .where(eq(statements.id, params.id));
}
