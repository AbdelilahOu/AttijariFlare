# AttijariFlare

Personal finance tracker for Attijariwafa bank statements: upload a PDF, it's extracted and
categorized automatically (Workers AI + merchant-embedding kNN), and the dashboard reports on
spend, allocations, and what needs review.

Built on [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack) (Solid, Hono, ORPC), deployed entirely on Cloudflare.

## Features

- **TypeScript**, **Solid** (file-based routing, SSR), **TailwindCSS**
- **Hono** + **oRPC** (typed, OpenAPI) on **Workers**
- **Drizzle** + **Cloudflare D1**
- **Better-Auth**
- **Vite+** — toolchain, task runner, lint/format

## Getting Started

```bash
bun install
bun run db:generate   # generate migrations
bun run dev           # web: localhost:3001, api: localhost:3000
```

Runtime DB access uses the Cloudflare `DB` binding (`packages/infra/alchemy.*.ts`). A local
`DATABASE_URL`, if present, is only for tooling. Alchemy provisions D1 and applies migrations
on deploy.

## Cloudflare Resources

Provisioned entirely by `packages/infra/alchemy.*.ts` — don't create resources via wrangler or the dashboard.

| Binding            | Resource                              | Used for                           |
| ------------------ | ------------------------------------- | ---------------------------------- |
| `DB`               | D1 database                           | All application data               |
| `STATEMENTS`       | R2 bucket `statements`                | Original PDFs, extraction output   |
| `STATEMENT_INGEST` | Queue (+ DLQ)                         | Upload → AI extraction             |
| `TXN_ENRICH`       | Queue (+ DLQ)                         | Extraction → categorization        |
| `VECTORIZE`        | Index `merchants` (1024 dims, cosine) | Merchant embeddings (`bge-m3`)     |
| `AI`               | Workers AI                            | toMarkdown, extraction, embeddings |

The server worker consumes both queues (batch 1, concurrency 1, 3 retries, then DLQ), dispatching
on `*_QUEUE_NAME` since Alchemy gives each queue a stage-suffixed physical name. DLQs have no
consumer — inspect them in the dashboard. Routers get bindings via `context.env`; queue handlers
via their `env` arg.

## Environment Configuration

Each app has its own `.env.schema`; Varlock generates `src/env.ts` from it (`bun run env:generate`
after changing a schema). Commit schemas, keep secrets out of git. Import the generated `ENV`
accessor in app code — shared packages (db, auth) take config as arguments instead of reading env
directly. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Alchemy loads/validates deploy-time env with `varlock/auto-load`; Workers read native bindings at
runtime. Bun's auto env loading is off (`bunfig.toml`) — the server bootstrap loads Varlock
explicitly. Run Varlock-based tools from the owning app directory.

## Deployment

One Alchemy entry file per stage in `packages/infra` (deliberately duplicated — keep them in sync
when adding a resource). The stage name is baked into every physical resource name, so each stage
gets its own D1, R2, queues, and Vectorize index.

| Stage        | Entry file           | Web                        | API                            | Runs from                          |
| ------------ | -------------------- | -------------------------- | ------------------------------ | ---------------------------------- |
| `dev_<user>` | `alchemy.dev.ts`     | `localhost:3001`           | `localhost:3000`               | `bun run dev`, local only          |
| `pr-<n>`     | `alchemy.preview.ts` | `finance-pr-<n>.ar7al.dev` | `finance-pr-<n>-api.ar7al.dev` | `.github/workflows/preview.yml`    |
| `prod`       | `alchemy.prod.ts`    | `finance.ar7al.dev`        | `finance-api.ar7al.dev`        | `.github/workflows/production.yml` |

Hostnames are one subdomain level deep (free Universal SSL covers `*.ar7al.dev` only) and are
Workers custom domains on the `ar7al.dev` zone — Cloudflare manages the DNS/certs. `CORS_ORIGIN`,
`BETTER_AUTH_URL` and `VITE_SERVER_URL` are all derived from the stage's hostnames, not set by hand.

- **Local dev**: `bun run dev` runs `alchemy dev`; never deploys, no custom domains, reads
  `BETTER_AUTH_SECRET`/`CORS_ORIGIN`/`SINGLE_USER`/`SIGNUPS_ENABLED` from `apps/server/.env`. Connect Cloudflare once
  via `packages/infra/node_modules/.bin/alchemy profile edit`.
- **Previews**: `preview.yml` deploys `pr-<n>` on open/push/reopen (not drafts), posts the URLs as
  a PR comment, and destroys the stage on close. Forked PRs are skipped (no secrets).
- **Production**: `production.yml` deploys `prod` on every push to `main`, queued, never cancelled.
  D1 migrations run via Alchemy during deploy. `alchemy.prod.ts` refuses to run outside GitHub
  Actions — never deploy prod locally.
- Both workflows run `bun run check` and `bun run test` first.
- **State**: `Cloudflare.state()` keeps Alchemy state in a Cloudflare-hosted Worker, shared by CI and local runs.

### Secrets

Set via the CLI, piped so nothing is printed:

| Secret                       | Scope                    | Value                        |
| ---------------------------- | ------------------------ | ---------------------------- |
| `CLOUDFLARE_API_TOKEN`       | Repository               | Cloudflare API token (below) |
| `CLOUDFLARE_ACCOUNT_ID`      | Repository               | Cloudflare account id        |
| `BETTER_AUTH_SECRET_PREVIEW` | Repository               | Shared by all previews       |
| `BETTER_AUTH_SECRET`         | `production` environment | Production only              |

```bash
openssl rand -base64 48 | tr -d '\n' | gh secret set BETTER_AUTH_SECRET_PREVIEW
openssl rand -base64 48 | tr -d '\n' | gh secret set BETTER_AUTH_SECRET --env production
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
```

API token permissions (Cloudflare dashboard → My Profile → API Tokens):

- Account: Workers Scripts, D1, R2, Queues, Vectorize (Edit); Workers AI, Account Settings (Read); Secrets Store (Edit, for Alchemy state)
- Zone `ar7al.dev` only: Workers Routes, DNS (Edit); Zone (Read)

`CORS_ORIGIN`, `SINGLE_USER` and `SIGNUPS_ENABLED` are plain stage config, not secrets.

### Sign-up switch

`SIGNUPS_ENABLED` is the single switch for creating accounts. It defaults to `false` on `prod`
and `pr-<n>` and to `true` in local dev. When it is not `true`, better-auth refuses email sign-up
(`emailAndPassword.disableSignUp`, so `POST /api/auth/sign-up/email` fails), a database hook blocks
any other user creation, and the web app shows a paused-sign-ups banner instead of sign-up calls
to action. Existing accounts keep signing in. When it is `true`, `SINGLE_USER` (default `true`)
still refuses sign-up once one user exists; set it to `false` to allow more users.

The hosted instance (finance.ar7al.dev) keeps sign-ups closed until its processing of personal
financial data is declared with the CNDP under Moroccan law 09-08.

### Self-host on your own Cloudflare account

Sign-ups on the hosted instance are paused, so the way to use AttijariFlare today is your own copy.

1. Fork https://github.com/AbdelilahOu/AttijariFlare and clone your fork.
2. Use a Cloudflare account on the free tier (Workers, D1, R2, Queues, Vectorize and Workers AI
   all fit it for personal use) with a zone for your domain. Replace `ar7al.dev` and the
   `finance*` hostnames in `packages/infra/alchemy.prod.ts` (and `alchemy.preview.ts`) with yours.
3. Connect Alchemy: locally run `packages/infra/node_modules/.bin/alchemy profile edit`; for CI
   create an API token with the permissions listed under [Secrets](#secrets).
4. Add the GitHub secrets from [Secrets](#secrets) to your fork: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `BETTER_AUTH_SECRET` (in a `production` environment) and, for
   previews, `BETTER_AUTH_SECRET_PREVIEW`.
5. Turn on sign-up for your instance: set `SIGNUPS_ENABLED: "true"` in the `env` block of
   `.github/workflows/production.yml`. With the default `SINGLE_USER=true`, only the first
   account (yours) can be created, so you can leave it on.
6. Push to `main`; the Production workflow deploys your instance.

A self-hosted instance is run independently by its operator, not by this project. If you host
other people's data, you carry the legal obligations that come with it, including any
declaration with the CNDP under law 09-08 in Morocco.

### Free-tier notes

10 D1 databases per account on the free plan — prod + open previews must stay under that (local
dev uses local D1). Previews are destroyed on PR close.

## Project Structure

```
attijari-flare/
├── apps/
│   ├── web/              # Frontend (Solid)
│   └── server/           # Backend (Hono, ORPC, queue consumers)
├── packages/
│   ├── api/
│   │   ├── schemas/        # oRPC input validation (zod), one file per router
│   │   ├── routers/        # validate -> call -> shape, no business logic
│   │   ├── extraction/     # PDF -> markdown -> LLM extraction -> transactions
│   │   ├── categorization/ # Merchant matching, kNN + LLM categorization
│   │   ├── allocations/    # Splitting a transaction across categories
│   │   └── reports/        # Pure aggregation for the dashboard
│   ├── auth/
│   └── db/
│       └── queries/       # All DB reads/writes, one file per entity
```

## Scripts

- `dev` / `build` / `check-types` — across all apps
- `dev:web`, `dev:server` — one app only
- `db:generate` — generate DB client/types
- `check` — format + lint + typecheck
- `lint`, `format`, `staged` — Vite+ checks (apps also have their own scoped `lint`)
- `hooks:setup` — install Vite+ native git hooks

## Privacy and security

Bank statements are personal financial data. [PRIVACY.md](PRIVACY.md) covers what is stored,
where and for how long; [SECURITY.md](SECURITY.md) covers the security measures and how to report
a vulnerability; [docs/privacy-audit.md](docs/privacy-audit.md) is the code audit behind both,
and [docs/cndp-preparation.md](docs/cndp-preparation.md) gathers the facts for the CNDP
declaration (loi 09-08). None of them is legal advice. Self-hosters: set `DO_NOT_TRACK=1` to stop
the Alchemy CLI's telemetry; the app itself sends none. The hosted instance uses Cloudflare Web
Analytics, a zone setting disclosed in [PRIVACY.md](PRIVACY.md).
