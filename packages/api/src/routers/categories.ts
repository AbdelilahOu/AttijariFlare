import type { Database } from "@finance-ttijari/db";
import { isUniqueConstraintViolation } from "@finance-ttijari/db/errors";
import {
  categoryHasChildren,
  countAllocationsUsingCategory,
  createCategory,
  deleteCategory,
  getCategoryParent,
  listCategoriesWithUsage,
  updateCategory,
} from "@finance-ttijari/db/queries";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import { createCategorySchema, deleteCategorySchema, updateCategorySchema } from "../schemas/categories";

async function assertValidParent(
  db: Database,
  userId: string,
  parentId: string,
  selfId?: string,
) {
  if (parentId === selfId) {
    throw new ORPCError("BAD_REQUEST", { message: "A category cannot be its own parent" });
  }
  const parent = await getCategoryParent(db, { userId, parentId });
  if (!parent) throw new ORPCError("BAD_REQUEST", { message: "Unknown parent category" });
  // One level of nesting keeps the tree free of cycles without walking it.
  if (parent.parentId) {
    throw new ORPCError("BAD_REQUEST", { message: "The parent must be a top-level category" });
  }
}

async function guardUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ORPCError("CONFLICT", { message: "A category with this name already exists" });
    }
    throw error;
  }
}

export const categoriesRouter = {
  /** The user's categories by name, with how many transactions use each. */
  list: protectedProcedure.handler(({ context }) =>
    listCategoriesWithUsage(context.db, { userId: context.session.user.id }),
  ),

  create: protectedProcedure.input(createCategorySchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    if (input.parentId) await assertValidParent(context.db, userId, input.parentId);
    const row = await guardUnique(() => createCategory(context.db, { userId, ...input }));
    return row;
  }),

  update: protectedProcedure.input(updateCategorySchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const { id, ...patch } = input;
    if (patch.parentId) await assertValidParent(context.db, userId, patch.parentId, id);
    if (patch.parentId && (await categoryHasChildren(context.db, { userId, categoryId: id }))) {
      // A category with children cannot become a child itself (one level of nesting).
      throw new ORPCError("BAD_REQUEST", { message: "This category has subcategories" });
    }
    if (Object.keys(patch).length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "Nothing to update" });
    }
    const row = await guardUnique(() => updateCategory(context.db, { id, userId, patch }));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Category not found" });
    return row;
  }),

  /**
   * Deletes a category. Transactions and merchants using it become uncategorized; a category
   * still used by allocations is refused, since an allocation must have a category.
   */
  delete: protectedProcedure.input(deleteCategorySchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const used = await countAllocationsUsingCategory(context.db, { userId, categoryId: input.id });
    if (used > 0) {
      throw new ORPCError("CONFLICT", {
        message: `Used by ${used} allocation(s); move them to another category first`,
      });
    }
    const deleted = await deleteCategory(context.db, { id: input.id, userId });
    if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Category not found" });
    return deleted;
  }),
};
