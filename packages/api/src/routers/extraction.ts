import { ORPCError } from "@orpc/server";

import { ReextractError, reextractStatement } from "../extraction/reextract";
import { protectedProcedure } from "../index";
import { reextractStatementSchema } from "../schemas/extraction";

function toORPCError(error: unknown): unknown {
  if (error instanceof ReextractError) {
    return new ORPCError(error.code, { message: error.message });
  }
  return error;
}

export const extractionRouter = {
  reextract: protectedProcedure
    .input(reextractStatementSchema)
    .handler(async ({ context, input }) => {
      try {
        return await reextractStatement(
          { db: context.db, env: context.env, userId: context.session.user.id },
          input.statementId,
        );
      } catch (error) {
        throw toORPCError(error);
      }
    }),
};
