export type RateLimitRule = {
  window: number;
  max: number;
};

export type RateLimitDecision =
  | { allowed: true; retryAfter: null }
  | { allowed: false; retryAfter: number };

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type AuthRateLimitBindings = {
  signIn: RateLimitBinding;
  sensitive: RateLimitBinding;
};

// Must match the `simple` config of the bindings in packages/infra/alchemy.*.ts.
export const SIGN_IN_LIMIT: RateLimitRule = { window: 60, max: 5 };
export const SENSITIVE_LIMIT: RateLimitRule = { window: 60, max: 3 };
export const UPLOAD_LIMIT: RateLimitRule = { window: 60, max: 3 };

export const SIGN_IN_PATH = "/sign-in/email";

export const SENSITIVE_AUTH_PATHS = [
  "/sign-up/email",
  "/delete-user",
  "/change-password",
  "/change-email",
  "/request-password-reset",
  "/forget-password",
  "/reset-password",
  "/send-verification-email",
] as const;

export const AUTH_RATE_LIMIT_RULES: Record<string, RateLimitRule | false> = {
  [SIGN_IN_PATH]: SIGN_IN_LIMIT,
  ...Object.fromEntries(SENSITIVE_AUTH_PATHS.map((path) => [path, SENSITIVE_LIMIT])),
  "/**": false,
};

export async function consumeBinding(
  binding: RateLimitBinding,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitDecision> {
  try {
    const { success } = await binding.limit({ key });
    return success
      ? { allowed: true, retryAfter: null }
      : { allowed: false, retryAfter: rule.window };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "rate-limit.error",
        error: error instanceof Error ? error.name : typeof error,
      }),
    );
    return { allowed: true, retryAfter: null };
  }
}

export function pathOfKey(key: string): string {
  return key.slice(key.lastIndexOf("|") + 1);
}

export function createAuthRateLimitStorage(bindings: AuthRateLimitBindings) {
  return {
    consume(key: string, rule: RateLimitRule) {
      const binding = pathOfKey(key) === SIGN_IN_PATH ? bindings.signIn : bindings.sensitive;
      return consumeBinding(binding, key, rule);
    },
  };
}
