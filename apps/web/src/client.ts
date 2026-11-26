import { createClient, type AuthClient } from "@attijari-flare/auth/client";

import { ENV } from "./env.public";

export const authClient: AuthClient = createClient(ENV.VITE_SERVER_URL);
