/**
 * How long a statement may sit in `extracting` before it counts as stuck. The consumer
 * cannot reset the status when its invocation is killed (CPU limit, runtime error), so after
 * the last retry the message lands in the DLQ with the status still `extracting`. One run
 * takes a few minutes at most, and retries are 60 s apart.
 */
export const STALE_EXTRACTION_MS = 15 * 60 * 1000;

/** True when a statement in `extracting` has not been touched for STALE_EXTRACTION_MS. */
export function isExtractionStale(updatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() >= STALE_EXTRACTION_MS;
}
