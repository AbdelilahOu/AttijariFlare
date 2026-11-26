export type RateLimitRule = {
  window: number;
  max: number;
};

export type RateLimitDecision =
  | { allowed: true; retryAfter: null }
  | { allowed: false; retryAfter: number };

export type RateLimitKV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export const MIN_KV_TTL_SECONDS = 60;

export const SENSITIVE_AUTH_RULES = {
  "/sign-in/email": { window: 60, max: 5 },
  "/sign-up/email": { window: 600, max: 3 },
  "/delete-user": { window: 600, max: 5 },
  "/change-password": { window: 600, max: 5 },
  "/change-email": { window: 600, max: 3 },
  "/request-password-reset": { window: 600, max: 3 },
  "/forget-password": { window: 600, max: 3 },
  "/reset-password": { window: 600, max: 5 },
  "/send-verification-email": { window: 600, max: 3 },
} as const satisfies Record<string, RateLimitRule>;

export const AUTH_RATE_LIMIT_RULES: Record<string, RateLimitRule | false> = {
  ...SENSITIVE_AUTH_RULES,
  "/**": false,
};

export const UPLOAD_RATE_LIMIT: RateLimitRule = { window: 600, max: 10 };

type Counter = { count: number; windowStart: number };

function parseCounter(value: string | null): Counter | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Counter>;
    if (typeof parsed.count === "number" && typeof parsed.windowStart === "number") {
      return { count: parsed.count, windowStart: parsed.windowStart };
    }
  } catch {}
  return null;
}

export function decide(
  stored: Counter | null,
  rule: RateLimitRule,
  now: number,
): { next: Counter | null; decision: RateLimitDecision } {
  const windowMs = rule.window * 1000;
  if (!stored || now - stored.windowStart >= windowMs || now < stored.windowStart) {
    return { next: { count: 1, windowStart: now }, decision: { allowed: true, retryAfter: null } };
  }
  if (stored.count >= rule.max) {
    const retryAfter = Math.max(1, Math.ceil((stored.windowStart + windowMs - now) / 1000));
    return { next: null, decision: { allowed: false, retryAfter } };
  }
  return {
    next: { count: stored.count + 1, windowStart: stored.windowStart },
    decision: { allowed: true, retryAfter: null },
  };
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function logRateLimitError(stage: "read" | "write", error: unknown) {
  console.error(
    JSON.stringify({
      event: `rate-limit.${stage}-error`,
      error: error instanceof Error ? error.name : typeof error,
    }),
  );
}

export type RateLimiter = {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
};

export function createRateLimiter(
  kv: RateLimitKV,
  secret: string,
  now: () => number = Date.now,
): RateLimiter {
  let signingKey: Promise<CryptoKey> | undefined;
  const storageKey = async (key: string) => {
    signingKey ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", await signingKey, encoder.encode(key));
    return `rl:${toHex(signature)}`;
  };

  return {
    async consume(key, rule) {
      const hashed = await storageKey(key);
      const at = now();
      let stored: Counter | null;
      try {
        stored = parseCounter(await kv.get(hashed));
      } catch (error) {
        logRateLimitError("read", error);
        return { allowed: true, retryAfter: null };
      }
      const { next, decision } = decide(stored, rule, at);
      if (!next) return decision;
      const remainingMs = next.windowStart + rule.window * 1000 - at;
      const expirationTtl = Math.max(MIN_KV_TTL_SECONDS, Math.ceil(remainingMs / 1000));
      try {
        await kv.put(hashed, JSON.stringify(next), { expirationTtl });
      } catch (error) {
        logRateLimitError("write", error);
        return { allowed: false, retryAfter: 1 };
      }
      return decision;
    },
  };
}
