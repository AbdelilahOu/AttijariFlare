import { createAuth as createConfiguredAuth } from "@attijari-flare/auth";
import { type Database, createDb } from "@attijari-flare/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
