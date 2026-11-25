import { aggregateCategoryTotals, effectiveCategoryBreakdown } from "../allocations/math";

// Spend by category with allocations applied. Inputs are signed debit amounts
// (negative centimes); the result reports spend as positive centimes.
//
// Cash withdrawals are special: until the user says how the cash was spent, the
// unallocated part of a withdrawal is reported as "unallocated cash", never under the
// withdrawal's own category and never as "uncategorized". Allocated parts of any debit
// go to the allocation's category.

/** Debits without allocations, already summed in SQL per (category, is cash). */
export type UnsplitSpendRow = {
  categoryId: string | null;
  isCash: boolean;
  amount: number;
};

/** One debit that has allocations, with its parts in allocation order. */
export type SplitSpendItem = {
  transaction: { amount: number; categoryId: string | null; isCash: boolean };
  allocations: readonly { amount: number; categoryId: string }[];
};

/** A joined row (transaction x allocation) as returned by SQL, ordered by transaction. */
export type SplitSpendRow = {
  transactionId: string;
  amount: number;
  categoryId: string | null;
  isCash: boolean;
  allocationAmount: number;
  allocationCategoryId: string;
};

export type CategoryInfo = {
  id: string;
  name: string;
  color: string | null;
  kind: string;
};

export type CategorySpend = {
  categoryId: string;
  name: string;
  color: string | null;
  kind: string;
  /** Positive centimes spent. */
  amount: number;
};

export type SpendByCategory = {
  /** Categorized spend, largest first. */
  categories: CategorySpend[];
  /** Positive centimes of non-cash debits without a category. */
  uncategorized: number;
  /** Positive centimes of cash withdrawals not yet allocated. */
  unallocatedCash: number;
  /** Positive centimes of all debits: categories + uncategorized + unallocated cash. */
  total: number;
};

/** Groups joined transaction x allocation rows into one item per transaction. */
export function groupSplitRows(rows: readonly SplitSpendRow[]): SplitSpendItem[] {
  const items = new Map<
    string,
    SplitSpendItem & { allocations: { amount: number; categoryId: string }[] }
  >();
  for (const row of rows) {
    let item = items.get(row.transactionId);
    if (!item) {
      item = {
        transaction: { amount: row.amount, categoryId: row.categoryId, isCash: row.isCash },
        allocations: [],
      };
      items.set(row.transactionId, item);
    }
    item.allocations.push({ amount: row.allocationAmount, categoryId: row.allocationCategoryId });
  }
  return [...items.values()];
}

export function buildSpendByCategory(
  unsplit: readonly UnsplitSpendRow[],
  split: readonly SplitSpendItem[],
  categories: readonly CategoryInfo[],
): SpendByCategory {
  // Signed totals per category (null = uncategorized) for everything except the
  // unallocated part of cash withdrawals.
  const items: Parameters<typeof aggregateCategoryTotals>[0][number][] = [];
  let cash = 0;

  for (const row of unsplit) {
    if (row.isCash) cash += row.amount;
    else items.push({ transaction: row, allocations: [] });
  }

  for (const item of split) {
    if (!item.transaction.isCash) {
      items.push(item);
      continue;
    }
    for (const entry of effectiveCategoryBreakdown(item.transaction, item.allocations)) {
      if (entry.source === "parent") cash += entry.amount;
      else items.push({ transaction: entry, allocations: [] });
    }
  }

  const totals = aggregateCategoryTotals(items);
  const info = new Map(categories.map((category) => [category.id, category]));
  const result: CategorySpend[] = [];
  let uncategorized = 0;
  for (const [categoryId, signed] of totals) {
    const amount = 0 - signed;
    const category = categoryId === null ? undefined : info.get(categoryId);
    if (!category) {
      // Unknown ids (a category deleted since) count as uncategorized.
      uncategorized += amount;
      continue;
    }
    if (amount === 0) continue;
    result.push({
      categoryId: category.id,
      name: category.name,
      color: category.color,
      kind: category.kind,
      amount,
    });
  }
  result.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  const unallocatedCash = 0 - cash;
  const categorized = result.reduce((sum, entry) => sum + entry.amount, 0);
  return {
    categories: result,
    uncategorized,
    unallocatedCash,
    total: categorized + uncategorized + unallocatedCash,
  };
}
