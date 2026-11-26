import { getRequestEvent } from "@solidjs/web";

/** Production origin. Canonical URLs always point here, also from preview deploys. */
export const SITE_URL = "https://finance.ar7al.dev";
export const SITE_HOST = new URL(SITE_URL).host;
export const SITE_NAME = "AttijariFlare";
export const OG_IMAGE = `${SITE_URL}/og.png`;

/** Hostname of the current request on the server, or of the page in the browser. */
export function currentHost(): string | undefined {
  if (typeof window !== "undefined") return window.location.host;
  const url = getRequestEvent()?.request.url;
  return url ? new URL(url).host : undefined;
}

/**
 * Only the production host may be indexed. Previews (finance-pr-*.ar7al.dev) and local dev
 * get noindex so they never compete with production in search results.
 */
export function isIndexableHost(host: string | undefined = currentHost()): boolean {
  return host === SITE_HOST;
}

export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path === "/" ? "/" : path}`;
}
