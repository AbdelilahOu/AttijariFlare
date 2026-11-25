import { describe, expect, test } from "vite-plus/test";

import { buildMonthlyTotals, closingBalancesByMonth } from "./monthly";
import { addMonths, isMonth, listMonths, monthBounds, monthOf } from "./months";
import { summarizeStatementError } from "./review";
import { buildSpendByCategory, groupSplitRows } from "./spend";

const MAD = (value: number) => value * 100;

const categories = [
  { id: "food", name: "Food", color: "#22c55e", kind: "expense" },
  { id: "transport", name: "Transport", color: null, kind: "expense" },
  { id: "cash", name: "Cash", color: null, kind: "expense" },
];

describe("months", () => {
  test("validates and extracts months", () => {
    expect(isMonth("2026-01")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(monthOf("2026-03-31")).toBe("2026-03");
    expect(monthOf(null)).toBeNull();
    expect(monthOf("garbage")).toBeNull();
  });

  test("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-05", 0)).toBe("2026-05");
  });

  test("lists months and half-open bounds", () => {
    expect(listMonths("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(listMonths("2026-02", "2026-01")).toEqual([]);
    expect(monthBounds("2026-12", "2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });
});

describe("monthly totals", () => {
  test("net is money in plus money out and gaps are filled", () => {
    const totals = buildMonthlyTotals(
      [
        { month: "2026-01", moneyIn: MAD(1000), moneyOut: -MAD(400), transactionCount: 5 },
        { month: "2026-03", moneyIn: 0, moneyOut: -MAD(50), transactionCount: 1 },
      ],
      [{ periodStart: "2026-01-01", periodEnd: "2026-01-31", closingBalance: MAD(600) }],
    );
    expect(totals).toEqual([
      {
        month: "2026-01",
        moneyIn: MAD(1000),
        moneyOut: -MAD(400),
        net: MAD(600),
        transactionCount: 5,
        closingBalance: MAD(600),
      },
      {
        month: "2026-02",
        moneyIn: 0,
        moneyOut: 0,
        net: 0,
        transactionCount: 0,
        closingBalance: null,
      },
      {
        month: "2026-03",
        moneyIn: 0,
        moneyOut: -MAD(50),
        net: -MAD(50),
        transactionCount: 1,
        closingBalance: null,
      },
    ]);
  });

  test("coerces numeric strings from SQL", () => {
    const [row] = buildMonthlyTotals(
      [{ month: "2026-01", moneyIn: "100", moneyOut: "-40", transactionCount: "2" } as never],
      [],
    );
    expect(row).toMatchObject({ moneyIn: 100, moneyOut: -40, net: 60, transactionCount: 2 });
  });

  test("closing balance comes from the statement ending last in the month", () => {
    const balances = closingBalancesByMonth([
      { periodStart: "2026-02-01", periodEnd: "2026-02-15", closingBalance: 1 },
      { periodStart: "2026-02-16", periodEnd: "2026-02-28", closingBalance: 2 },
      { periodStart: "2026-03-01", periodEnd: null, closingBalance: 3 },
      { periodStart: "2026-04-01", periodEnd: "2026-04-30", closingBalance: null },
    ]);
    expect(Object.fromEntries(balances)).toEqual({ "2026-02": 2, "2026-03": 3 });
  });

  test("empty input gives an empty series", () => {
    expect(buildMonthlyTotals([], [])).toEqual([]);
  });
});

describe("spend by category", () => {
  test("unsplit debits go to their category, uncategorized and cash apart", () => {
    const spend = buildSpendByCategory(
      [
        { categoryId: "food", isCash: false, amount: -MAD(120) },
        { categoryId: "transport", isCash: false, amount: -MAD(30) },
        { categoryId: null, isCash: false, amount: -MAD(10) },
        { categoryId: "cash", isCash: true, amount: -MAD(500) },
        { categoryId: null, isCash: true, amount: -MAD(100) },
      ],
      [],
      categories,
    );
    expect(spend).toEqual({
      categories: [
        { categoryId: "food", name: "Food", color: "#22c55e", kind: "expense", amount: MAD(120) },
        {
          categoryId: "transport",
          name: "Transport",
          color: null,
          kind: "expense",
          amount: MAD(30),
        },
      ],
      uncategorized: MAD(10),
      unallocatedCash: MAD(600),
      total: MAD(760),
    });
  });

  test("allocations of a cash withdrawal move spend out of unallocated cash", () => {
    const spend = buildSpendByCategory(
      [{ categoryId: "food", isCash: false, amount: -MAD(40) }],
      [
        {
          transaction: { amount: -MAD(300), categoryId: "cash", isCash: true },
          allocations: [
            { amount: MAD(100), categoryId: "food" },
            { amount: MAD(50), categoryId: "transport" },
          ],
        },
      ],
      categories,
    );
    expect(spend.categories.map((c) => [c.categoryId, c.amount])).toEqual([
      ["food", MAD(140)],
      ["transport", MAD(50)],
    ]);
    expect(spend.unallocatedCash).toBe(MAD(150));
    expect(spend.uncategorized).toBe(0);
    expect(spend.total).toBe(MAD(340));
  });

  test("a split card payment keeps its remainder on its own category", () => {
    const spend = buildSpendByCategory(
      [],
      [
        {
          transaction: { amount: -MAD(200), categoryId: "food", isCash: false },
          allocations: [{ amount: MAD(80), categoryId: "transport" }],
        },
        {
          transaction: { amount: -MAD(50), categoryId: null, isCash: false },
          allocations: [{ amount: MAD(20), categoryId: "food" }],
        },
      ],
      categories,
    );
    expect(spend.categories.map((c) => [c.categoryId, c.amount])).toEqual([
      ["food", MAD(140)],
      ["transport", MAD(80)],
    ]);
    expect(spend.uncategorized).toBe(MAD(30));
    expect(spend.unallocatedCash).toBe(0);
    expect(spend.total).toBe(MAD(250));
  });

  test("a fully allocated withdrawal leaves no unallocated cash", () => {
    const spend = buildSpendByCategory(
      [],
      [
        {
          transaction: { amount: -MAD(100), categoryId: "cash", isCash: true },
          allocations: [{ amount: MAD(100), categoryId: "food" }],
        },
      ],
      categories,
    );
    expect(spend.unallocatedCash).toBe(0);
    expect(spend.categories).toHaveLength(1);
  });

  test("unknown category ids count as uncategorized", () => {
    const spend = buildSpendByCategory(
      [{ categoryId: "deleted", isCash: false, amount: -MAD(5) }],
      [],
      categories,
    );
    expect(spend).toMatchObject({ categories: [], uncategorized: MAD(5), total: MAD(5) });
  });

  test("total equals the sum of all debits", () => {
    const unsplit = [
      { categoryId: "food", isCash: false, amount: -1234 },
      { categoryId: null, isCash: true, amount: -5000 },
    ];
    const split = [
      {
        transaction: { amount: -9999, categoryId: null, isCash: true },
        allocations: [
          { amount: 3333, categoryId: "food" },
          { amount: 9000, categoryId: "transport" },
        ],
      },
    ];
    const spend = buildSpendByCategory(unsplit, split, categories);
    expect(spend.total).toBe(1234 + 5000 + 9999);
  });

  test("groups joined rows into one item per transaction in order", () => {
    const items = groupSplitRows([
      {
        transactionId: "t1",
        amount: -300,
        categoryId: "cash",
        isCash: true,
        allocationAmount: 100,
        allocationCategoryId: "food",
      },
      {
        transactionId: "t1",
        amount: -300,
        categoryId: "cash",
        isCash: true,
        allocationAmount: 50,
        allocationCategoryId: "transport",
      },
      {
        transactionId: "t2",
        amount: -10,
        categoryId: null,
        isCash: false,
        allocationAmount: 10,
        allocationCategoryId: "food",
      },
    ]);
    expect(items).toEqual([
      {
        transaction: { amount: -300, categoryId: "cash", isCash: true },
        allocations: [
          { amount: 100, categoryId: "food" },
          { amount: 50, categoryId: "transport" },
        ],
      },
      {
        transaction: { amount: -10, categoryId: null, isCash: false },
        allocations: [{ amount: 10, categoryId: "food" }],
      },
    ]);
  });
});

describe("summarizeStatementError", () => {
  test("describes reconciliation errors", () => {
    expect(
      summarizeStatementError(JSON.stringify({ kind: "reconciliation", issues: [{}, {}] })),
    ).toBe("Balances do not reconcile (2 issues)");
    expect(summarizeStatementError(JSON.stringify({ kind: "reconciliation", issues: [] }))).toBe(
      "Balances do not reconcile",
    );
  });

  test("passes plain text through and truncates long text", () => {
    expect(summarizeStatementError(null)).toBeNull();
    expect(summarizeStatementError("Model timed out")).toBe("Model timed out");
    expect(summarizeStatementError("{not json")).toBe("{not json");
    expect(summarizeStatementError("x".repeat(500))).toHaveLength(160);
  });
});
