import { createAuth as createConfiguredAuth } from "@finance-ttijari/auth";
import { type Database, createDb } from "@finance-ttijari/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
