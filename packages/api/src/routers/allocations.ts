import type { Database } from "@attijari-flare/db";
import {
  deleteAllocation,
  getTransactionForAllocation,
  listAllocatableCategories,
  listDebitTransactions,
  listOwnedCategoryIds,
  replaceAllocations,
} from "@attijari-flare/db/queries";
import { ORPCError } from "@orpc/server";

import { describeAllocationIssue, validateAllocations } from "../allocations/math";
import { allocationState } from "../allocations/service";
import { protectedProcedure } from "../index";
import {
  deleteAllocationSchema,
  listAllocationsSchema,
  listDebitsSchema,
  setAllocationsSchema,
} from "../schemas/allocations";

async function requireAllocationState(db: Database, userId: string, transactionId: string) {
  const state = await allocationState(db, userId, transactionId);
  if (!state) throw new ORPCError("NOT_FOUND", { message: "Transaction not found" });
  return state;
}

export const allocationsRouter = {
  list: protectedProcedure
    .input(listAllocationsSchema)
    .handler(({ context, input }) =>
      requireAllocationState(context.db, context.session.user.id, input.transactionId),
    ),

  /** Replaces every allocation of one debit transaction atomically. An empty list clears them. */
  set: protectedProcedure.input(setAllocationsSchema).handler(async ({ context, input }) => {
    const { db } = context;
    const userId = context.session.user.id;
    const transaction = await getTransactionForAllocation(db, {
      userId,
      transactionId: input.transactionId,
    });
    if (!transaction) throw new ORPCError("NOT_FOUND", { message: "Transaction not found" });

    const validation = validateAllocations(transaction.amount, input.parts);
    if (!validation.ok) {
      throw new ORPCError("BAD_REQUEST", {
        message: validation.issues.map(describeAllocationIssue).join("; "),
        data: { issues: validation.issues },
      });
    }

    const categoryIds = [...new Set(input.parts.map((part) => part.categoryId))];
    const owned = await listOwnedCategoryIds(db, { userId, categoryIds });
    if (owned.length !== categoryIds.length) {
      throw new ORPCError("BAD_REQUEST", { message: "Unknown category" });
    }

    await replaceAllocations(db, { userId, transactionId: transaction.id, parts: input.parts });
    return requireAllocationState(db, userId, transaction.id);
  }),

  /** Deletes one allocation; its amount returns to the unallocated remainder. */
  delete: protectedProcedure.input(deleteAllocationSchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const deleted = await deleteAllocation(context.db, { userId, id: input.id });
    if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Allocation not found" });
    return requireAllocationState(context.db, userId, deleted.transactionId);
  }),

  /**
   * The user's debit transactions for the allocation page: cash withdrawals first,
   * then newest first, each with its allocated total.
   */
  debits: protectedProcedure.input(listDebitsSchema).handler(async ({ context, input }) => {
    const rows = await listDebitTransactions(context.db, {
      userId: context.session.user.id,
      type: input.type,
      limit: input.limit,
    });
    return rows.map((row) => ({
      ...row,
      allocated: Number(row.allocated),
      parts: Number(row.parts),
      remainder: Math.abs(row.amount) - Number(row.allocated),
    }));
  }),

  /** Categories the user can allocate to. */
  categories: protectedProcedure.handler(({ context }) =>
    listAllocatableCategories(context.db, { userId: context.session.user.id }),
  ),
};
