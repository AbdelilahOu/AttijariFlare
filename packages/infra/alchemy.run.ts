import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/src/migrations",
});

// Original PDFs and extraction artifacts: statements/{id}/original.pdf, extracted.md, extraction.json
export const statements = Cloudflare.R2.Bucket("statements");

// Upload -> ingest consumer (toMarkdown + LLM extraction). Failed messages land in the DLQ.
export const statementIngestDlq = Cloudflare.Queues.Queue("statement-ingest-dlq");
export const statementIngest = Cloudflare.Queues.Queue("statement-ingest");

// Ingest -> enrich consumer (merchant embeddings + categorization).
export const txnEnrichDlq = Cloudflare.Queues.Queue("txn-enrich-dlq");
export const txnEnrich = Cloudflare.Queues.Queue("txn-enrich");

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
  env: {
    DB: db,
    STATEMENTS: statements,
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
  },
  dev: {
    port: 3000,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "finance-ttijari",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;
    const ingestQueue = yield* statementIngest;
    const ingestDlq = yield* statementIngestDlq;
    const enrichQueue = yield* txnEnrich;
    const enrichDlq = yield* txnEnrichDlq;

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
      env: {
        VITE_SERVER_URL: serverWorker.url.as<string>(),
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
