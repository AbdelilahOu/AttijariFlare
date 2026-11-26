import type { AppRouterClient } from "@attijari-flare/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { getRequestEvent } from "@solidjs/web";
import { QueryCache, QueryClient } from "@tanstack/solid-query";

import { ENV } from "../env.public";

const link = new RPCLink({
  url: `${ENV.VITE_SERVER_URL.replace(/\/$/, "")}/rpc`,
  headers: () => getRequestEvent()?.request.headers ?? {},
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        console.error(`Error: ${error.message}`);
      },
    }),
  });
}
