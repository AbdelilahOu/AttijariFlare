/** True for a D1/SQLite UNIQUE constraint violation, including ones wrapped in `cause`. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if (current instanceof Error && current.message.includes("UNIQUE constraint failed")) {
      return true;
    }
    if (typeof current !== "object") break;
  }
  return false;
}
