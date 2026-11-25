import type { Database } from "./index";
import { type CategoryKind, categories } from "./schema";

export type DefaultCategory = {
  name: string;
  kind: CategoryKind;
  color: string;
};

export const defaultCategories: readonly DefaultCategory[] = [
  { name: "Groceries", kind: "expense", color: "#16a34a" },
  { name: "Restaurants", kind: "expense", color: "#ea580c" },
  { name: "Transport", kind: "expense", color: "#2563eb" },
  { name: "Fuel", kind: "expense", color: "#0891b2" },
  { name: "Rent", kind: "expense", color: "#7c3aed" },
  { name: "Utilities", kind: "expense", color: "#ca8a04" },
  { name: "Telecom", kind: "expense", color: "#0d9488" },
  { name: "Health", kind: "expense", color: "#dc2626" },
  { name: "Shopping", kind: "expense", color: "#db2777" },
  { name: "Entertainment", kind: "expense", color: "#9333ea" },
  { name: "Cash", kind: "expense", color: "#65a30d" },
  { name: "Fees", kind: "expense", color: "#57534e" },
  { name: "Salary", kind: "income", color: "#059669" },
  { name: "Transfers in", kind: "transfer", color: "#4f46e5" },
  { name: "Transfers out", kind: "transfer", color: "#6366f1" },
  { name: "Other", kind: "expense", color: "#6b7280" },
];

/**
 * Inserts the default categories for a user. Safe to call on every sign-in:
 * rows that already exist (matched on the unique (user_id, name) index) are left untouched,
 * so user edits to colors or kinds are preserved.
 */
export async function seedDefaultCategories(db: Database, userId: string): Promise<void> {
  await db
    .insert(categories)
    .values(defaultCategories.map((category) => ({ ...category, userId })))
    .onConflictDoNothing({ target: [categories.userId, categories.name] });
}
