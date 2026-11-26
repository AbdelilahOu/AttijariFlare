import { mapServiceError } from "../errors";
import { protectedProcedure } from "../index";
import { statementIdSchema, uploadStatementSchema } from "../schemas/statements";
import { createStatement, deleteStatement, getStatement, listStatements } from "../statements";

// Uploads normally go through the Hono route `POST /api/statements` (it reports upload
// progress to the browser); this procedure is the typed equivalent for oRPC clients.
export const statementsRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    try {
      return await listStatements({ db: context.db, userId: context.session.user.id });
    } catch (error) {
      throw mapServiceError(error);
    }
  }),

  get: protectedProcedure.input(statementIdSchema).handler(async ({ context, input }) => {
    try {
      return await getStatement({ db: context.db, userId: context.session.user.id }, input.id);
    } catch (error) {
      throw mapServiceError(error);
    }
  }),

  upload: protectedProcedure.input(uploadStatementSchema).handler(async ({ context, input }) => {
    try {
      return await createStatement(
        { db: context.db, env: context.env, userId: context.session.user.id },
        input.file,
      );
    } catch (error) {
      throw mapServiceError(error);
    }
  }),

  delete: protectedProcedure.input(statementIdSchema).handler(async ({ context, input }) => {
    try {
      await deleteStatement(
        { db: context.db, env: context.env, userId: context.session.user.id },
        input.id,
      );
    } catch (error) {
      throw mapServiceError(error);
    }
    return { id: input.id };
  }),
};
