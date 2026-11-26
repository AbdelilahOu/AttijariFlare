import type { Database } from "@finance-ttijari/db";
import { getStatementForReextract, markStatementUploaded } from "@finance-ttijari/db/queries";

import type { Bindings } from "../bindings";
import { isExtractionStale } from "./stale";

/** Raised by `reextractStatement`; `code` maps onto an HTTP status in the router. */
export class ReextractError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ReextractError";
  }
}

export type ReextractDeps = {
  db: Database;
  env: Pick<Bindings, "STATEMENT_INGEST">;
  userId: string;
};

/**
 * Queues a statement for extraction again (for example after a failure or a review).
 * Existing transactions are kept where the new run finds the same rows, so categories
 * and allocations on them survive. A statement still `extracting` is refused unless it
 * has been stuck for STALE_EXTRACTION_MS.
 */
export async function reextractStatement(deps: ReextractDeps, statementId: string) {
  const statement = await getStatementForReextract(deps.db, { userId: deps.userId, id: statementId });
  if (!statement) throw new ReextractError("NOT_FOUND", "Statement not found");
  // A run killed mid-way leaves `extracting` behind; allow a re-run once it is stale.
  if (statement.status === "extracting" && !isExtractionStale(statement.updatedAt)) {
    throw new ReextractError("CONFLICT", "Statement is already being extracted");
  }

  await markStatementUploaded(deps.db, { id: statement.id });
  await deps.env.STATEMENT_INGEST.send({ statementId: statement.id });
  return { statementId: statement.id, status: "uploaded" as const };
}
