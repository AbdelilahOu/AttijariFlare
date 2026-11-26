import type { Database } from "@finance-ttijari/db";
import { getTransactionForAllocation, listAllocations } from "@finance-ttijari/db/queries";

import { effectiveCategoryBreakdown, summarizeAllocations } from "./math";

/** Allocations of one transaction with the allocated total and unallocated remainder. */
export async function allocationState(db: Database, userId: string, transactionId: string) {
  const transaction = await getTransactionForAllocation(db, { userId, transactionId });
  if (!transaction) return undefined;
  const allocations = await listAllocations(db, { userId, transactionId });
  const { allocated, remainder } = summarizeAllocations(transaction.amount, allocations);
  return {
    transaction,
    allocations,
    allocated,
    remainder,
    breakdown: effectiveCategoryBreakdown(transaction, allocations),
  };
}
