import { createTestDb } from "@attijari-flare/db/testing";
import { describe, expect, test } from "vite-plus/test";

import { authRateLimitOptions, createAuth, IP_ADDRESS_HEADERS } from "./index";
import {
  AUTH_RATE_LIMIT_RULES,
  MIN_KV_TTL_SECONDS,
  SENSITIVE_AUTH_RULES,
  UPLOAD_RATE_LIMIT,
  createRateLimiter,
  decide,
  type RateLimitKV,
} from "./rate-limit";

class FakeKV implements RateLimitKV {
  entries = new Map<string, { value: string; ttl?: number }>();
  failGets = false;
  failPuts = false;

  async get(key: string) {
    if (this.failGets) throw new Error("get failed");
    return this.entries.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    if (this.failPuts) throw new Error("put failed");
    this.entries.set(key, { value, ttl: options?.expirationTtl });
  }
}

const SECRET = "test-secret-not-real-0123456789abcdef";
const RULE = { window: 60, max: 3 };

describe("decide", () => {
  test("starts a window, counts up to max, then refuses", () => {
    const first = decide(null, RULE, 1_000);
    expect(first.next).toEqual({ count: 1, windowStart: 1_000 });
    expect(decide({ count: 2, windowStart: 1_000 }, RULE, 2_000).decision.allowed).toBe(true);
    const over = decide({ count: 3, windowStart: 1_000 }, RULE, 31_000);
    expect(over.next).toBeNull();
    expect(over.decision).toEqual({ allowed: false, retryAfter: 30 });
  });

  test("resets once the window is over", () => {
    const reset = decide({ count: 3, windowStart: 1_000 }, RULE, 61_000);
    expect(reset.decision.allowed).toBe(true);
    expect(reset.next).toEqual({ count: 1, windowStart: 61_000 });
  });
});

describe("createRateLimiter", () => {
  test("refuses past max and never stores the raw key", async () => {
    const kv = new FakeKV();
    let now = 0;
    const limiter = createRateLimiter(kv, SECRET, () => now);
    const key = "203.0.113.7|/sign-in/email";
    const results = [];
    for (let i = 0; i < 5; i++) {
      now += 1_000;
      results.push((await limiter.consume(key, RULE)).allowed);
    }
    expect(results).toEqual([true, true, true, false, false]);
    const [storedKey] = [...kv.entries.keys()];
    expect(storedKey).toMatch(/^rl:[0-9a-f]{64}$/);
    expect(storedKey).not.toContain("203.0.113.7");
    expect(kv.entries.get(storedKey!)!.value).not.toContain("203.0.113.7");
  });

  test("keys differ per client and per path", async () => {
    const kv = new FakeKV();
    const limiter = createRateLimiter(kv, SECRET);
    await limiter.consume("203.0.113.7|/sign-in/email", RULE);
    await limiter.consume("203.0.113.8|/sign-in/email", RULE);
    await limiter.consume("203.0.113.7|/delete-user", RULE);
    expect(kv.entries.size).toBe(3);
  });

  test("allows again after the window", async () => {
    const kv = new FakeKV();
    let now = 0;
    const limiter = createRateLimiter(kv, SECRET, () => now);
    for (let i = 0; i < 3; i++) await limiter.consume("k", RULE);
    expect((await limiter.consume("k", RULE)).allowed).toBe(false);
    now = 60_000;
    expect((await limiter.consume("k", RULE)).allowed).toBe(true);
  });

  test("uses a TTL of at least the KV minimum", async () => {
    const kv = new FakeKV();
    const limiter = createRateLimiter(kv, SECRET);
    await limiter.consume("k", { window: 600, max: 1 });
    await limiter.consume("j", { window: 60, max: 1 });
    const ttls = [...kv.entries.values()].map((entry) => entry.ttl);
    expect(ttls).toEqual([600, 60]);
    expect(Math.min(...(ttls as number[]))).toBeGreaterThanOrEqual(MIN_KV_TTL_SECONDS);
  });

  test("refuses when the write fails and allows when the read fails", async () => {
    const kv = new FakeKV();
    const limiter = createRateLimiter(kv, SECRET);
    kv.failPuts = true;
    expect(await limiter.consume("k", RULE)).toEqual({ allowed: false, retryAfter: 1 });
    kv.failPuts = false;
    kv.failGets = true;
    expect((await limiter.consume("k", RULE)).allowed).toBe(true);
  });
});

describe("auth rate-limit config", () => {
  test("is enabled with KV storage and strict rules", () => {
    const options = authRateLimitOptions({ RATE_LIMITS: new FakeKV(), BETTER_AUTH_SECRET: SECRET });
    expect(options.enabled).toBe(true);
    expect("customStorage" in options).toBe(true);
    expect(SENSITIVE_AUTH_RULES["/sign-in/email"]).toEqual({ window: 60, max: 5 });
    for (const path of ["/sign-up/email", "/delete-user", "/change-password", "/reset-password"]) {
      expect(AUTH_RATE_LIMIT_RULES[path]).toBeTruthy();
    }
    for (const rule of Object.values(SENSITIVE_AUTH_RULES)) {
      expect(rule.window).toBeGreaterThanOrEqual(MIN_KV_TTL_SECONDS);
    }
    expect(UPLOAD_RATE_LIMIT.window).toBeGreaterThanOrEqual(MIN_KV_TTL_SECONDS);
    expect(Object.keys(AUTH_RATE_LIMIT_RULES).at(-1)).toBe("/**");
    expect(IP_ADDRESS_HEADERS).toEqual(["cf-connecting-ip"]);
  });

  test("better-auth answers 429 after 5 wrong sign-ins from one IP", async () => {
    const kv = new FakeKV();
    const auth = createAuth(
      {
        BETTER_AUTH_URL: "https://api.example.test",
        BETTER_AUTH_SECRET: SECRET,
        CORS_ORIGIN: "https://app.example.test",
        RATE_LIMITS: kv,
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
  });
});
