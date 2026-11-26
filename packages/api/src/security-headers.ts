export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function serializeCsp(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export type WebCspOptions = {
  nonce: string;
  apiOrigin: string;
  dev?: boolean;
};

export function webContentSecurityPolicy({ nonce, apiOrigin, dev = false }: WebCspOptions): string {
  const nonceSource = `'nonce-${nonce}'`;
  const connect = ["'self'", apiOrigin];
  if (dev) connect.push("ws:", "wss:");
  return serializeCsp({
    "default-src": ["'self'"],
    "script-src": ["'self'", nonceSource],
    "style-src": ["'self'", nonceSource],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    "connect-src": connect,
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
  });
}

export const WEB_CSP_HEADER = "Content-Security-Policy-Report-Only";

export function webSecurityHeaders(options: WebCspOptions): Record<string, string> {
  return { ...BASE_SECURITY_HEADERS, [WEB_CSP_HEADER]: webContentSecurityPolicy(options) };
}

export const API_CSP = serializeCsp({
  "default-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
});

export const PDF_CSP = serializeCsp({
  "default-src": ["'none'"],
  "object-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
});

export function apiSecurityHeaders(kind: "json" | "pdf" = "json"): Record<string, string> {
  return {
    ...BASE_SECURITY_HEADERS,
    "Content-Security-Policy": kind === "pdf" ? PDF_CSP : API_CSP,
  };
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function withHeaders(response: Response, headers: Record<string, string>): Response {
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
    return copy;
  }
}
