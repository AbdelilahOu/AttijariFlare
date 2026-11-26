import type { StatementIngestMessage } from "@attijari-flare/api/bindings";
import { ingestStatement, PermanentIngestError } from "@attijari-flare/api/extraction/ingest";
import { createDb } from "@attijari-flare/db";
import { statements } from "@attijari-flare/db/schema/index";
import { eq } from "drizzle-orm";

import type { CloudflareEnv } from "../../cloudflare-env";

const MAX_ATTEMPTS = 4;

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
