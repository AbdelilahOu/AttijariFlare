/**
 * Cloudflare bindings exposed to routers through the oRPC context and to queue handlers.
 * The server worker's env (see apps/server/cloudflare-env.d.ts) must satisfy this type.
 */

/** Body of a `statement-ingest` message: one uploaded statement to extract. */
export type StatementIngestMessage = {
  statementId: string;
};

/** Body of a `txn-enrich` message: categorize the transactions of one statement. */
export type TxnEnrichMessage = {
  statementId: string;
};

export type Bindings = {
  /** R2 bucket holding statements/{id}/original.pdf and extraction artifacts. */
  STATEMENTS: R2Bucket;
  /** Producer for the `statement-ingest` queue. */
  STATEMENT_INGEST: Queue<StatementIngestMessage>;
  /** Producer for the `txn-enrich` queue. */
  TXN_ENRICH: Queue<TxnEnrichMessage>;
  /** Vectorize index of merchant embeddings (bge-m3, 1024 dims, cosine). */
  VECTORIZE: Vectorize;
  /** Workers AI. */
  AI: Ai;
};
