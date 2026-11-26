import type { StatementIngestMessage } from "@attijari-flare/api/bindings";
import { ingestStatement, PermanentIngestError } from "@attijari-flare/api/extraction/ingest";
import { createDb } from "@attijari-flare/db";
import { statements } from "@attijari-flare/db/schema/index";
import { eq } from "drizzle-orm";

import type { CloudflareEnv } from "../../cloudflare-env";
import { handleQueueBatch } from "./handle-batch";

const MAX_ATTEMPTS = 4;

export async function handleStatementIngest(
  batch: MessageBatch<StatementIngestMessage>,
  env: CloudflareEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = createDb(env);
  await handleQueueBatch(batch, {
    event: "statement-ingest",
    maxAttempts: MAX_ATTEMPTS,
    isPermanent: (error) => error instanceof PermanentIngestError,
    run: (statementId) => ingestStatement({ db, env }, statementId),
    onError: async (statementId, error, final) => {
      const reason = error instanceof Error ? error.message : String(error);
      await db
        .update(statements)
        .set(final ? { status: "failed", error: reason } : { error: reason })
        .where(eq(statements.id, statementId))
        .catch((updateError: unknown) =>
          console.error("statement-ingest: status update", updateError),
        );
    },
  });
}
