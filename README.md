# finance-ttijari

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Solid, Hono, ORPC, and more.

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

Runtime database access uses the Cloudflare `DB` binding from `packages/infra/alchemy.run.ts`. If a local `DATABASE_URL` is present, it is only for database tooling.

Alchemy provisions the D1 database and applies migrations during `deploy`.

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

`packages/infra/alchemy.run.ts` provisions everything; do not create resources with wrangler or the dashboard.

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

### Alchemy

- Target: web on Cloudflare + server on Cloudflare
- Configure provider accounts: `cd packages/infra && bunx alchemy profile edit`
- Dev: bun run dev
- Deploy: bun run deploy
- Destroy: bun run destroy

`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from `packages/infra`:

```bash
cd packages/infra && bunx alchemy deploy --stage production
```

### Production origins

- Required after the first deploy: set `CORS_ORIGIN` in `apps/server/.env` to the exact deployed web origin, such as `https://app.example.com`, then deploy the server again.

## Git Hooks and Formatting

- Optional native Vite+ hooks: `bun run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `bun run check`

## Project Structure

```
finance-ttijari/
├── apps/
│   ├── web/         # Frontend application (Solid)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:generate`: Generate database client/types
- `bun run check`: Run Vite+ format/lint checks and workspace TypeScript checks
- `bun run lint`: Run Vite+ lint checks
- `bun run format`: Run Vite+ formatting
- `bun run staged`: Run Vite+ checks against staged files
- `bun run hooks:setup`: Install Vite+ native Git hooks with `vp config`
