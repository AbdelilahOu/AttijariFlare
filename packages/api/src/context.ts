import type { Session } from "@finance-ttijari/auth";
import type { Database } from "@finance-ttijari/db";

export type Context = {
  session: Session | null;
  db: Database;
};
