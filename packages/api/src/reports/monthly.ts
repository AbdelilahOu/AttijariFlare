import { listMonths, monthOf } from "./months";

// Monthly totals. Amounts are signed integer centimes: moneyIn >= 0, moneyOut <= 0.

/** One row of the SQL aggregation of transactions grouped by booking month. */
export type MonthAggregateRow = {
  month: string;
  moneyIn: number;
  moneyOut: number;
  transactionCount: number;
};

export type StatementBalance = {
  periodStart: string | null;
  periodEnd: string | null;
  closingBalance: number | null;
};

export type MonthlyTotals = {
  month: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  transactionCount: number;
  /** Closing balance of the statement whose period ends in this month, if any. */
  closingBalance: number | null;
};

/**
 * Closing balance per month, taken from the statement whose period ends in that month
 * (period start when the end is unknown). When several statements end in one month,
 * the one ending last wins.
 */
export function closingBalancesByMonth(
  statements: readonly StatementBalance[],
): Map<string, number> {
  const best = new Map<string, { date: string; balance: number }>();
  for (const statement of statements) {
    if (statement.closingBalance === null) continue;
    const date = statement.periodEnd ?? statement.periodStart;
    const month = monthOf(date);
    if (!month || !date) continue;
    const current = best.get(month);
    if (!current || date >= current.date) {
      best.set(month, { date, balance: statement.closingBalance });
    }
  }
  return new Map([...best].map(([month, { balance }]) => [month, balance]));
}

/**
 * Merges the per-month SQL aggregates with statement closing balances into one
 * ascending series. Months between the first and last month with data are filled
 * with zero totals so the series has no gaps.
 */
export function buildMonthlyTotals(
  rows: readonly MonthAggregateRow[],
  statements: readonly StatementBalance[],
): MonthlyTotals[] {
  const balances = closingBalancesByMonth(statements);
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const months = [...byMonth.keys(), ...balances.keys()].sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return [];
  return listMonths(first, last).map((month) => {
    const row = byMonth.get(month);
    const moneyIn = Number(row?.moneyIn ?? 0);
    const moneyOut = Number(row?.moneyOut ?? 0);
    return {
      month,
      moneyIn,
      moneyOut,
      net: moneyIn + moneyOut,
      transactionCount: Number(row?.transactionCount ?? 0),
      closingBalance: balances.get(month) ?? null,
    };
  });
}
