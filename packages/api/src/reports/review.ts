// Rules for the dashboard's needs-review list.

/** Machine categories below this confidence are listed for review. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** At most this many rows per needs-review section; the total count is reported apart. */
export const REVIEW_LIST_LIMIT = 25;

/**
 * A short, user-facing reason for a failed or needs_review statement.
 * `statements.error` is either plain text or JSON such as
 * `{ "kind": "reconciliation", "issues": [...] }` written by the extraction pipeline.
 */
export function summarizeStatementError(error: string | null): string | null {
  if (!error) return null;
  const text = error.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { kind?: unknown; issues?: unknown };
      if (parsed.kind === "reconciliation") {
        const count = Array.isArray(parsed.issues) ? parsed.issues.length : 0;
        return count > 0
          ? `Balances do not reconcile (${count} issue${count === 1 ? "" : "s"})`
          : "Balances do not reconcile";
      }
      if (typeof parsed.kind === "string") return parsed.kind;
    } catch {
      // Not JSON after all; fall through to the plain text.
    }
  }
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}
