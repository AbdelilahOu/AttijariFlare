import type { StatementIngestMessage } from "@finance-ttijari/api/bindings";
import { ingestStatement, PermanentIngestError } from "@finance-ttijari/api/extraction/ingest";
import { createDb } from "@finance-ttijari/db";
import { statements } from "@finance-ttijari/db/schema/index";
import { eq } from "drizzle-orm";

import type { CloudflareEnv } from "../../cloudflare-env";

/**
 * Deliveries per message: the first one plus `maxRetries: 3` of the statement-ingest
 * consumer (packages/infra/alchemy.*.ts). After the last one the message goes to the DLQ.
 */
const MAX_ATTEMPTS = 4;

/**
 * Consumer for the `statement-ingest` queue: extracts one statement per message.
 * Transient errors are retried by the queue; the last attempt and permanent errors
 * (no text layer, missing statement) mark the statement failed.
 */
export async function handleStatementIngest(
  batch: MessageBatch<StatementIngestMessage>,
  env: CloudflareEnv,
  _ctx: ExecutionContext,
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
      const permanent = error instanceof PermanentIngestError;
      const final = permanent || message.attempts >= MAX_ATTEMPTS;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          event: "statement-ingest.error",
          statementId,
          attempt: message.attempts,
          permanent,
          final,
          error: reason,
        }),
      );
      await db
        .update(statements)
        .set(final ? { status: "failed", error: reason } : { error: reason })
        .where(eq(statements.id, statementId))
        .catch((updateError: unknown) =>
          console.error("statement-ingest: status update", updateError),
        );
      if (permanent) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
