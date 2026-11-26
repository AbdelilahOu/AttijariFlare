import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vite-plus/test";

import {
  API_CSP,
  BASE_SECURITY_HEADERS,
  PDF_CSP,
  apiSecurityHeaders,
  createNonce,
  webContentSecurityPolicy,
  webSecurityHeaders,
  withHeaders,
} from "./security-headers";

const API_ORIGIN = "https://finance-pr-1-api.ar7al.dev";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

describe("web CSP", () => {
  const csp = directives(webContentSecurityPolicy({ nonce: "abc123", apiOrigin: API_ORIGIN }));

  test("scripts need the nonce and nothing unsafe", () => {
    expect(csp.get("script-src")).toEqual(["'self'", "'nonce-abc123'"]);
    expect([...csp.values()].flat()).not.toContain("'unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
    expect(csp.get("style-src")).not.toContain("'unsafe-inline'");
  });

  test("locks down the rest", () => {
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'", API_ORIGIN]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("font-src")).toEqual(["'self'"]);
  });

  test("allows the HMR websocket only in dev", () => {
    const dev = directives(
      webContentSecurityPolicy({ nonce: "n", apiOrigin: API_ORIGIN, dev: true }),
    );
    expect(dev.get("connect-src")).toContain("ws:");
    expect(csp.get("connect-src")).not.toContain("ws:");
  });

  test("page headers include the base headers and a CSP", () => {
    const headers = webSecurityHeaders({ nonce: "n", apiOrigin: API_ORIGIN });
    expect(headers).toMatchObject(BASE_SECURITY_HEADERS);
    expect(Object.keys(headers).some((name) => name.startsWith("Content-Security-Policy"))).toBe(
      true,
    );
  });
});

describe("API headers", () => {
  test("JSON responses load nothing", () => {
    expect(apiSecurityHeaders()["Content-Security-Policy"]).toBe(API_CSP);
    expect(directives(API_CSP).get("default-src")).toEqual(["'none'"]);
  });

  test("the PDF view allows only its own embedded viewer", () => {
    const pdf = directives(apiSecurityHeaders("pdf")["Content-Security-Policy"]!);
    expect(pdf.get("default-src")).toEqual(["'none'"]);
    expect(pdf.get("object-src")).toEqual(["'self'"]);
    expect(pdf.get("frame-ancestors")).toEqual(["'none'"]);
    expect(PDF_CSP).not.toContain("script-src");
  });
});

describe("base headers", () => {
  test("HSTS, nosniff, referrer, permissions and COOP", () => {
    expect(BASE_SECURITY_HEADERS["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(BASE_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(BASE_SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(BASE_SECURITY_HEADERS["Permissions-Policy"]).toContain(`${feature}=()`);
    }
    expect(BASE_SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  test("static assets get the same headers from _headers", () => {
    const file = readFileSync(
      fileURLToPath(new URL("../../../apps/web/public/_headers", import.meta.url).href),
      "utf8",
    ).replaceAll("\r\n", "\n");
    for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
      expect(file).toContain(`  ${name}: ${value}\n`);
    }
  });
});

describe("helpers", () => {
  test("nonces are random base64", () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(nonce);
  });

  test("withHeaders copies responses with immutable headers", () => {
    const result = withHeaders(Response.redirect("https://example.test/", 302), { "X-Test": "1" });
    expect(result.headers.get("X-Test")).toBe("1");
    expect(result.status).toBe(302);
  });
});
