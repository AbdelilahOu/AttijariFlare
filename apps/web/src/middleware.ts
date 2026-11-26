import {
  BASE_SECURITY_HEADERS,
  createNonce,
  webSecurityHeaders,
  withHeaders,
} from "@attijari-flare/api/security-headers";
import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";

import { ENV } from "~/env.public";
import { isIndexableHost } from "~/lib/seo";

const handleAPI = createAPIHandler(routes);
const apiOrigin = new URL(ENV.VITE_SERVER_URL).origin;

// Previews get noindex; event.nonce must be set before next() runs the render.
export default (async (event, next) => {
  const nonce = createNonce();
  event.nonce = nonce;
  const response = await handleAPI(event.request, next);

  const isHtml = response.headers.get("Content-Type")?.startsWith("text/html") ?? false;
  const headers: Record<string, string> = isHtml
    ? webSecurityHeaders({ nonce, apiOrigin, dev: import.meta.env.DEV })
    : { ...BASE_SECURITY_HEADERS };
  if (!isIndexableHost(new URL(event.request.url).host)) {
    headers["X-Robots-Tag"] = "noindex, nofollow";
  }
  return withHeaders(response, headers);
}) satisfies StartMiddleware;
