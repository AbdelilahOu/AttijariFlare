import type { Database } from "@finance-ttijari/db";
import {
  categories,
  categoryKinds,
  transactionAllocations,
  transactions,
} from "@finance-ttijari/db/schema/index";
import { ORPCError } from "@orpc/server";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";

const name = z.string().trim().min(1).max(60);
const color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color")
  .nullable();

async function assertParent(db: Database, userId: string, parentId: string, selfId?: string) {
  if (parentId === selfId) {
    throw new ORPCError("BAD_REQUEST", { message: "A category cannot be its own parent" });
  }
  const [parent] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, parentId), eq(categories.userId, userId)))
    .limit(1);
  if (!parent) throw new ORPCError("BAD_REQUEST", { message: "Unknown parent category" });
  // One level of nesting keeps the tree free of cycles without walking it.
  if (parent.parentId) {
    throw new ORPCError("BAD_REQUEST", { message: "The parent must be a top-level category" });
  }
}

function isUniqueViolation(error: unknown): boolean {
  const text = String((error as { cause?: unknown })?.cause ?? error);
  return /UNIQUE constraint failed/i.test(text);
}

async function guardUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ORPCError("CONFLICT", { message: "A category with this name already exists" });
    }
    throw error;
  }
}

const categoryFields = {
  id: categories.id,
  name: categories.name,
  kind: categories.kind,
  color: categories.color,
  parentId: categories.parentId,
};

export const categoriesRouter = {
  /** The user's categories by name, with how many transactions use each. */
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [rows, usage] = await Promise.all([
      context.db
        .select(categoryFields)
        .from(categories)
        .where(eq(categories.userId, userId))
        .orderBy(asc(categories.name)),
      context.db
        .select({ categoryId: transactions.categoryId, n: count() })
        .from(transactions)
        .where(eq(transactions.userId, userId))
        .groupBy(transactions.categoryId),
    ]);
    const counts = new Map(usage.map((row) => [row.categoryId, row.n]));
    return rows.map((row) => ({ ...row, transactions: counts.get(row.id) ?? 0 }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name,
        kind: z.enum(categoryKinds),
        color: color.default(null),
        parentId: z.string().min(1).nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.parentId) await assertParent(context.db, userId, input.parentId);
      const [row] = await guardUnique(() =>
        context.db
          .insert(categories)
          .values({ userId, ...input })
          .returning(categoryFields),
      );
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: name.optional(),
        kind: z.enum(categoryKinds).optional(),
        color: color.optional(),
        parentId: z.string().min(1).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { id, ...patch } = input;
      if (patch.parentId) await assertParent(context.db, userId, patch.parentId, id);
      if (patch.parentId) {
        // A category with children cannot become a child itself (one level of nesting).
        const [child] = await context.db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.parentId, id), eq(categories.userId, userId)))
          .limit(1);
        if (child) {
          throw new ORPCError("BAD_REQUEST", { message: "This category has subcategories" });
        }
      }
      if (Object.keys(patch).length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Nothing to update" });
      }
      const [row] = await guardUnique(() =>
        context.db
          .update(categories)
          .set(patch)
          .where(and(eq(categories.id, id), eq(categories.userId, userId)))
          .returning(categoryFields),
      );
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Category not found" });
      return row;
    }),

  /**
   * Deletes a category. Transactions and merchants using it become uncategorized; a category
   * still used by allocations is refused, since an allocation must have a category.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [used] = await context.db
        .select({ n: count() })
        .from(transactionAllocations)
        .where(
          and(
            eq(transactionAllocations.categoryId, input.id),
            eq(transactionAllocations.userId, userId),
          ),
        );
      if ((used?.n ?? 0) > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Used by ${used?.n} allocation(s); move them to another category first`,
        });
      }
      const [deleted] = await context.db
        .delete(categories)
        .where(and(eq(categories.id, input.id), eq(categories.userId, userId)))
        .returning({ id: categories.id });
      if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Category not found" });
      return deleted;
    }),
};
