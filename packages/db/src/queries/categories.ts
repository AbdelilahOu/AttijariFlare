import { and, asc, count, eq } from "drizzle-orm";

import type { Database } from "../index";
import type { CategoryKind } from "../schema/enums";
import { categories, transactionAllocations, transactions } from "../schema/index";

const categoryFields = {
  id: categories.id,
  name: categories.name,
  kind: categories.kind,
  color: categories.color,
  parentId: categories.parentId,
};

export async function listCategoriesWithUsage(db: Database, params: { userId: string }) {
  const { userId } = params;
  const [rows, usage] = await Promise.all([
    db
      .select(categoryFields)
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.name)),
    db
      .select({ categoryId: transactions.categoryId, n: count() })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(transactions.categoryId),
  ]);
  const counts = new Map(usage.map((row) => [row.categoryId, row.n]));
  return rows.map((row) => ({ ...row, transactions: counts.get(row.id) ?? 0 }));
}

export async function getCategoryParent(
  db: Database,
  params: { userId: string; parentId: string },
) {
  const [parent] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, params.parentId), eq(categories.userId, params.userId)))
    .limit(1);
  return parent;
}

export async function categoryHasChildren(
  db: Database,
  params: { userId: string; categoryId: string },
) {
  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, params.categoryId), eq(categories.userId, params.userId)))
    .limit(1);
  return Boolean(child);
}

export async function countAllocationsUsingCategory(
  db: Database,
  params: { userId: string; categoryId: string },
) {
  const [row] = await db
    .select({ n: count() })
    .from(transactionAllocations)
    .where(
      and(
        eq(transactionAllocations.categoryId, params.categoryId),
        eq(transactionAllocations.userId, params.userId),
      ),
    );
  return row?.n ?? 0;
}

export async function createCategory(
  db: Database,
  params: {
    userId: string;
    name: string;
    kind: CategoryKind;
    color: string | null;
    parentId: string | null;
  },
) {
  const [row] = await db.insert(categories).values(params).returning(categoryFields);
  return row;
}

export async function updateCategory(
  db: Database,
  params: {
    id: string;
    userId: string;
    patch: Partial<{
      name: string;
      kind: CategoryKind;
      color: string | null;
      parentId: string | null;
    }>;
  },
) {
  const [row] = await db
    .update(categories)
    .set(params.patch)
    .where(and(eq(categories.id, params.id), eq(categories.userId, params.userId)))
    .returning(categoryFields);
  return row;
}

export async function deleteCategory(db: Database, params: { id: string; userId: string }) {
  const [deleted] = await db
    .delete(categories)
    .where(and(eq(categories.id, params.id), eq(categories.userId, params.userId)))
    .returning({ id: categories.id });
  return deleted;
}
