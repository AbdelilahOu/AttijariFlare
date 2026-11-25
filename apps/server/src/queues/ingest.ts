import type { StatementIngestMessage } from "@finance-ttijari/api/bindings";

import type { CloudflareEnv } from "../../cloudflare-env";

/**
 * Consumer for the `statement-ingest` queue.
 * Stub: acknowledges every message. The AI extraction feature replaces this body.
 */
export async function handleStatementIngest(
  batch: MessageBatch<StatementIngestMessage>,
  _env: CloudflareEnv,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    console.log("statement-ingest: received", message.id, message.body);
    message.ack();
  }
}
