import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@attijari-flare/db";
import * as schema from "@attijari-flare/db/schema/auth";
import { seedDefaultCategories } from "@attijari-flare/db/seed";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";

import {
  AUTH_RATE_LIMIT_RULES,
  createAuthRateLimitStorage,
  type RateLimitBinding,
} from "./rate-limit";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  /**
   * Single-user guard. When enabled (the default), creating a user is refused once
   * any user exists, which disables email sign-up after the owner has registered.
   * Set to "false" to allow additional sign-ups.
   */
  SINGLE_USER?: string | boolean;
  /**
   * Master sign-up switch. Off unless explicitly set to "true": email sign-up is then
   * refused by better-auth itself and any user creation is blocked, while existing
   * accounts keep signing in. When on, the SINGLE_USER guard still applies.
   */
  SIGNUPS_ENABLED?: string | boolean;
  AUTH_SIGN_IN_LIMIT?: RateLimitBinding;
  AUTH_SENSITIVE_LIMIT?: RateLimitBinding;
};

export function isSingleUserMode(value: AuthConfig["SINGLE_USER"]): boolean {
  if (value === undefined) return true;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function isSignupsEnabled(value: AuthConfig["SIGNUPS_ENABLED"]): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

export function authRateLimitOptions(
  env: Pick<AuthConfig, "AUTH_SIGN_IN_LIMIT" | "AUTH_SENSITIVE_LIMIT">,
) {
  const storage =
    env.AUTH_SIGN_IN_LIMIT && env.AUTH_SENSITIVE_LIMIT
      ? {
          customStorage: createAuthRateLimitStorage({
            signIn: env.AUTH_SIGN_IN_LIMIT,
            sensitive: env.AUTH_SENSITIVE_LIMIT,
          }),
        }
      : { storage: "memory" as const };
  return {
    enabled: true,
    window: 60,
    max: 100,
    customRules: AUTH_RATE_LIMIT_RULES,
    ...storage,
  };
}

export const IP_ADDRESS_HEADERS = ["cf-connecting-ip"];

export type AuthHooks = {
  /**
   * Deletes everything the user owns outside the auth tables (R2, Vectorize, finance rows).
   * Runs before better-auth deletes the user; a throw aborts the deletion so it can be
   * retried, and nothing of the user is left half-deleted in the auth tables.
   */
  purgeUserData?: (userId: string) => Promise<void>;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
  hooks: AuthHooks = {},
) {
  const singleUser = isSingleUserMode(env.SINGLE_USER);
  const signupsEnabled = isSignupsEnabled(env.SIGNUPS_ENABLED);

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true, disableSignUp: !signupsEnabled },
    // better-auth's telemetry is off unless enabled; pinned off so an env var cannot turn it on.
    telemetry: { enabled: false },
    rateLimit: authRateLimitOptions(env),
    user: {
      // "Delete my account" (apps/web shell). The client sends the password, which
      // better-auth verifies before calling beforeDelete; sessions are deleted with the user.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          if (!hooks.purgeUserData) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Account deletion is not configured on this server.",
            });
          }
          await hooks.purgeUserData(user.id);
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS },
      defaultCookieAttributes: {
        // Web and API share the registrable domain (ar7al.dev, or localhost in dev), so requests
        // from the web app to the API are same-site and Lax cookies are sent. The cookie has no
        // Domain attribute, so it stays host-only on the API hostname of its own stage.
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            // Second line of defence behind disableSignUp: no code path may create a user.
            if (!signupsEnabled) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is disabled on this instance." });
            }
            if (!singleUser) return;
            const existing = await database
              .select({ id: schema.user.id })
              .from(schema.user)
              .limit(1);
            if (existing.length > 0) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-up is disabled: this instance already has a user.",
              });
            }
          },
        },
      },
      session: {
        create: {
          // Runs on every sign-in (including the automatic one after sign-up).
          // The seed is idempotent, so only the first call inserts rows.
          after: async (session) => {
            try {
              await seedDefaultCategories(database, session.userId);
            } catch (error) {
              // Only the error kind: a Drizzle error message lists the query's bound values.
              console.error(
                JSON.stringify({
                  event: "auth.seed-categories-error",
                  error: error instanceof Error ? error.name : typeof error,
                }),
              );
            }
          },
        },
      },
    },
    plugins: [],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
