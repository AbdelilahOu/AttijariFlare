import { createTestDb } from "@attijari-flare/db/testing";
import { describe, expect, test } from "vite-plus/test";

import { authRateLimitOptions, createAuth, IP_ADDRESS_HEADERS } from "./index";
import {
  AUTH_RATE_LIMIT_RULES,
  SENSITIVE_AUTH_PATHS,
  SENSITIVE_LIMIT,
  SIGN_IN_LIMIT,
  SIGN_IN_PATH,
  UPLOAD_LIMIT,
  consumeBinding,
  createAuthRateLimitStorage,
  pathOfKey,
  type RateLimitBinding,
} from "./rate-limit";

class FakeBinding implements RateLimitBinding {
  counts = new Map<string, number>();
  keys: string[] = [];
  fail = false;

  constructor(private readonly max: number) {}

  async limit({ key }: { key: string }) {
    if (this.fail) throw new Error("binding failed");
    this.keys.push(key);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { success: count <= this.max };
  }
}

describe("rules", () => {
  test("strict limits on the sensitive paths, nothing counted elsewhere", () => {
    expect(AUTH_RATE_LIMIT_RULES[SIGN_IN_PATH]).toEqual({ window: 60, max: 5 });
    for (const path of ["/sign-up/email", "/delete-user", "/change-password", "/reset-password"]) {
      expect(AUTH_RATE_LIMIT_RULES[path]).toEqual(SENSITIVE_LIMIT);
    }
    expect(Object.keys(AUTH_RATE_LIMIT_RULES).at(-1)).toBe("/**");
    expect(AUTH_RATE_LIMIT_RULES["/**"]).toBe(false);
    expect(UPLOAD_LIMIT.window).toBe(60);
    expect(IP_ADDRESS_HEADERS).toEqual(["cf-connecting-ip"]);
  });

  test("windows are periods the binding supports", () => {
    for (const rule of [SIGN_IN_LIMIT, SENSITIVE_LIMIT, UPLOAD_LIMIT]) {
      expect([10, 60]).toContain(rule.window);
    }
  });
});

describe("storage", () => {
  test("routes sign-in to its own binding and the rest to the sensitive one", async () => {
    const signIn = new FakeBinding(5);
    const sensitive = new FakeBinding(3);
    const storage = createAuthRateLimitStorage({ signIn, sensitive });
    await storage.consume(`203.0.113.7|${SIGN_IN_PATH}`, SIGN_IN_LIMIT);
    for (const path of SENSITIVE_AUTH_PATHS) {
      await storage.consume(`203.0.113.7|${path}`, SENSITIVE_LIMIT);
    }
    expect(signIn.keys).toEqual([`203.0.113.7|${SIGN_IN_PATH}`]);
    expect(sensitive.keys).toHaveLength(SENSITIVE_AUTH_PATHS.length);
  });

  test("refuses with the window as retry-after once the binding says no", async () => {
    const binding = new FakeBinding(1);
    expect(await consumeBinding(binding, "k", SENSITIVE_LIMIT)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await consumeBinding(binding, "k", SENSITIVE_LIMIT)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
  });

  test("lets the request through when the binding fails", async () => {
    const binding = new FakeBinding(1);
    binding.fail = true;
    expect((await consumeBinding(binding, "k", SENSITIVE_LIMIT)).allowed).toBe(true);
  });

  test("pathOfKey reads the path after the last separator", () => {
    expect(pathOfKey("2001:db8::1|/sign-in/email")).toBe("/sign-in/email");
  });
});

describe("better-auth", () => {
  test("is enabled with the bindings as storage", () => {
    const options = authRateLimitOptions({
      AUTH_SIGN_IN_LIMIT: new FakeBinding(5),
      AUTH_SENSITIVE_LIMIT: new FakeBinding(3),
    });
    expect(options.enabled).toBe(true);
    expect("customStorage" in options).toBe(true);
    expect(authRateLimitOptions({}).enabled).toBe(true);
  });

  test("answers 429 after 5 wrong sign-ins from one IP", async () => {
    const signIn = new FakeBinding(5);
    const auth = createAuth(
      {
        BETTER_AUTH_URL: "https://api.example.test",
        BETTER_AUTH_SECRET: "test-secret-not-real-0123456789abcdef",
        CORS_ORIGIN: "https://app.example.test",
        AUTH_SIGN_IN_LIMIT: signIn,
        AUTH_SENSITIVE_LIMIT: new FakeBinding(3),
      },
      await createTestDb(),
    );
    const attempt = (ip: string) =>
      auth.handler(
        new Request("https://api.example.test/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://app.example.test",
            "cf-connecting-ip": ip,
          },
          body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" }),
        }),
      );
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt("198.51.100.4")).status);
    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect((await attempt("198.51.100.5")).status).not.toBe(429);
    expect(signIn.keys.every((key) => key.endsWith("|/sign-in/email"))).toBe(true);
  });
});
