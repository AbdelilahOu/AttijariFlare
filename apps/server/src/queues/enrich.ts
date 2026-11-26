import type { TxnEnrichMessage } from "@attijari-flare/api/bindings";
import { enrichStatement, PermanentEnrichError } from "@attijari-flare/api/categorization/enrich";
import { createDb } from "@attijari-flare/db";

import type { CloudflareEnv } from "../../cloudflare-env";
import { handleQueueBatch } from "./handle-batch";

const MAX_ATTEMPTS = 4;

export async function handleTxnEnrich(
  batch: MessageBatch<TxnEnrichMessage>,
  env: CloudflareEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = createDb(env);
  await handleQueueBatch(batch, {
    event: "txn-enrich",
    maxAttempts: MAX_ATTEMPTS,
    isPermanent: (error) => error instanceof PermanentEnrichError,
    run: (statementId) => enrichStatement({ db, env }, statementId),
  });
}
