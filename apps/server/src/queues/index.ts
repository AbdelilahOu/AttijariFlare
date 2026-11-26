import type { StatementIngestMessage, TxnEnrichMessage } from "@finance-ttijari/api/bindings";

import type { CloudflareEnv } from "../../cloudflare-env";
import { handleTxnEnrich } from "./enrich";
import { handleStatementIngest } from "./ingest";

export async function queue(
  batch: MessageBatch<unknown>,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<void> {
  switch (batch.queue) {
    case env.STATEMENT_INGEST_QUEUE_NAME:
      return handleStatementIngest(batch as MessageBatch<StatementIngestMessage>, env, ctx);
    case env.TXN_ENRICH_QUEUE_NAME:
      return handleTxnEnrich(batch as MessageBatch<TxnEnrichMessage>, env, ctx);
    default:
      // Unknown queue: retry so messages reach the dead-letter queue instead of being lost.
      console.error(`queue: no handler for queue "${batch.queue}"`);
      batch.retryAll();
  }
}
