import type { TxnEnrichMessage } from "@finance-ttijari/api/bindings";
import { enrichStatement, PermanentEnrichError } from "@finance-ttijari/api/categorization/enrich";
import { createDb } from "@finance-ttijari/db";

import type { CloudflareEnv } from "../../cloudflare-env";

/**
 * Deliveries per message: the first one plus `maxRetries: 3` of the txn-enrich consumer
 * (packages/infra/alchemy.run.ts). After the last one the message goes to the DLQ.
 */
const MAX_ATTEMPTS = 4;

/**
 * Consumer for the `txn-enrich` queue: links the rows of one statement to merchants and
 * categorizes them. Transient errors are retried by the queue; a missing statement (deleted
 * meanwhile) is acked. Logs counts only, never descriptions or amounts.
 */
export async function handleTxnEnrich(
  batch: MessageBatch<TxnEnrichMessage>,
  env: CloudflareEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = createDb(env);
  for (const message of batch.messages) {
    const { statementId } = message.body;
    const startedAt = Date.now();
    try {
      const result = await enrichStatement({ db, env }, statementId);
      console.log(
        JSON.stringify({
          event: "txn-enrich.done",
          statementId,
          attempt: message.attempts,
          ms: Date.now() - startedAt,
          ...result,
        }),
      );
      message.ack();
    } catch (error) {
      const permanent = error instanceof PermanentEnrichError;
      console.error(
        JSON.stringify({
          event: "txn-enrich.error",
          statementId,
          attempt: message.attempts,
          permanent,
          final: permanent || message.attempts >= MAX_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (permanent) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
