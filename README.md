# AttijariFlare

Personal finance tracker for Attijariwafa bank statements: upload a PDF statement, it gets
extracted and categorized automatically (Workers AI + a merchant-embedding kNN step), and the
dashboard reports on spend, allocations and what still needs review.

Built on [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack) (Solid, Hono, ORPC) and deployed entirely on Cloudflare.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Solid** - Solid application with file-based routing and SSR
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **Cloudflare D1** - Database engine
- **Authentication** - Better-Auth
- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses Cloudflare D1 (SQLite) with Drizzle ORM.

Runtime database access uses the Cloudflare `DB` binding from the `packages/infra/alchemy.*.ts` entry files. If a local `DATABASE_URL` is present, it is only for database tooling.

Alchemy provisions the D1 database and applies migrations during deploys.

1. Generate migration files:

```bash
bun run db:generate
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Cloudflare Resources

The `packages/infra/alchemy.*.ts` entry files provision everything; do not create resources with wrangler or the dashboard.

| Binding            | Resource                                              | Used for                                              |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| `DB`               | D1 database                                           | All application data                                  |
| `STATEMENTS`       | R2 bucket `statements`                                | `statements/{id}/original.pdf` and extraction outputs |
| `STATEMENT_INGEST` | Queue `statement-ingest` (DLQ `statement-ingest-dlq`) | Upload to AI extraction                               |
| `TXN_ENRICH`       | Queue `txn-enrich` (DLQ `txn-enrich-dlq`)             | Extraction to categorization                          |
| `VECTORIZE`        | Vectorize index `merchants` (1024 dims, cosine)       | Merchant embeddings from `@cf/baai/bge-m3`            |
| `AI`               | Workers AI                                            | `toMarkdown`, LLM extraction, embeddings              |

The server worker is the consumer of both queues (batch size 1, concurrency 1, 3 retries, then the DLQ). Its `queue()` export dispatches on `STATEMENT_INGEST_QUEUE_NAME` / `TXN_ENRICH_QUEUE_NAME`, because Alchemy gives each queue a physical name with the stage and a random suffix. Dead-letter queues have no consumer; inspect them in the dashboard.

Routers get the bindings as `context.env` (typed by `packages/api/src/bindings.ts`), queue handlers as their `env` argument.

### Free-tier limits

Checked against the Cloudflare docs on 2026-11-25. The whole app must stay inside these.

| Product    | Free limit                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workers    | 100,000 requests/day; 10 ms CPU per HTTP request; 50 subrequests per invocation; 128 MB memory                                                                                                             |
| Queues     | 10,000 operations/day (one per 64 KB written, read or deleted; a normal delivery is 3, each retry adds 1); 24 h retention, not configurable; 128 KB per message; 15 min wall clock per consumer invocation |
| Workers AI | 10,000 neurons/day (resets 00:00 UTC). `bge-m3` costs 1,075 neurons per million input tokens. `toMarkdown` is free for PDFs (only image conversion uses models)                                            |
| Vectorize  | 5 million stored dimensions (about 4,880 vectors at 1024 dims); 30 million queried dimensions/month; 100 indexes                                                                                           |
| R2         | 10 GB-month storage; 1 million Class A and 10 million Class B operations/month; free egress                                                                                                                |
| D1         | 5 million rows read/day; 100,000 rows written/day; 500 MB per database, 5 GB total; 10 databases; 50 queries per invocation                                                                                |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) and [limits](https://developers.cloudflare.com/queues/platform/limits/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Markdown conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/), [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) and [limits](https://developers.cloudflare.com/vectorize/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [limits](https://developers.cloudflare.com/d1/platform/limits/).

Open question: the Queues limits page lists a 30 s default consumer CPU limit with no free-plan figure, while the Workers page lists 10 ms for HTTP requests. Assume 10 ms until measured; consumers spend most of their time waiting on AI calls, which does not count as CPU.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

There is one Alchemy entry file per stage in `packages/infra`, selected with `alchemy --config`. Each one holds the whole stack (they are deliberately duplicated, so keep them in sync when you add a resource). Alchemy puts the stage into every physical resource name, so each stage has its own D1 database, R2 bucket, queues, DLQs, Vectorize index and metadata indexes.

| Stage        | Entry file           | Web                                | API                                    | Runs from                          |
| ------------ | -------------------- | ---------------------------------- | -------------------------------------- | ---------------------------------- |
| `dev_<user>` | `alchemy.dev.ts`     | `http://localhost:3001`            | `http://localhost:3000`                | `bun run dev`, local only          |
| `pr-<n>`     | `alchemy.preview.ts` | `https://finance-pr-<n>.ar7al.dev` | `https://finance-pr-<n>-api.ar7al.dev` | `.github/workflows/preview.yml`    |
| `prod`       | `alchemy.prod.ts`    | `https://finance.ar7al.dev`        | `https://finance-api.ar7al.dev`        | `.github/workflows/production.yml` |

Hostnames use one subdomain level only, because the free Universal SSL certificate covers `*.ar7al.dev` and nothing deeper. They are Workers custom domains on the `ar7al.dev` zone; Cloudflare creates the DNS records and certificates. Deployed stages derive `CORS_ORIGIN` from the web hostname, and `BETTER_AUTH_URL` and the web's `VITE_SERVER_URL` from the API worker's URL, so none of them are configured by hand.

### Local development

`bun run dev` runs `alchemy dev --config alchemy.dev.ts`. It never deploys (the entry refuses to run outside `alchemy dev`), has no custom domains, and reads `BETTER_AUTH_SECRET`, `CORS_ORIGIN` and `SINGLE_USER` from `apps/server/.env` through Varlock. Connect your Cloudflare account once with `packages/infra/node_modules/.bin/alchemy profile edit` (OAuth).

### Previews

`preview.yml` deploys stage `pr-<n>` when a pull request is opened, pushed to, reopened or marked ready for review (drafts are skipped), and keeps one comment on the pull request with the URLs up to date. When the pull request closes (merged or not) it destroys the stage. Each pull request has its own concurrency group. Pull requests from forks are skipped because they get no secrets.

### Production

`production.yml` deploys stage `prod` on every push to `main`, in the GitHub `production` environment. Deploys queue in one concurrency group and are never cancelled. D1 migrations from `packages/db/src/migrations` are applied by Alchemy during the deploy. Never deploy production from a local machine; `alchemy.prod.ts` refuses to run outside GitHub Actions.

Both workflows run `bun run check` and `bun run test` before deploying.

### State

`Cloudflare.state()` keeps Alchemy state in a state-store Worker on the Cloudflare account, so CI and local runs share the same state for each stage.

### Secrets

Secrets live in GitHub Actions secrets and are never committed. Set them with the CLI and pipe the value so it is never printed:

| Secret                       | Scope                    | Value                               |
| ---------------------------- | ------------------------ | ----------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | Repository               | Cloudflare API token (see below)    |
| `CLOUDFLARE_ACCOUNT_ID`      | Repository               | Cloudflare account id               |
| `BETTER_AUTH_SECRET_PREVIEW` | Repository               | Random value shared by all previews |
| `BETTER_AUTH_SECRET`         | `production` environment | Random value for production only    |

```bash
openssl rand -base64 48 | tr -d '
' | gh secret set BETTER_AUTH_SECRET_PREVIEW
openssl rand -base64 48 | tr -d '
' | gh secret set BETTER_AUTH_SECRET --env production
gh secret set CLOUDFLARE_ACCOUNT_ID   # paste the account id, or pipe it from `cf`
gh secret set CLOUDFLARE_API_TOKEN    # paste the token when prompted
```

Create the API token in the Cloudflare dashboard (My Profile, API Tokens, Create Custom Token) with these permissions:

- Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Queues Edit, Vectorize Edit, Workers AI Read, Secrets Store Edit (the Alchemy state store), Account Settings Read
- Zone `ar7al.dev` only: Workers Routes Edit, Zone Read, DNS Edit

Non-secret settings (`CORS_ORIGIN`, `SINGLE_USER`) come from the stage in code and are not stored as secrets.

### Free-tier notes

The free plan allows 10 D1 databases per account. Production plus every open pull request preview must stay under that (local dev uses a local D1). Previews are destroyed when their pull request closes, and the preview workflow prints a clear error when Cloudflare refuses to create a database because of the limit. Nothing here uses paid features.

## Git Hooks and Formatting

- Optional native Vite+ hooks: `bun run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `bun run check`

## Project Structure

```
attijari-flare/
├── apps/
│   ├── web/              # Frontend application (Solid)
│   └── server/           # Backend API (Hono, ORPC, queue consumers)
├── packages/
│   ├── api/
│   │   ├── schemas/      # oRPC input validation (zod), one file per router
│   │   ├── routers/      # oRPC routers: validate -> call -> shape, no business logic
│   │   ├── extraction/   # PDF -> markdown -> LLM extraction -> transactions
│   │   ├── categorization/ # Merchant matching, kNN + LLM categorization
│   │   ├── allocations/  # Splitting a transaction across categories
│   │   └── reports/      # Pure aggregation for the dashboard
│   ├── auth/             # Authentication configuration & logic
│   └── db/
│       └── queries/      # All DB reads/writes, one file per entity
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:generate`: Generate database client/types
- `bun run check`: Run Vite+ format/lint checks and workspace TypeScript checks
- `bun run lint`: Run Vite+ lint checks across the whole workspace (each app also has its own `lint` script, scoped to that app)
- `bun run format`: Run Vite+ formatting
- `bun run staged`: Run Vite+ checks against staged files
- `bun run hooks:setup`: Install Vite+ native Git hooks with `vp config`
