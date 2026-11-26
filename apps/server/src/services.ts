import { logError } from "@attijari-flare/api/log";
import { purgeUserData } from "@attijari-flare/api/privacy";
import { createAuth as createConfiguredAuth } from "@attijari-flare/auth";
import { type Database, createDb } from "@attijari-flare/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}

export async function createAuth(database?: Database) {
  const db = database ?? (await getDb());
  return createConfiguredAuth(ENV, db, [], {
    purgeUserData: async (userId) => {
      const startedAt = Date.now();
      try {
        const result = await purgeUserData({ db, env: ENV }, userId);
        // Counts only.
        console.log(
          JSON.stringify({ event: "account.purge.done", ms: Date.now() - startedAt, ...result }),
        );
      } catch (error) {
        logError("account.purge.error", error);
        throw error;
      }
    },
  });
}
