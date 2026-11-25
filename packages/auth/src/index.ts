import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@finance-ttijari/db";
import * as schema from "@finance-ttijari/db/schema/auth";
import { seedDefaultCategories } from "@finance-ttijari/db/seed";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";

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
};

export function isSingleUserMode(value: AuthConfig["SINGLE_USER"]): boolean {
  if (value === undefined) return true;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const singleUser = isSingleUserMode(env.SINGLE_USER);

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
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
              console.error("Failed to seed default categories", error);
            }
          },
        },
      },
    },
    plugins: [],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
