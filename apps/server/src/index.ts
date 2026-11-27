import { logError } from "@attijari-flare/api/log";
import { apiSecurityHeaders } from "@attijari-flare/api/security-headers";
import { appRouter } from "@attijari-flare/api/routers/index";
import {
  StatementError,
  MAX_STATEMENT_BYTES,
  createStatement,
  getStatementPdf,
  statementErrorStatus,
} from "@attijari-flare/api/statements";
import { UPLOAD_LIMIT, consumeBinding } from "@attijari-flare/auth/rate-limit";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { type Context as HonoContext, Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { CloudflareEnv } from "../cloudflare-env";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { queue } from "./queues";
import { createAuth } from "./services";

const app = new Hono();

app.use(async (c, next) => {
  await next();
  const isPdf = c.res.headers.get("Content-Type")?.startsWith("application/pdf") ?? false;
  for (const [name, value] of Object.entries(apiSecurityHeaders(isPdf ? "pdf" : "json"))) {
    c.res.headers.set(name, value);
  }
});

// Request lines hold the method, path (ids only) and status. Hono prints the whole URL, so
// the query string is cut: it can carry auth tokens (better-auth callbacks) or filters.
app.use(logger((line) => console.log(line.replace(/\?\S*/, ""))));
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

// Statement upload and "view source" live on plain Hono routes: the browser sends the upload
// with XMLHttpRequest to get progress events, and the PDF opens directly in a new tab.
async function statementDeps(c: HonoContext) {
  const context = await createContext({ context: c });
  const userId = context.session?.user.id;
  if (!userId) return null;
  return { db: context.db, env: context.env, userId };
}

function statementErrorResponse(c: HonoContext, error: unknown) {
  if (error instanceof StatementError) {
    return c.json(
      { code: error.code, message: error.message, existingId: error.existingId },
      statementErrorStatus[error.code],
    );
  }
  throw error;
}

app.post("/api/statements", async (c) => {
  const deps = await statementDeps(c);
  if (!deps) return c.json({ code: "UNAUTHORIZED", message: "Sign in first." }, 401);

  const limit = await consumeBinding(ENV.UPLOAD_LIMIT, `upload|${deps.userId}`, UPLOAD_LIMIT);
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfter));
    return c.json(
      { code: "RATE_LIMITED", message: "Too many uploads. Try again in a minute." },
      429,
    );
  }

  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (declaredLength > MAX_STATEMENT_BYTES + 64 * 1024) {
    return statementErrorResponse(
      c,
      new StatementError("PAYLOAD_TOO_LARGE", "The file is too large."),
    );
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ code: "BAD_REQUEST", message: "Expected a multipart form body." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ code: "BAD_REQUEST", message: "Missing the `file` field." }, 400);
  }

  try {
    const statement = await createStatement(deps, file);
    return c.json(statement, 201);
  } catch (error) {
    return statementErrorResponse(c, error);
  }
});

app.get("/api/statements/:id/original", async (c) => {
  const deps = await statementDeps(c);
  if (!deps) return c.json({ code: "UNAUTHORIZED", message: "Sign in first." }, 401);

  try {
    const { object, fileName } = await getStatementPdf(deps, c.req.param("id"));
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return statementErrorResponse(c, error);
  }
});

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      // Never the raw error: Drizzle errors list the bound values of the failed query.
      logError("orpc.error", error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      // Never the raw error: Drizzle errors list the bound values of the failed query.
      logError("orpc.error", error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

export default {
  fetch: app.fetch,
  queue,
} satisfies ExportedHandler<CloudflareEnv>;
