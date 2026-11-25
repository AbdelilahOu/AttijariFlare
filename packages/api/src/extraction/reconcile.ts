import type { ExtractedTransaction } from "./schema";

export type ReconciliationIssue =
  | { kind: "missing_opening_balance" }
  | { kind: "missing_closing_balance" }
  | { kind: "no_transactions" }
  | {
      kind: "total_mismatch";
      opening: number;
      sum: number;
      expectedClosing: number;
      closing: number;
      difference: number;
    }
  | {
      kind: "running_balance_mismatch";
      rowIndex: number;
      expected: number;
      actual: number;
    };

export type Reconciliation = {
  ok: boolean;
  /** Sum of all transaction amounts, in centimes. */
  sum: number;
  /** "forward" when running balances follow the listed order, "reverse" when newest-first. */
  order: "forward" | "reverse" | null;
  /** Rows whose sign was flipped because the running balance proved it wrong. */
  signFixes: number[];
  issues: ReconciliationIssue[];
};

/** At most this many running-balance mismatches are reported. */
const MAX_ROW_ISSUES = 10;

/**
 * Checks opening + sum(amounts) == closing and, where rows carry a balance, that each
 * balance equals the previous balance plus the row amount. All values are centimes.
 *
 * When a row's balance delta equals the row amount with the opposite sign, the model got
 * the debit/credit side wrong; the sign is corrected (in the returned rows) and the row is
 * listed in `signFixes`. Statements listed newest-first are detected and checked in reverse.
 */
export function reconcile(input: {
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: ExtractedTransaction[];
}): { reconciliation: Reconciliation; transactions: ExtractedTransaction[] } {
  const forward = checkRunningBalances(input.openingBalance, input.transactions, false);
  const reverse = checkRunningBalances(input.openingBalance, input.transactions, true);
  const useReverse = forward.mismatches.length > 0 && reverse.mismatches.length === 0;
  const best = useReverse ? reverse : forward;
  const transactions = best.transactions;

  const issues: ReconciliationIssue[] = [];
  const sum = transactions.reduce((total, row) => total + row.amount, 0);

  if (transactions.length === 0) {
    issues.push({ kind: "no_transactions" });
  }
  if (input.openingBalance === null) {
    issues.push({ kind: "missing_opening_balance" });
  }
  if (input.closingBalance === null) {
    issues.push({ kind: "missing_closing_balance" });
  }
  if (input.openingBalance !== null && input.closingBalance !== null) {
    const expectedClosing = input.openingBalance + sum;
    if (expectedClosing !== input.closingBalance) {
      issues.push({
        kind: "total_mismatch",
        opening: input.openingBalance,
        sum,
        expectedClosing,
        closing: input.closingBalance,
        difference: input.closingBalance - expectedClosing,
      });
    }
  }
  issues.push(...best.mismatches.slice(0, MAX_ROW_ISSUES));

  const hasBalances = transactions.some((row) => row.balance_after !== null);
  return {
    reconciliation: {
      ok: issues.length === 0,
      sum,
      order: hasBalances ? (useReverse ? "reverse" : "forward") : null,
      signFixes: best.signFixes,
      issues,
    },
    transactions,
  };
}

function checkRunningBalances(
  openingBalance: number | null,
  rows: ExtractedTransaction[],
  reverse: boolean,
): {
  mismatches: Extract<ReconciliationIssue, { kind: "running_balance_mismatch" }>[];
  signFixes: number[];
  transactions: ExtractedTransaction[];
} {
  const transactions = rows.map((row) => ({ ...row }));
  const mismatches: Extract<ReconciliationIssue, { kind: "running_balance_mismatch" }>[] = [];
  const signFixes: number[] = [];
  const order = transactions.map((_, index) => index);
  if (reverse) {
    order.reverse();
  }

  let previous = openingBalance;
  for (const index of order) {
    const row = transactions[index];
    if (!row) {
      continue;
    }
    if (previous !== null && row.balance_after !== null) {
      const delta = row.balance_after - previous;
      if (delta !== row.amount) {
        if (delta === -row.amount && delta !== 0) {
          row.amount = delta;
          signFixes.push(index);
        } else {
          mismatches.push({
            kind: "running_balance_mismatch",
            rowIndex: index,
            expected: previous + row.amount,
            actual: row.balance_after,
          });
        }
      }
    }
    // Resync on every printed balance so one bad row is reported once, not for every row after it.
    if (row.balance_after !== null) {
      previous = row.balance_after;
    } else if (previous !== null) {
      previous += row.amount;
    }
  }
  return { mismatches, signFixes, transactions };
}
