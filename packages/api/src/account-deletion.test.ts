import { createAuth } from "@attijari-flare/auth";
import type { Database } from "@attijari-flare/db";
import { account, categories, session, user } from "@attijari-flare/db/schema/index";
import { createTestDb } from "@attijari-flare/db/testing";
import { describe, expect, it } from "vite-plus/test";

// Made-up account. Runs better-auth's real delete-user endpoint against the migrated schema.

const config = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-for-account-deletion-test-only-0123456789",
  CORS_ORIGIN: "http://localhost:3001",
  SINGLE_USER: "false",
  SIGNUPS_ENABLED: "true",
};
const credentials = { name: "Exemple", email: "exemple@example.test", password: "exemple-pass-1" };

async function signedUp(db: Database, purge: (userId: string) => Promise<void>) {
  const auth = createAuth(config, db, [], { purgeUserData: purge });
  const response = await auth.api.signUpEmail({ body: credentials, asResponse: true });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const headers = new Headers({ cookie, origin: config.CORS_ORIGIN });
  return { auth, headers };
}

describe("account deletion (better-auth delete-user)", () => {
  it("runs the purge first, then deletes the user, sessions and credentials", async () => {
    const db = await createTestDb();
    const purged: string[] = [];
    const { auth, headers } = await signedUp(db, async (userId) => {
      // The user row must still exist while the purge runs.
      expect((await db.select().from(user)).map((row) => row.id)).toContain(userId);
      purged.push(userId);
    });
    // The session hook seeded default categories for the new user.
    expect((await db.select().from(categories)).length).toBeGreaterThan(0);

    await expect(
      auth.api.deleteUser({ headers, body: { password: "wrong-password" } }),
    ).rejects.toThrow();
    expect(purged).toEqual([]);

    await auth.api.deleteUser({ headers, body: { password: credentials.password } });
    expect(purged).toHaveLength(1);
    expect(await db.select().from(user)).toEqual([]);
    expect(await db.select().from(session)).toEqual([]);
    expect(await db.select().from(account)).toEqual([]);
  });

  it("keeps the account when the purge fails, so the user can retry", async () => {
    const db = await createTestDb();
    const { auth, headers } = await signedUp(db, async () => {
      throw new Error("R2 unavailable");
    });
    await expect(
      auth.api.deleteUser({ headers, body: { password: credentials.password } }),
    ).rejects.toThrow();
    expect(await db.select().from(user)).toHaveLength(1);
  });
});
