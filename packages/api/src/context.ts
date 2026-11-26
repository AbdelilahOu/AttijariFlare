import type { Session } from "@attijari-flare/auth";
import type { Database } from "@attijari-flare/db";

import type { Bindings } from "./bindings";

export type Context = {
  session: Session | null;
  db: Database;
  env: Bindings;
};
