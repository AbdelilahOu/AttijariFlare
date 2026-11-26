/**
 * Runs one consumer's handler per message of a batch, with the ack/retry/logging shared by
 * every queue consumer: `run` does the work, `isPermanent` tells a retryable failure from one
 * no retry can fix, and `onError` is for side effects a failure needs (for example marking a
 * row failed) before the message is acked or retried.
 */
export async function handleQueueBatch<Body extends { statementId: string }>(
  batch: MessageBatch<Body>,
  options: {
    event: string;
    maxAttempts: number;
    isPermanent: (error: unknown) => boolean;
    run: (statementId: string) => Promise<Record<string, unknown>>;
    onError?: (statementId: string, error: unknown, final: boolean) => Promise<void>;
  },
): Promise<void> {
  for (const message of batch.messages) {
    const { statementId } = message.body;
    const startedAt = Date.now();
    try {
      const result = await options.run(statementId);
      console.log(
        JSON.stringify({
          event: `${options.event}.done`,
          statementId,
          attempt: message.attempts,
          ms: Date.now() - startedAt,
          ...result,
        }),
      );
      message.ack();
    } catch (error) {
      const permanent = options.isPermanent(error);
      const final = permanent || message.attempts >= options.maxAttempts;
      console.error(
        JSON.stringify({
          event: `${options.event}.error`,
          statementId,
          attempt: message.attempts,
          permanent,
          final,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await options.onError?.(statementId, error, final);
      if (permanent) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}
