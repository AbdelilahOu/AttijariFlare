import type { StatementIngestMessage } from "@attijari-flare/api/bindings";
import { ingestStatement, PermanentIngestError } from "@attijari-flare/api/extraction/ingest";
import { logError, safeErrorSummary } from "@attijari-flare/api/log";
import { createDb } from "@attijari-flare/db";
import { statements } from "@attijari-flare/db/schema/index";
import { eq } from "drizzle-orm";

import type { CloudflareEnv } from "../../cloudflare-env";

// First delivery plus the consumer's maxRetries (3). After the last one the message goes to the DLQ.
const MAX_ATTEMPTS = 4;

/** Consumer for `statement-ingest`: extracts the transactions of one uploaded statement per message. */
export async function statementIngestQueue(
  batch: MessageBatch<StatementIngestMessage>,
  env: CloudflareEnv,
): Promise<void> {
  const db = createDb(env);

  for (const message of batch.messages) {
    const { statementId } = message.body;
    const startedAt = Date.now();

    try {
      const result = await ingestStatement({ db, env }, statementId);
      console.log(
        JSON.stringify({
          event: "statement-ingest.done",
          statementId,
          attempt: message.attempts,
          ms: Date.now() - startedAt,
          ...result,
        }),
      );
      message.ack();
    } catch (error) {
      // Redacted: library errors can quote statement text, model answers or query values.
      const summary = safeErrorSummary(error);
      const reason = summary.message || summary.name;
      const permanent = error instanceof PermanentIngestError;
      const final = permanent || message.attempts >= MAX_ATTEMPTS;
      logError("statement-ingest.error", error, {
        statementId,
        attempt: message.attempts,
        permanent,
        final,
      });

      // Record the (redacted) error on the statement; on the last attempt it is marked failed.
      await db
        .update(statements)
        .set(final ? { status: "failed", error: reason } : { error: reason })
        .where(eq(statements.id, statementId))
        .catch((updateError: unknown) =>
          logError("statement-ingest.status-update-error", updateError, { statementId }),
        );

      if (permanent) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
