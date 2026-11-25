import type { Database } from "@finance-ttijari/db";
import {
  categories,
  transactionAllocations,
  transactions,
  transactionTypes,
} from "@finance-ttijari/db/schema/index";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  describeAllocationIssue,
  effectiveCategoryBreakdown,
  summarizeAllocations,
  validateAllocations,
} from "../allocations/math";
import { protectedProcedure } from "../index";

// Each part is one INSERT in the batch; keep the batch small for D1 and the 10 ms CPU budget.
const MAX_PARTS = 50;

const partInput = z.object({
  amount: z.number().int().positive(),
  categoryId: z.string().min(1),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((note) => (note ? note : null)),
});

async function loadTransaction(db: Database, userId: string, transactionId: string) {
  const [row] = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      type: transactions.type,
      categoryId: transactions.categoryId,
      bookingDate: transactions.bookingDate,
      descriptionRaw: transactions.descriptionRaw,
    })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Transaction not found" });
  return row;
}

async function loadAllocations(db: Database, userId: string, transactionId: string) {
  return db
    .select({
      id: transactionAllocations.id,
      amount: transactionAllocations.amount,
      categoryId: transactionAllocations.categoryId,
      note: transactionAllocations.note,
    })
    .from(transactionAllocations)
    .where(
      and(
        eq(transactionAllocations.transactionId, transactionId),
        eq(transactionAllocations.userId, userId),
      ),
    )
    .orderBy(asc(transactionAllocations.createdAt), asc(transactionAllocations.id));
}

async function allocationState(db: Database, userId: string, transactionId: string) {
  const transaction = await loadTransaction(db, userId, transactionId);
  const allocations = await loadAllocations(db, userId, transactionId);
  const { allocated, remainder } = summarizeAllocations(transaction.amount, allocations);
  return {
    transaction,
    allocations,
    allocated,
    remainder,
    breakdown: effectiveCategoryBreakdown(transaction, allocations),
  };
}

export const allocationsRouter = {
  /** Allocations of one transaction with the allocated total and unallocated remainder. */
  list: protectedProcedure
    .input(z.object({ transactionId: z.string().min(1) }))
    .handler(({ context, input }) =>
      allocationState(context.db, context.session.user.id, input.transactionId),
    ),

  /** Replaces every allocation of one debit transaction atomically. An empty list clears them. */
  set: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().min(1),
        parts: z.array(partInput).max(MAX_PARTS),
      }),
    )
    .handler(async ({ context, input }) => {
      const { db } = context;
      const userId = context.session.user.id;
      const transaction = await loadTransaction(db, userId, input.transactionId);

      const validation = validateAllocations(transaction.amount, input.parts);
      if (!validation.ok) {
        throw new ORPCError("BAD_REQUEST", {
          message: validation.issues.map(describeAllocationIssue).join("; "),
          data: { issues: validation.issues },
        });
      }

      const categoryIds = [...new Set(input.parts.map((part) => part.categoryId))];
      if (categoryIds.length > 0) {
        const owned = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.userId, userId), inArray(categories.id, categoryIds)));
        if (owned.length !== categoryIds.length) {
          throw new ORPCError("BAD_REQUEST", { message: "Unknown category" });
        }
      }

      const remove = db
        .delete(transactionAllocations)
        .where(
          and(
            eq(transactionAllocations.transactionId, transaction.id),
            eq(transactionAllocations.userId, userId),
          ),
        );
      const inserts = input.parts.map((part) =>
        db.insert(transactionAllocations).values({
          userId,
          transactionId: transaction.id,
          amount: part.amount,
          categoryId: part.categoryId,
          note: part.note,
        }),
      );
      await db.batch([remove, ...inserts]);

      return allocationState(db, userId, transaction.id);
    }),

  /** Deletes one allocation; its amount returns to the unallocated remainder. */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const { db } = context;
      const userId = context.session.user.id;
      const [deleted] = await db
        .delete(transactionAllocations)
        .where(
          and(eq(transactionAllocations.id, input.id), eq(transactionAllocations.userId, userId)),
        )
        .returning({ transactionId: transactionAllocations.transactionId });
      if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Allocation not found" });
      return allocationState(db, userId, deleted.transactionId);
    }),

  /**
   * The user's debit transactions for the allocation page: cash withdrawals first,
   * then newest first, each with its allocated total.
   */
  debits: protectedProcedure
    .input(
      z
        .object({
          type: z.enum(transactionTypes).optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .default({ limit: 100 }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const allocated = sql<number>`coalesce(sum(${transactionAllocations.amount}), 0)`;
      const rows = await context.db
        .select({
          id: transactions.id,
          bookingDate: transactions.bookingDate,
          descriptionRaw: transactions.descriptionRaw,
          amount: transactions.amount,
          type: transactions.type,
          categoryId: transactions.categoryId,
          allocated,
          parts: sql<number>`count(${transactionAllocations.id})`,
        })
        .from(transactions)
        .leftJoin(transactionAllocations, eq(transactionAllocations.transactionId, transactions.id))
        .where(
          and(
            eq(transactions.userId, userId),
            lt(transactions.amount, 0),
            input.type ? eq(transactions.type, input.type) : undefined,
          ),
        )
        .groupBy(transactions.id)
        .orderBy(
          desc(sql`${transactions.type} = 'cash_withdrawal'`),
          desc(transactions.bookingDate),
          asc(transactions.id),
        )
        .limit(input.limit);
      return rows.map((row) => ({
        ...row,
        allocated: Number(row.allocated),
        parts: Number(row.parts),
        remainder: Math.abs(row.amount) - Number(row.allocated),
      }));
    }),

  /** Categories the user can allocate to. */
  categories: protectedProcedure.handler(({ context }) =>
    context.db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        color: categories.color,
      })
      .from(categories)
      .where(eq(categories.userId, context.session.user.id))
      .orderBy(asc(categories.name)),
  ),
};
