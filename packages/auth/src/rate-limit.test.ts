import { describe, expect, test } from "vite-plus/test";

import { authLimiterFor, type RateLimiter } from "./rate-limit";

const limiter = (): RateLimiter => ({ limit: async () => ({ success: true }) });

describe("authLimiterFor", () => {
  const env = { AUTH_SIGN_IN_LIMIT: limiter(), AUTH_SENSITIVE_LIMIT: limiter() };

  test("sign-in uses the sign-in limiter", () => {
    expect(authLimiterFor("/sign-in/email", env)).toBe(env.AUTH_SIGN_IN_LIMIT);
  });

  test("sensitive paths use the sensitive limiter", () => {
    for (const path of ["/sign-up/email", "/delete-user", "/change-password", "/reset-password"]) {
      expect(authLimiterFor(path, env)).toBe(env.AUTH_SENSITIVE_LIMIT);
    }
  });

  test("other paths are not limited", () => {
    expect(authLimiterFor("/get-session", env)).toBeUndefined();
    expect(authLimiterFor("/sign-out", env)).toBeUndefined();
  });
});
