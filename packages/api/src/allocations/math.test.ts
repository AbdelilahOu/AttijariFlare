import { describe, expect, test } from "vite-plus/test";

import {
  aggregateCategoryTotals,
  effectiveCategoryBreakdown,
  splitEqually,
  summarizeAllocations,
  validateAllocations,
} from "./math";
import { centimesToMad, parseMadToCentimes } from "./money";

const MAD = (value: number) => value * 100;

describe("validateAllocations", () => {
  test("accepts a 300 MAD withdrawal split 100/100/100", () => {
    const result = validateAllocations(-MAD(300), [
      { amount: MAD(100) },
      { amount: MAD(100) },
      { amount: MAD(100) },
    ]);
    expect(result).toEqual({ ok: true, total: MAD(300), allocated: MAD(300), remainder: 0 });
  });

  test("accepts a partial split and reports the remainder", () => {
    const result = validateAllocations(-MAD(300), [{ amount: MAD(120) }]);
    expect(result).toEqual({ ok: true, total: MAD(300), allocated: MAD(120), remainder: MAD(180) });
  });

  test("accepts an empty list (clears the split)", () => {
    expect(validateAllocations(-MAD(300), [])).toMatchObject({ ok: true, remainder: MAD(300) });
  });

  test("rejects over-allocation, even by one centime", () => {
    const result = validateAllocations(-MAD(300), [{ amount: MAD(200) }, { amount: MAD(100) + 1 }]);
    expect(result).toEqual({
      ok: false,
      issues: [{ code: "OVER_ALLOCATED", allocated: MAD(300) + 1, available: MAD(300) }],
    });
  });

  test("rejects credits and zero amounts", () => {
    expect(validateAllocations(MAD(300), [{ amount: MAD(10) }])).toMatchObject({
      ok: false,
      issues: [{ code: "NOT_A_DEBIT" }],
    });
    expect(validateAllocations(0, [])).toMatchObject({ ok: false });
  });

  test("rejects zero, negative and fractional parts", () => {
    const result = validateAllocations(-MAD(300), [{ amount: 0 }, { amount: -5 }, { amount: 1.5 }]);
    expect(result).toEqual({
      ok: false,
      issues: [
        { code: "PART_NOT_POSITIVE", index: 0 },
        { code: "PART_NOT_POSITIVE", index: 1 },
        { code: "PART_NOT_INTEGER", index: 2 },
      ],
    });
  });
});

describe("summarizeAllocations", () => {
  test("uses the absolute transaction amount", () => {
    expect(summarizeAllocations(-1000, [{ amount: 400 }])).toEqual({
      total: 1000,
      allocated: 400,
      remainder: 600,
    });
  });
});

describe("splitEqually", () => {
  test("splits evenly when divisible", () => {
    expect(splitEqually(MAD(300), 3)).toEqual([MAD(100), MAD(100), MAD(100)]);
  });

  test("hands leftover centimes to the first parts and keeps the exact sum", () => {
    const parts = splitEqually(MAD(100), 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(MAD(100));
  });

  test("handles more parts than centimes", () => {
    expect(splitEqually(2, 4)).toEqual([1, 1, 0, 0]);
  });

  test("rejects invalid input", () => {
    expect(() => splitEqually(100, 0)).toThrow(RangeError);
    expect(() => splitEqually(-1, 2)).toThrow(RangeError);
    expect(() => splitEqually(1.5, 2)).toThrow(RangeError);
  });
});

describe("effectiveCategoryBreakdown", () => {
  test("without allocations everything stays on the parent category", () => {
    expect(effectiveCategoryBreakdown({ amount: -MAD(300), categoryId: "cash" }, [])).toEqual([
      { categoryId: "cash", amount: -MAD(300), source: "parent" },
    ]);
  });

  test("allocations override the parent and the remainder stays on it", () => {
    const breakdown = effectiveCategoryBreakdown({ amount: -MAD(300), categoryId: "cash" }, [
      { amount: MAD(100), categoryId: "groceries" },
      { amount: MAD(50), categoryId: "transport" },
      { amount: MAD(50), categoryId: "groceries" },
    ]);
    expect(breakdown).toEqual([
      { categoryId: "groceries", amount: -MAD(150), source: "allocation" },
      { categoryId: "transport", amount: -MAD(50), source: "allocation" },
      { categoryId: "cash", amount: -MAD(100), source: "parent" },
    ]);
  });

  test("a full split leaves nothing on the parent", () => {
    const breakdown = effectiveCategoryBreakdown({ amount: -MAD(300), categoryId: null }, [
      { amount: MAD(100), categoryId: "groceries" },
      { amount: MAD(100), categoryId: "transport" },
      { amount: MAD(100), categoryId: "other" },
    ]);
    expect(breakdown.map((e) => e.source)).toEqual(["allocation", "allocation", "allocation"]);
    expect(breakdown.reduce((sum, e) => sum + e.amount, 0)).toBe(-MAD(300));
  });

  test("an uncategorized remainder is reported under null", () => {
    expect(
      effectiveCategoryBreakdown({ amount: -1000, categoryId: null }, [
        { amount: 400, categoryId: "a" },
      ]),
    ).toEqual([
      { categoryId: "a", amount: -400, source: "allocation" },
      { categoryId: null, amount: -600, source: "parent" },
    ]);
  });

  test("clamps over-allocated data so the sum never exceeds the transaction", () => {
    const breakdown = effectiveCategoryBreakdown({ amount: -1000, categoryId: "cash" }, [
      { amount: 800, categoryId: "a" },
      { amount: 800, categoryId: "b" },
    ]);
    expect(breakdown).toEqual([
      { categoryId: "a", amount: -800, source: "allocation" },
      { categoryId: "b", amount: -200, source: "allocation" },
    ]);
  });
});

describe("aggregateCategoryTotals", () => {
  test("sums effective amounts per category across transactions", () => {
    const totals = aggregateCategoryTotals([
      {
        transaction: { amount: -MAD(300), categoryId: "cash" },
        allocations: [{ amount: MAD(100), categoryId: "groceries" }],
      },
      { transaction: { amount: -MAD(40), categoryId: "groceries" }, allocations: [] },
    ]);
    expect(Object.fromEntries(totals)).toEqual({ groceries: -MAD(140), cash: -MAD(200) });
  });
});

describe("money", () => {
  test("parses MAD strings into centimes", () => {
    expect(parseMadToCentimes("100")).toBe(10000);
    expect(parseMadToCentimes("99.5")).toBe(9950);
    expect(parseMadToCentimes("1 234,56")).toBe(123456);
    expect(parseMadToCentimes("0.01")).toBe(1);
    expect(parseMadToCentimes("")).toBeNull();
    expect(parseMadToCentimes("-5")).toBeNull();
    expect(parseMadToCentimes("1.234")).toBeNull();
    expect(parseMadToCentimes("abc")).toBeNull();
  });

  test("formats centimes as MAD", () => {
    expect(centimesToMad(10050)).toBe("100.50");
    expect(centimesToMad(-300)).toBe("-3.00");
    expect(centimesToMad(0)).toBe("0.00");
  });
});
