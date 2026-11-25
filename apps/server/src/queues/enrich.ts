import type { TxnEnrichMessage } from "@finance-ttijari/api/bindings";

import type { CloudflareEnv } from "../../cloudflare-env";

/**
 * Consumer for the `txn-enrich` queue.
 * Stub: acknowledges every message. The categorization feature replaces this body.
 */
export async function handleTxnEnrich(
  batch: MessageBatch<TxnEnrichMessage>,
  _env: CloudflareEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    console.log("txn-enrich: received", message.id, message.body);
    message.ack();
  }
}
