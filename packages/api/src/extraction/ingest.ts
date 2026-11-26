import type { Database } from "@attijari-flare/db";
import { getStatementForExtraction, markStatementExtracting } from "@attijari-flare/db/queries";
import { type NewTransaction, statements, transactions } from "@attijari-flare/db/schema/index";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Bindings } from "../bindings";
import { statementOriginalKey, statementPrefix } from "../statements";
import { extractStatement, ExtractionError, type RunModel } from "./extract";
import { reconcile } from "./reconcile";
import { hasUsableText } from "./utils/chunk";
import { fingerprintTransactions, normalizeDescription } from "./utils/fingerprint";
import { createWorkersAiRunner } from "./workers-ai";

/** A failure that retrying cannot fix: the consumer marks the statement failed and acks. */
export class PermanentIngestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PermanentIngestError";
  }
}

export type IngestResult = {
  status: "parsed" | "needs_review";
  transactions: number;
  inserted: number;
  removed: number;
  neuronsEstimate: number;
};

export const artifactKeys = (statementId: string) => ({
  markdown: `${statementPrefix(statementId)}extracted.md`,
  extraction: `${statementPrefix(statementId)}extraction.json`,
});

/** D1 allows 100 bound parameters per statement; a transactions row binds at most 18. */
const ROWS_PER_INSERT = 5;
const IDS_PER_DELETE = 90;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Runs extraction for one statement end to end:
 * PDF from R2 -> markdown (toMarkdown) -> LLM JSON -> reconcile -> transactions in D1 ->
 * txn-enrich message. Safe to run again for the same statement: fingerprints make inserts
 * idempotent, and rows from an earlier run that the new run no longer finds are removed.
 */
export async function ingestStatement(
  deps: {
    db: Database;
    env: Pick<Bindings, "STATEMENTS" | "AI" | "TXN_ENRICH">;
    runModel?: RunModel;
  },
  statementId: string,
): Promise<IngestResult> {
  const { db, env } = deps;
  const statement = await getStatementForExtraction(db, { id: statementId });
  if (!statement) {
    throw new PermanentIngestError("statement_not_found");
  }

  await markStatementExtracting(db, { id: statementId });

  const pdf = await env.STATEMENTS.get(statement.r2Key || statementOriginalKey(statementId));
  if (!pdf) {
    throw new PermanentIngestError("pdf_not_found");
  }
  const converted = await env.AI.toMarkdown({
    name: statement.fileName || "statement.pdf",
    blob: new Blob([await pdf.arrayBuffer()], { type: "application/pdf" }),
  });
  if (converted.format === "error") {
    throw new Error(`toMarkdown failed: ${converted.error}`);
  }
  const markdown = converted.data;
  const keys = artifactKeys(statementId);
  await env.STATEMENTS.put(keys.markdown, markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
  if (!hasUsableText(markdown)) {
    throw new PermanentIngestError("no_text_layer");
  }

  let extraction;
  try {
    extraction = await extractStatement(markdown, deps.runModel ?? createWorkersAiRunner(env.AI));
  } catch (error) {
    if (error instanceof ExtractionError) {
      // Keep the failed attempts for audit before letting the queue retry.
      await env.STATEMENTS.put(
        keys.extraction,
        JSON.stringify({ error: error.message, attempts: error.attempts }, null, 2),
        { httpMetadata: { contentType: "application/json" } },
      );
    }
    throw error;
  }

  const { reconciliation, transactions: rows } = reconcile({
    openingBalance: extraction.openingBalance,
    closingBalance: extraction.closingBalance,
    transactions: extraction.transactions,
  });

  await env.STATEMENTS.put(
    keys.extraction,
    JSON.stringify({ ...extraction, transactions: rows, reconciliation }, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );

  const fingerprints = await fingerprintTransactions(statement.userId, rows);
  const values: NewTransaction[] = rows.map((row, rowIndex) => ({
    userId: statement.userId,
    statementId,
    rowIndex,
    bookingDate: row.booking_date,
    valueDate: row.value_date,
    descriptionRaw: row.description,
    descriptionNormalized: normalizeDescription(row.description),
    amount: row.amount,
    type: row.type,
    balanceAfter: row.balance_after,
    fingerprint: fingerprints[rowIndex] ?? "",
  }));

  // Rows a previous run of this statement stored but this run did not find.
  const wanted = new Set(fingerprints);
  const existing = await db
    .select({ id: transactions.id, fingerprint: transactions.fingerprint })
    .from(transactions)
    .where(eq(transactions.statementId, statementId));
  const existingFingerprints = new Set(existing.map((row) => row.fingerprint));
  const staleIds = existing.filter((row) => !wanted.has(row.fingerprint)).map((row) => row.id);

  const writes: BatchItem<"sqlite">[] = [
    ...chunked(staleIds, IDS_PER_DELETE).map((ids) =>
      db
        .delete(transactions)
        .where(and(eq(transactions.statementId, statementId), inArray(transactions.id, ids))),
    ),
    ...chunked(values, ROWS_PER_INSERT).map((batch) =>
      db.insert(transactions).values(batch).onConflictDoNothing(),
    ),
  ];
  const status = reconciliation.ok ? "parsed" : "needs_review";
  const finish = db
    .update(statements)
    .set({
      status,
      error: reconciliation.ok
        ? null
        : JSON.stringify({ kind: "reconciliation", issues: reconciliation.issues }),
      model: extraction.model,
      accountLabel: extraction.accountLabel ?? statement.accountLabel,
      periodStart: extraction.periodStart,
      periodEnd: extraction.periodEnd,
      openingBalance: extraction.openingBalance,
      closingBalance: extraction.closingBalance,
    })
    .where(eq(statements.id, statementId));
  // One round trip, applied atomically (D1 runs a batch as a single transaction).
  const queries: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [finish, ...writes];
  await db.batch(queries);

  await env.TXN_ENRICH.send({ statementId });

  return {
    status,
    transactions: rows.length,
    inserted: fingerprints.filter((fingerprint) => !existingFingerprints.has(fingerprint)).length,
    removed: staleIds.length,
    neuronsEstimate: extraction.neuronsEstimate,
  };
}
