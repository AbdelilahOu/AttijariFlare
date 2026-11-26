// Pure allocation math. All amounts are integer centimes (MAD).
// Transaction amounts are signed (debits negative); allocation parts are positive.

export type AllocationPart = {
  amount: number;
  categoryId: string;
  note?: string | null;
};

export type AllocationIssue =
  | { code: "NOT_A_DEBIT" }
  | { code: "PART_NOT_POSITIVE"; index: number }
  | { code: "PART_NOT_INTEGER"; index: number }
  | { code: "OVER_ALLOCATED"; allocated: number; available: number };

export type AllocationSummary = {
  /** |transaction amount| in centimes. */
  total: number;
  allocated: number;
  remainder: number;
};

export type AllocationValidation =
  | ({ ok: true } & AllocationSummary)
  | { ok: false; issues: AllocationIssue[] };

export function summarizeAllocations(
  transactionAmount: number,
  parts: readonly { amount: number }[],
): AllocationSummary {
  const total = Math.abs(transactionAmount);
  const allocated = parts.reduce((sum, part) => sum + part.amount, 0);
  return { total, allocated, remainder: total - allocated };
}

export function validateAllocations(
  transactionAmount: number,
  parts: readonly { amount: number }[],
): AllocationValidation {
  const issues: AllocationIssue[] = [];
  if (!Number.isInteger(transactionAmount) || transactionAmount >= 0) {
    issues.push({ code: "NOT_A_DEBIT" });
  }
  parts.forEach((part, index) => {
    if (!Number.isInteger(part.amount)) {
      issues.push({ code: "PART_NOT_INTEGER", index });
    } else if (part.amount <= 0) {
      issues.push({ code: "PART_NOT_POSITIVE", index });
    }
  });
  const summary = summarizeAllocations(transactionAmount, parts);
  if (summary.allocated > summary.total) {
    issues.push({ code: "OVER_ALLOCATED", allocated: summary.allocated, available: summary.total });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, ...summary };
}

export function describeAllocationIssue(issue: AllocationIssue): string {
  switch (issue.code) {
    case "NOT_A_DEBIT":
      return "Only debit transactions can be allocated";
    case "PART_NOT_POSITIVE":
      return `Part ${issue.index + 1} must be greater than 0`;
    case "PART_NOT_INTEGER":
      return `Part ${issue.index + 1} must be a whole number of centimes`;
    case "OVER_ALLOCATED":
      return `Parts total ${issue.allocated} centimes, more than the ${issue.available} available`;
  }
}

/**
 * Splits `total` centimes into `parts` integer amounts that sum exactly to `total`.
 * The leftover centimes from integer division go one each to the first parts,
 * so amounts differ by at most one centime.
 */
export function splitEqually(total: number, parts: number): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError("total must be a non-negative integer");
  }
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError("parts must be a positive integer");
  }
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

export type BreakdownEntry = {
  /** null when the transaction (or its remainder) has no category yet. */
  categoryId: string | null;
  /** Signed centimes, same sign as the transaction amount. */
  amount: number;
  source: "allocation" | "parent";
};

/**
 * Effective category breakdown of one transaction for reports.
 * Allocations override the parent category for their share; whatever is not
 * allocated stays on the transaction's own category. Amounts keep the transaction's
 * sign (debits negative) and always sum to the transaction amount.
 * Entries with the same category and source are merged; zero remainders are dropped.
 */
export function effectiveCategoryBreakdown(
  transaction: { amount: number; categoryId: string | null },
  allocations: readonly { amount: number; categoryId: string }[],
): BreakdownEntry[] {
  const sign = transaction.amount < 0 ? -1 : 1;
  const total = Math.abs(transaction.amount);
  // Clamp defensively so bad data can never produce more than the transaction itself.
  let left = total;
  const byCategory = new Map<string, number>();
  for (const allocation of allocations) {
    const take = Math.min(Math.max(allocation.amount, 0), left);
    if (take <= 0) continue;
    left -= take;
    byCategory.set(allocation.categoryId, (byCategory.get(allocation.categoryId) ?? 0) + take);
  }
  const entries: BreakdownEntry[] = [];
  for (const [categoryId, amount] of byCategory) {
    entries.push({ categoryId, amount: sign * amount, source: "allocation" });
  }
  if (left > 0) {
    entries.push({ categoryId: transaction.categoryId, amount: sign * left, source: "parent" });
  }
  return entries;
}

/**
 * Sums effective breakdowns across many transactions into signed totals per category.
 * The key `null` collects uncategorized amounts.
 */
export function aggregateCategoryTotals(
  items: readonly {
    transaction: { amount: number; categoryId: string | null };
    allocations: readonly { amount: number; categoryId: string }[];
  }[],
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const item of items) {
    for (const entry of effectiveCategoryBreakdown(item.transaction, item.allocations)) {
      totals.set(entry.categoryId, (totals.get(entry.categoryId) ?? 0) + entry.amount);
    }
  }
  return totals;
}
