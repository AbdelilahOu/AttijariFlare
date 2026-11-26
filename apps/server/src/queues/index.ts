import type { StatementIngestMessage, TxnEnrichMessage } from "@attijari-flare/api/bindings";

import type { CloudflareEnv } from "../../cloudflare-env";
import { txnEnrichQueue } from "./enrich";
import { statementIngestQueue } from "./ingest";

export { statementIngestQueue, txnEnrichQueue };

/**
 * The Worker's single `queue()` entry point. Each queue has its own consumer function;
 * this only picks it by the queue's physical name (which includes the stage).
 */
export async function queue(batch: MessageBatch<unknown>, env: CloudflareEnv): Promise<void> {
  if (batch.queue === env.STATEMENT_INGEST_QUEUE_NAME) {
    return statementIngestQueue(batch as MessageBatch<StatementIngestMessage>, env);
  }
  if (batch.queue === env.TXN_ENRICH_QUEUE_NAME) {
    return txnEnrichQueue(batch as MessageBatch<TxnEnrichMessage>, env);
  }
  // Unknown queue: retry so messages reach the dead-letter queue instead of being lost.
  console.error(`queue: no consumer for queue "${batch.queue}"`);
  batch.retryAll();
}
