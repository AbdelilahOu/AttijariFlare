import type { TxnEnrichMessage } from "@finance-ttijari/api/bindings";
import { enrichStatement, PermanentEnrichError } from "@finance-ttijari/api/categorization/enrich";
import { createDb } from "@finance-ttijari/db";

import type { CloudflareEnv } from "../../cloudflare-env";

const MAX_ATTEMPTS = 4;

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
