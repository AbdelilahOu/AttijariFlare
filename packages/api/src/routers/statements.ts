import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import { statementIdSchema, uploadStatementSchema } from "../schemas/statements";
import {
  StatementError,
  createStatement,
  deleteStatement,
  getStatement,
  listStatements,
} from "../statements";

function toORPCError(error: unknown): unknown {
  if (error instanceof StatementError) {
    return new ORPCError(error.code, {
      message: error.message,
      data: error.existingId ? { existingId: error.existingId } : undefined,
    });
  }
  return error;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toORPCError(error);
  }
}

// Uploads normally go through the Hono route `POST /api/statements` (it reports upload
// progress to the browser); this procedure is the typed equivalent for oRPC clients.
export const statementsRouter = {
  list: protectedProcedure.handler(({ context }) =>
    run(() => listStatements({ db: context.db, userId: context.session.user.id })),
  ),
  get: protectedProcedure
    .input(statementIdSchema)
    .handler(({ context, input }) =>
      run(() => getStatement({ db: context.db, userId: context.session.user.id }, input.id)),
    ),
  upload: protectedProcedure
    .input(uploadStatementSchema)
    .handler(({ context, input }) =>
      run(() =>
        createStatement(
          { db: context.db, env: context.env, userId: context.session.user.id },
          input.file,
        ),
      ),
    ),
  delete: protectedProcedure.input(statementIdSchema).handler(async ({ context, input }) => {
    await run(() =>
      deleteStatement(
        { db: context.db, env: context.env, userId: context.session.user.id },
        input.id,
      ),
    );
    return { id: input.id };
  }),
};
