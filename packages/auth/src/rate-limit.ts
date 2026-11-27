export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type AuthRateLimiters = {
  AUTH_SIGN_IN_LIMIT: RateLimiter;
  AUTH_SENSITIVE_LIMIT: RateLimiter;
};

const SENSITIVE_AUTH_PATHS = new Set([
  "/sign-up/email",
  "/delete-user",
  "/change-password",
  "/change-email",
  "/request-password-reset",
  "/forget-password",
  "/reset-password",
  "/send-verification-email",
]);

/** The limiter for a better-auth path (without the `/api/auth` prefix), or none. */
export function authLimiterFor(path: string, env: AuthRateLimiters): RateLimiter | undefined {
  if (path === "/sign-in/email") return env.AUTH_SIGN_IN_LIMIT;
  if (SENSITIVE_AUTH_PATHS.has(path)) return env.AUTH_SENSITIVE_LIMIT;
  return undefined;
}
