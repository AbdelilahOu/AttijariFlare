import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";

import { isIndexableHost } from "~/lib/seo";

const handleAPI = createAPIHandler(routes);

// Every response from a non-production host (preview deploys, local dev) carries
// X-Robots-Tag: noindex, so previews never compete with production in search results.
export default (async (event, next) => {
  const response = await handleAPI(event.request, next);
  if (isIndexableHost(new URL(event.request.url).host)) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}) satisfies StartMiddleware;
