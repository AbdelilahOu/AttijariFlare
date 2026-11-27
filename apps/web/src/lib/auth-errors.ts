/** Shown when the API answers 429 (rate limit, apps/server/src/index.ts). */
export const TOO_MANY_ATTEMPTS = "Too many attempts, try again in a minute.";

/** A user-facing message for a better-auth client error. */
export function authErrorMessage(
  error: { status?: number; message?: string } | null | undefined,
  fallback: string,
): string {
  if (error?.status === 429) return TOO_MANY_ATTEMPTS;
  return error?.message || fallback;
}
