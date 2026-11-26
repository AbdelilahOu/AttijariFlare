// Local development only: `bun run dev` runs `alchemy dev --config alchemy.dev.ts`.
// Runs on localhost (API 3000, web 3001), has no custom domains and is never deployed.
// BETTER_AUTH_SECRET, CORS_ORIGIN and the other inputs come from the local .env files.
// alchemy.preview.ts and alchemy.prod.ts repeat this stack with custom domains; keep them in sync.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

// Every resource gets a physical name that includes the stage, so stages never share
// D1, R2, queues, DLQs or the Vectorize index.
export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/src/migrations",
});

// Original PDFs and extraction artifacts: statements/{id}/original.pdf, extracted.md, extraction.json
export const statements = Cloudflare.R2.Bucket("statements");

export const rateLimits = Cloudflare.KV.Namespace("rate-limits");

// Upload -> ingest consumer (toMarkdown + LLM extraction). Failed messages land in the DLQ.
export const statementIngestDlq = Cloudflare.Queues.Queue("statement-ingest-dlq");
export const statementIngest = Cloudflare.Queues.Queue("statement-ingest");

// Ingest -> enrich consumer (merchant embeddings + categorization).
export const txnEnrichDlq = Cloudflare.Queues.Queue("txn-enrich-dlq");
export const txnEnrich = Cloudflare.Queues.Queue("txn-enrich");

// Workers Logs keep only the app's own console lines (redacted: ids, counts, error kinds).
// Invocation logs are off: they record request metadata such as the client IP and location.
const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: false },
};

// Merchant embeddings from @cf/baai/bge-m3 (1024 dimensions).
export const merchants = Cloudflare.Vectorize.Index("merchants", {
  dimensions: 1024,
  metric: "cosine",
  description: "Merchant embeddings (bge-m3) for transaction categorization",
});

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  observability,
  env: {
    DB: db,
    STATEMENTS: statements,
    RATE_LIMITS: rateLimits,
    STATEMENT_INGEST: statementIngest,
    TXN_ENRICH: txnEnrich,
    // Physical queue names (they include stage and a random suffix); queue() dispatches on these.
    STATEMENT_INGEST_QUEUE_NAME: statementIngest.pipe(Effect.map((queue) => queue.queueName)),
    TXN_ENRICH_QUEUE_NAME: txnEnrich.pipe(Effect.map((queue) => queue.queueName)),
    VECTORIZE: merchants,
    AI: Cloudflare.Workers.AI(),
    CORS_ORIGIN: Config.String("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    // Sign-up guard (packages/auth): refuses sign-up once a user exists unless set to "false".
    SINGLE_USER: Config.String("SINGLE_USER").pipe(Config.withDefault("true")),
    // Master sign-up switch (packages/auth): sign-up is refused unless set to "true".
    SIGNUPS_ENABLED: Config.String("SIGNUPS_ENABLED").pipe(Config.withDefault("true")),
  },
  dev: {
    port: 3000,
  },
});

// The server's binding types (apps/server/cloudflare-env.d.ts). Every stage has the same bindings.
export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "attijari-flare",
  {
    providers: Cloudflare.providers(),
    // State lives on Cloudflare, so CI and local runs share it per stage.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    if (!(yield* Alchemy.ALCHEMY_DEV)) {
      return yield* Effect.die(
        new Error(
          "alchemy.dev.ts is for `alchemy dev` only. Deploys use alchemy.preview.ts or alchemy.prod.ts.",
        ),
      );
    }

    const serverWorker = yield* server;
    const ingestQueue = yield* statementIngest;
    const ingestDlq = yield* statementIngestDlq;
    const enrichQueue = yield* txnEnrich;
    const enrichDlq = yield* txnEnrichDlq;
    const merchantIndex = yield* merchants;

    // kNN in the enrich consumer filters on these metadata properties. Vectors written before
    // an index exists are not indexed, so they are created with the stack.
    yield* Cloudflare.Vectorize.MetadataIndex("merchants-user-id", {
      indexName: merchantIndex.indexName,
      propertyName: "user_id",
      indexType: "string",
    });
    yield* Cloudflare.Vectorize.MetadataIndex("merchants-confirmed", {
      indexName: merchantIndex.indexName,
      propertyName: "confirmed",
      indexType: "boolean",
    });

    // The server worker is the only consumer of both queues. Dead-letter queues are not
    // consumed (that would spend Queues operations); inspect them in the dashboard.
    yield* Cloudflare.Queues.Consumer("statement-ingest-consumer", {
      queueId: ingestQueue.queueId,
      scriptName: serverWorker.workerName,
      deadLetterQueue: ingestDlq.queueName,
      settings: {
        // One statement per invocation: each one costs several AI calls.
        batchSize: 1,
        maxConcurrency: 1,
        maxRetries: 3,
        retryDelay: 60,
      },
    });

    yield* Cloudflare.Queues.Consumer("txn-enrich-consumer", {
      queueId: enrichQueue.queueId,
      scriptName: serverWorker.workerName,
      deadLetterQueue: enrichDlq.queueName,
      settings: {
        batchSize: 1,
        maxConcurrency: 1,
        maxRetries: 3,
        retryDelay: 60,
      },
    });

    const webWorker = yield* Cloudflare.Website.Vite("web", {
      rootDir: "../../apps/web",
      compatibility: {
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      observability,
      env: {
        VITE_SERVER_URL: serverWorker.url.as<string>(),
        // Shows the paused-sign-ups banner and hides sign-up calls to action when not "true".
        VITE_SIGNUPS_ENABLED: Config.String("SIGNUPS_ENABLED").pipe(Config.withDefault("true")),
      },
      dev: {
        port: 3001,
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
