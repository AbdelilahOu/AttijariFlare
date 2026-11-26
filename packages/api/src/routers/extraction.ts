import { mapServiceError } from "../errors";
import { reextractStatement } from "../extraction/reextract";
import { protectedProcedure } from "../index";
import { reextractStatementSchema } from "../schemas/extraction";

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
        throw mapServiceError(error);
      }
    }),
};
