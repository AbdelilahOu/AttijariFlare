import { statements } from "@finance-ttijari/db/schema/index";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";

export const extractionRouter = {
  /**
   * Queues a statement for extraction again (for example after a failure or a review).
   * Existing transactions are kept where the new run finds the same rows, so categories
   * and allocations on them survive.
   */
  reextract: protectedProcedure
    .input(z.object({ statementId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [statement] = await context.db
        .select({ id: statements.id, status: statements.status })
        .from(statements)
        .where(and(eq(statements.id, input.statementId), eq(statements.userId, userId)))
        .limit(1);
      if (!statement) {
        throw new ORPCError("NOT_FOUND", { message: "Statement not found" });
      }
      if (statement.status === "extracting") {
        throw new ORPCError("CONFLICT", { message: "Statement is already being extracted" });
      }

      await context.db
        .update(statements)
        .set({ status: "uploaded", error: null })
        .where(eq(statements.id, statement.id));
      await context.env.STATEMENT_INGEST.send({ statementId: statement.id });
      return { statementId: statement.id, status: "uploaded" as const };
    }),
};
