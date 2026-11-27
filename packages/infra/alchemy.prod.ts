import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const dbEu = Cloudflare.D1.Database("database-eu", {
  jurisdiction: "eu",
  migrations: "../../packages/db/src/migrations",
});

export const statementsEu = Cloudflare.R2.Bucket("statements-eu", { jurisdiction: "eu" });

const rateLimitNamespace = (n: number) => 2000 + n;

export const statementIngestDlqEu = Cloudflare.Queues.Queue("statement-ingest-dlq-eu", {
  jurisdiction: "eu",
});
export const statementIngestEu = Cloudflare.Queues.Queue("statement-ingest-eu", {
  jurisdiction: "eu",
});

export const txnEnrichDlqEu = Cloudflare.Queues.Queue("txn-enrich-dlq-eu", { jurisdiction: "eu" });
export const txnEnrichEu = Cloudflare.Queues.Queue("txn-enrich-eu", { jurisdiction: "eu" });

const observability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: false },
};

export const merchants = Cloudflare.Vectorize.Index("merchants", {
  dimensions: 1024,
  metric: "cosine",
  description: "Merchant embeddings (bge-m3) for transaction categorization",
});

export default Alchemy.Stack(
  "attijari-flare",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    if (stage !== "prod" || (yield* Alchemy.ALCHEMY_DEV)) {
      return yield* Effect.die(
        new Error(`alchemy.prod.ts deploys the prod stage only, got "${stage}".`),
      );
    }
    if (process.env.GITHUB_ACTIONS !== "true") {
      return yield* Effect.die(
        new Error(
          "Production deploys only run in GitHub Actions (.github/workflows/production.yml).",
        ),
      );
    }

    const webHost = "finance.ar7al.dev";
    const apiHost = "finance-api.ar7al.dev";

    const serverWorker = yield* Cloudflare.Worker("server", {
      main: "../../apps/server/src/index.ts",
      compatibility: {
        flags: ["nodejs_compat"],
      },
      observability,
      domain: { name: apiHost, zoneName: "ar7al.dev" },
      env: {
        DB: dbEu,
        STATEMENTS: statementsEu,
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
        STATEMENT_INGEST: statementIngestEu,
        TXN_ENRICH: txnEnrichEu,
        STATEMENT_INGEST_QUEUE_NAME: statementIngestEu.pipe(Effect.map((queue) => queue.queueName)),
        TXN_ENRICH_QUEUE_NAME: txnEnrichEu.pipe(Effect.map((queue) => queue.queueName)),
        VECTORIZE: merchants,
        AI: Cloudflare.Workers.AI(),
        CORS_ORIGIN: Config.succeed(`https://${webHost}`),
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
        BETTER_AUTH_URL: Cloudflare.Worker.URL,
        SINGLE_USER: Config.String("SINGLE_USER").pipe(Config.withDefault("true")),
        SIGNUPS_ENABLED: Config.String("SIGNUPS_ENABLED").pipe(Config.withDefault("false")),
      },
      dev: {
        port: 3000,
      },
    });
    const ingestQueue = yield* statementIngestEu;
    const ingestDlq = yield* statementIngestDlqEu;
    const enrichQueue = yield* txnEnrichEu;
    const enrichDlq = yield* txnEnrichDlqEu;
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
      domain: { name: webHost, zoneName: "ar7al.dev" },
      env: {
        VITE_SERVER_URL: serverWorker.url.as<string>(),
        VITE_SIGNUPS_ENABLED: Config.String("SIGNUPS_ENABLED").pipe(Config.withDefault("false")),
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
