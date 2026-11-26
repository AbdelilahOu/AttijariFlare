// Test helper: an in-memory SQLite database (libsql) with every migration applied, typed as
// the app's D1 `Database`. Drizzle's SQLite query builder is the same for both drivers, so
// the queries under test run unchanged. Not for production code.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "./index";
import { relations } from "./relations";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function createTestDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  // D1 enforces foreign keys; so does the test database.
  await client.execute("PRAGMA foreign_keys = ON");
  const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(MIGRATIONS, folder, "migration.sql"), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement);
    }
  }
  return drizzle({ client, relations }) as unknown as Database;
}
