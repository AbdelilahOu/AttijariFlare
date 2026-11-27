import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

export const db = Cloudflare.D1.Database("database", {
  jurisdiction: "eu",
  migrations: "../../packages/db/src/migrations",
});

export const statements = Cloudflare.R2.Bucket("statements", { jurisdiction: "eu" });

const rateLimitNamespace = (n: number) => 1000 + n;

export const statementIngestDlq = Cloudflare.Queues.Queue("statement-ingest-dlq", {
  jurisdiction: "eu",
});
export const statementIngest = Cloudflare.Queues.Queue("statement-ingest", { jurisdiction: "eu" });

export const txnEnrichDlq = Cloudflare.Queues.Queue("txn-enrich-dlq", { jurisdiction: "eu" });
export const txnEnrich = Cloudflare.Queues.Queue("txn-enrich", { jurisdiction: "eu" });

const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: false },
};

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
    AUTH_SIGN_IN_LIMIT: Cloudflare.RateLimit("AUTH_SIGN_IN_LIMIT", {
      namespaceId: rateLimitNamespace(1),
      simple: { limit: 5, period: 60 },
    }),
    AUTH_SENSITIVE_LIMIT: Cloudflare.RateLimit("AUTH_SENSITIVE_LIMIT", {
      namespaceId: rateLimitNamespace(2),
      simple: { limit: 3, period: 60 },
    }),
    UPLOAD_LIMIT: Cloudflare.RateLimit("UPLOAD_LIMIT", {
      namespaceId: rateLimitNamespace(3),
      simple: { limit: 3, period: 60 },
    }),
    STATEMENT_INGEST: statementIngest,
    TXN_ENRICH: txnEnrich,
    STATEMENT_INGEST_QUEUE_NAME: statementIngest.pipe(Effect.map((queue) => queue.queueName)),
    TXN_ENRICH_QUEUE_NAME: txnEnrich.pipe(Effect.map((queue) => queue.queueName)),
    VECTORIZE: merchants,
    AI: Cloudflare.Workers.AI(),
    CORS_ORIGIN: Config.String("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    SINGLE_USER: Config.String("SINGLE_USER").pipe(Config.withDefault("true")),
    SIGNUPS_ENABLED: Config.String("SIGNUPS_ENABLED").pipe(Config.withDefault("true")),
  },
  dev: {
    port: 3000,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "attijari-flare",
  {
    providers: Cloudflare.providers(),
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

    yield* Cloudflare.Queues.Consumer("statement-ingest-consumer", {
      queueId: ingestQueue.queueId,
      scriptName: serverWorker.workerName,
      deadLetterQueue: ingestDlq.queueName,
      settings: {
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
