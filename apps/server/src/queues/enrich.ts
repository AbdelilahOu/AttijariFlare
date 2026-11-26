import type { TxnEnrichMessage } from "@attijari-flare/api/bindings";
import { enrichStatement, PermanentEnrichError } from "@attijari-flare/api/categorization/enrich";
import { logError } from "@attijari-flare/api/log";
import { createDb } from "@attijari-flare/db";

import type { CloudflareEnv } from "../../cloudflare-env";

// First delivery plus the consumer's maxRetries (3). After the last one the message goes to the DLQ.
const MAX_ATTEMPTS = 4;

/** Consumer for `txn-enrich`: links one statement's transactions to merchants and categorizes them. */
export async function txnEnrichQueue(
  batch: MessageBatch<TxnEnrichMessage>,
  env: CloudflareEnv,
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
      logError("txn-enrich.error", error, {
        statementId,
        attempt: message.attempts,
        permanent,
        final: permanent || message.attempts >= MAX_ATTEMPTS,
      });

      if (permanent) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
