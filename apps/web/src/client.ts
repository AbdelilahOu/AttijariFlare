import { createClient, type AuthClient } from "@finance-ttijari/auth/client";

import { ENV } from "./env.public";

export const authClient: AuthClient = createClient(ENV.VITE_SERVER_URL);
