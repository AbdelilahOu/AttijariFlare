import type { Session } from "@finance-ttijari/auth";
import type { Database } from "@finance-ttijari/db";

import type { Bindings } from "./bindings";

export type Context = {
  session: Session | null;
  db: Database;
  env: Bindings;
};
