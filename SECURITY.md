# Security

> Not legal advice. This describes the security measures in the code and deployment, to help
> the operator document them (for example in a CNDP declaration). It is not a certification.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability
reporting on this repository (Security tab, "Report a vulnerability"), or write to the security
contact **contact@ar7al.dev**. Include the steps to reproduce and the impact. Do
not access other users' data to prove a finding: a test account of your own is enough.

## Measures

### Authentication and sessions (`packages/auth/src/index.ts`)

- better-auth email and password. Passwords are hashed with scrypt (better-auth default).
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, host-only on the API hostname (no
  `Domain` attribute). Sessions expire after 7 days.
- `trustedOrigins` is the web origin only. CORS on the API allows that origin only, with
  credentials, for `GET`, `POST` and `OPTIONS`.
- Account deletion requires the password again.
- Rate limiting (`packages/auth/src/rate-limit.ts`): on in every stage, counted by Cloudflare's
  Workers Rate Limiting bindings (free, shared by all isolates of a Cloudflare location). Per
  client IP (`cf-connecting-ip`, set by Cloudflare): 5 sign-in attempts per minute, and 3 per
  minute for sign-up, account deletion, password and email change, and password reset. Over the
  limit, better-auth answers 429 and the forms say "Too many attempts, try again in a minute."
  Counters live only in Cloudflare's rate limiter for the one-minute window; the app stores
  nothing and never logs IPs.
- Uploads (`POST /api/statements`) are limited to 3 per user per minute, to protect the Workers
  AI quota.
- Counts are per Cloudflare location and the binding allows only 10- or 60-second periods, so a
  client spread over many locations gets more attempts. Revisit (for example counters in D1)
  before sign-ups reopen.

### Authorization

- Every oRPC procedure that reads or writes user data is a `protectedProcedure` and every query
  is filtered by the session's user id. The Hono routes for upload and PDF view check the
  session and ownership the same way. The audit is in `docs/privacy-audit.md` section 3.
- Vectorize queries filter on `user_id`.

### Storage

- R2: the bucket is private (no `r2.dev` URL, no custom domain, no CORS rules). PDFs are only
  reachable through `GET /api/statements/:id/original`, which checks the session and the owner
  and answers with `Cache-Control: private, no-store` and the security headers below.
- D1, R2, Queues and Vectorize are bound to the Worker only; there are no API keys for them in
  the app.
- Each stage (local dev, each pull request preview, prod) has its own D1, R2, queues and
  Vectorize index, so previews never touch production data.
- D1, R2 and every queue are in the `eu` jurisdiction in every stage, so their data is stored
  only in the EU. Vectorize, Workers AI and the Workers have no jurisdiction option (see
  `PRIVACY.md`).
- Encryption at rest and in transit inside Cloudflare is Cloudflare's; the app adds none.

### Transport

- HTTPS only, on Workers custom domains with Cloudflare-managed certificates (`*.ar7al.dev`).
  The session cookie is `Secure`.

### Security headers (`packages/api/src/security-headers.ts`)

- Both workers: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (every
  `ar7al.dev` host is proxied over HTTPS and the zone has "Always Use HTTPS" on; not preloaded),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` with camera, microphone, geolocation, payment and USB off, and
  `Cross-Origin-Opener-Policy: same-origin`.
- Web pages (`apps/web/src/middleware.ts`): a CSP with `default-src 'self'`, scripts and
  `<style>` elements allowed by a per-request nonce only (no `unsafe-inline`, no `unsafe-eval`),
  `connect-src` limited to the stage's API, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'` and `form-action 'self'`. Style attributes are allowed
  (`style-src-attr 'unsafe-inline'`): components render dynamic colors and widths during SSR, and
  style attributes cannot run script. Static files get the same base headers from
  `apps/web/public/_headers`.
- API: `default-src 'none'; frame-ancestors 'none'`. The inline PDF view also allows
  `object-src 'self'`, which Chrome's PDF viewer needs. The browsable API reference at
  `/api-reference` loads its UI from a CDN and is blocked by this policy; its JSON spec still
  works.

### Logging

- Logs hold ids, counts, timings and redacted error kinds only (`packages/api/src/log.ts`):
  never statement text, descriptions, amounts, names, emails, prompts, model answers, query
  parameters or URL query strings. Workers invocation logs are off.

### Secrets and CI

- `BETTER_AUTH_SECRET` comes from GitHub environments (`production`) and repository secrets
  (previews), passed to the Worker as a redacted Alchemy config value. No secret is committed;
  local secrets live in `.env` files ignored by git, described by `.env.schema` files.
- Production deploys run only from `.github/workflows/production.yml` on push to `main`;
  `alchemy.prod.ts` refuses to run outside GitHub Actions.
- Workflows request `contents: read` (and `pull-requests: write` for the preview comment).
  Preview deploys are skipped for forks, so fork code never gets secrets.
- The Cloudflare API token should be limited to the one account and to what Alchemy manages:
  Workers Scripts, Workers custom domains on the `ar7al.dev` zone, D1, R2, Queues, Vectorize,
  Workers AI and Secrets Store (for Alchemy state). Review its scopes in the Cloudflare dashboard;
  they are not visible from the repository.
- No telemetry: the app has none, better-auth telemetry is pinned off, and both workflows set
  `ALCHEMY_TELEMETRY_DISABLED=1`. For local runs, export `DO_NOT_TRACK=1` (or
  `ALCHEMY_TELEMETRY_DISABLED=1`) to stop the Alchemy CLI's telemetry.

### Backups and recovery

- D1 Time Travel allows restoring the database to any minute of the last 7 days on the Workers
  Free plan (30 days on Paid): https://developers.cloudflare.com/d1/reference/time-travel/.
  This is also why deleted rows can be recovered by the operator for that long.
- R2 has no versioning enabled: a deleted PDF cannot be restored. There are no other backups.
