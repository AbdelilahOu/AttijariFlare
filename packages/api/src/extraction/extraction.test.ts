import { describe, expect, it } from "vite-plus/test";

import { chunkMarkdown, hasUsableText, splitChunk } from "./chunk";
import {
  estimateNeurons,
  extractStatement,
  ExtractionError,
  mergeChunks,
  type RunModel,
} from "./extract";
import { fingerprintTransactions, normalizeDescription } from "./fingerprint";
import { parseAmountToCentimes } from "./money";
import { buildChunkMessages } from "./prompt";
import { reconcile } from "./reconcile";
import { isExtractionStale, STALE_EXTRACTION_MS } from "./stale";
import { chunkExtractionSchema, type ExtractedTransaction, normalizeDate } from "./schema";

// All fixtures are made up.

const row = (overrides: Partial<ExtractedTransaction> = {}): ExtractedTransaction => ({
  booking_date: "2026-10-02",
  value_date: null,
  description: "PAIEMENT CARTE MARJANE",
  amount: -10_000,
  balance_after: null,
  type: "card_payment",
  ...overrides,
});

describe("parseAmountToCentimes", () => {
  it("converts numbers and French formatted strings", () => {
    expect(parseAmountToCentimes(-123.45)).toBe(-12_345);
    expect(parseAmountToCentimes(0.1 + 0.2)).toBe(30);
    expect(parseAmountToCentimes("1 234,56")).toBe(123_456);
    expect(parseAmountToCentimes("1.234,5")).toBe(123_450);
    expect(parseAmountToCentimes("12,345.67")).toBe(1_234_567);
    expect(parseAmountToCentimes("-250,00 MAD")).toBe(-25_000);
    expect(parseAmountToCentimes("250,00-")).toBe(-25_000);
    expect(parseAmountToCentimes("1 000 DH")).toBe(100_000);
    expect(parseAmountToCentimes("3000")).toBe(300_000);
  });

  it("rejects non amounts", () => {
    expect(parseAmountToCentimes("abc")).toBeNull();
    expect(parseAmountToCentimes("")).toBeNull();
    expect(parseAmountToCentimes(Number.NaN)).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("accepts ISO and day-first dates", () => {
    expect(normalizeDate("2026-10-05")).toBe("2026-10-05");
    expect(normalizeDate("5/10/2026")).toBe("2026-10-05");
    expect(normalizeDate("05.10.26")).toBe("2026-10-05");
  });

  it("rejects impossible dates", () => {
    expect(normalizeDate("2026-02-30")).toBeNull();
    expect(normalizeDate("10/2026")).toBeNull();
  });
});

describe("chunkExtractionSchema", () => {
  it("validates and converts a model answer", () => {
    const parsed = chunkExtractionSchema.parse({
      account_label: " Compte courant ****0000 ",
      period_start: "01/10/2026",
      period_end: "2026-10-31",
      opening_balance: 1000.5,
      closing_balance: "900,50",
      transactions: [
        {
          booking_date: "2026-10-03",
          value_date: null,
          description: "RETRAIT GAB",
          amount: -100,
          balance_after: 900.5,
          type: "cash_withdrawal",
        },
        {
          booking_date: "2026-10-04",
          description: "Something",
          amount: 0,
          type: "unknown_kind",
        },
      ],
    });
    expect(parsed.account_label).toBe("Compte courant ****0000");
    expect(parsed.period_start).toBe("2026-10-01");
    expect(parsed.opening_balance).toBe(100_050);
    expect(parsed.closing_balance).toBe(90_050);
    expect(parsed.transactions[0]?.amount).toBe(-10_000);
    expect(parsed.transactions[1]?.type).toBe("other");
    expect(parsed.transactions[1]?.balance_after).toBeNull();
  });

  it("rejects rows without a date", () => {
    const result = chunkExtractionSchema.safeParse({
      account_label: null,
      period_start: null,
      period_end: null,
      opening_balance: null,
      closing_balance: null,
      transactions: [{ booking_date: "sometime", description: "X", amount: 1, type: "other" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("chunking", () => {
  it("detects a missing text layer", () => {
    expect(hasUsableText("# page 1\n\n![image](x.png)\n")).toBe(false);
    expect(hasUsableText("RETRAIT GAB 100,00 ".repeat(5))).toBe(true);
    expect(hasUsableText("سحب نقدي من الشباك الآلي ".repeat(3))).toBe(true);
  });

  it("splits on line boundaries without losing text", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `| 0${i % 9}/10 | ROW ${i} | -10,00 |`);
    const markdown = lines.join("\n");
    const chunks = chunkMarkdown(markdown, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    expect(chunks.join("\n")).toBe(markdown);
  });

  it("splits a single overlong line on whitespace", () => {
    const chunks = chunkMarkdown("word ".repeat(100), 50);
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true);
  });

  it("halves a chunk", () => {
    expect(splitChunk("a\nb\nc")).toEqual(["a\nb", "c"]);
    expect(splitChunk("single")).toBeNull();
  });
});

describe("prompt", () => {
  it("adds part numbers and header context for later chunks", () => {
    const messages = buildChunkMessages({ chunk: "ROWS", index: 1, total: 3, header: "HEAD" });
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.content).toContain("part 2 of 3");
    expect(messages[1]?.content).toContain("<context>\nHEAD\n</context>");
    expect(messages[1]?.content).toContain("<statement>\nROWS\n</statement>");
  });
});

describe("reconcile", () => {
  it("passes when opening + sum equals closing and balances follow", () => {
    const { reconciliation } = reconcile({
      openingBalance: 100_000,
      closingBalance: 120_000,
      transactions: [
        row({ amount: -30_000, balance_after: 70_000 }),
        row({ amount: 50_000, balance_after: 120_000, type: "salary" }),
      ],
    });
    expect(reconciliation).toMatchObject({ ok: true, sum: 20_000, order: "forward", issues: [] });
  });

  it("reports a total mismatch with the difference", () => {
    const { reconciliation } = reconcile({
      openingBalance: 100_000,
      closingBalance: 50_000,
      transactions: [row({ amount: -30_000 })],
    });
    expect(reconciliation.ok).toBe(false);
    expect(reconciliation.issues).toContainEqual({
      kind: "total_mismatch",
      opening: 100_000,
      sum: -30_000,
      expectedClosing: 70_000,
      closing: 50_000,
      difference: -20_000,
    });
  });

  it("reports a running balance mismatch once and resyncs", () => {
    const { reconciliation } = reconcile({
      openingBalance: 100_000,
      closingBalance: 60_000,
      transactions: [
        row({ amount: -10_000, balance_after: 85_000 }),
        row({ amount: -25_000, balance_after: 60_000 }),
      ],
    });
    const rowIssues = reconciliation.issues.filter(
      (issue) => issue.kind === "running_balance_mismatch",
    );
    expect(rowIssues).toEqual([
      { kind: "running_balance_mismatch", rowIndex: 0, expected: 90_000, actual: 85_000 },
    ]);
  });

  it("fixes a debit given with the wrong sign", () => {
    const { reconciliation, transactions } = reconcile({
      openingBalance: 100_000,
      closingBalance: 90_000,
      transactions: [row({ amount: 10_000, balance_after: 90_000 })],
    });
    expect(reconciliation.ok).toBe(true);
    expect(reconciliation.signFixes).toEqual([0]);
    expect(transactions[0]?.amount).toBe(-10_000);
  });

  it("detects newest-first statements", () => {
    const { reconciliation } = reconcile({
      openingBalance: 100_000,
      closingBalance: 120_000,
      transactions: [
        row({ amount: 50_000, balance_after: 120_000 }),
        row({ amount: -30_000, balance_after: 70_000 }),
      ],
    });
    expect(reconciliation).toMatchObject({ ok: true, order: "reverse" });
  });

  it("needs review when balances are missing", () => {
    const { reconciliation } = reconcile({
      openingBalance: null,
      closingBalance: null,
      transactions: [],
    });
    expect(reconciliation.issues.map((issue) => issue.kind)).toEqual([
      "no_transactions",
      "missing_opening_balance",
      "missing_closing_balance",
    ]);
  });
});

describe("fingerprints", () => {
  it("normalizes French and Arabic labels", () => {
    expect(normalizeDescription("  Retrait GAB - Agence Maârif ")).toBe(
      "retrait gab agence maarif",
    );
    expect(normalizeDescription("سَحْب  نقدي")).toBe("سحب نقدي");
  });

  it("is deterministic and keeps identical rows apart with an occurrence counter", async () => {
    const rows = [row(), row(), row({ amount: -20_000 })];
    const first = await fingerprintTransactions("user-1", rows);
    const again = await fingerprintTransactions("user-1", rows);
    expect(first).toEqual(again);
    expect(new Set(first).size).toBe(3);
    expect(first[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores description formatting and is scoped to the user", async () => {
    const [a] = await fingerprintTransactions("user-1", [
      row({ description: "Paiement carte, MARJANE" }),
    ]);
    const [b] = await fingerprintTransactions("user-1", [
      row({ description: "PAIEMENT CARTE MARJANE" }),
    ]);
    const [c] = await fingerprintTransactions("user-2", [row()]);
    expect(a).toBe(b);
    expect(c).not.toBe(b);
  });
});

describe("extractStatement", () => {
  const answer = (overrides: Record<string, unknown> = {}) => ({
    account_label: null,
    period_start: null,
    period_end: null,
    opening_balance: null,
    closing_balance: null,
    transactions: [],
    ...overrides,
  });
  const usage = { inputTokens: 1000, outputTokens: 100 };

  it("merges chunks in order and estimates neurons", async () => {
    const answers = [
      answer({
        account_label: "Compte ****0000",
        period_start: "2026-10-01",
        opening_balance: 1000,
        transactions: [
          {
            booking_date: "2026-10-02",
            value_date: null,
            description: "A",
            amount: -10,
            balance_after: 990,
            type: "fee",
          },
        ],
      }),
      answer({
        period_end: "2026-10-31",
        closing_balance: 980,
        transactions: [
          {
            booking_date: "2026-10-05",
            value_date: null,
            description: "B",
            amount: -10,
            balance_after: 980,
            type: "fee",
          },
        ],
      }),
    ];
    const calls: string[] = [];
    const runModel: RunModel = async (messages) => {
      calls.push(messages[1]?.content ?? "");
      return { data: answers[calls.length - 1], usage };
    };
    const markdown = `${"x".repeat(90)}\n${"y".repeat(90)}`;
    const result = await extractStatement(markdown, runModel, { chunkMaxChars: 100 });

    expect(result.chunks).toBe(2);
    expect(calls[1]).toContain("<context>");
    expect(result).toMatchObject({
      accountLabel: "Compte ****0000",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      openingBalance: 100_000,
      closingBalance: 98_000,
    });
    expect(result.transactions.map((t) => t.description)).toEqual(["A", "B"]);
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 200 });
    expect(result.neuronsEstimate).toBe(estimateNeurons(result.usage));
  });

  it("retries invalid JSON with the validation error", async () => {
    const replies: unknown[] = ["not json", `\`\`\`json\n${JSON.stringify(answer())}\n\`\`\``];
    const seen: number[] = [];
    const runModel: RunModel = async (messages) => {
      seen.push(messages.length);
      return { data: replies.shift(), usage };
    };
    const result = await extractStatement("some statement text", runModel);
    expect(result.transactions).toEqual([]);
    expect(seen).toEqual([2, 3]);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it("halves a chunk that keeps failing, then gives up", async () => {
    let calls = 0;
    const halving: RunModel = async (messages) => {
      calls++;
      const isHalf = !(messages[1]?.content ?? "").includes("line 1\nline 2\nline 3\nline 4");
      return { data: isHalf ? answer() : "{ truncated", usage };
    };
    await expect(
      extractStatement("line 1\nline 2\nline 3\nline 4", halving),
    ).resolves.toMatchObject({ transactions: [] });
    expect(calls).toBe(4);

    const broken: RunModel = async () => ({ data: "{", usage });
    await expect(extractStatement("line 1\nline 2", broken)).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it("mergeChunks prefers the first opening and the last closing balance", () => {
    const parsed = [
      chunkExtractionSchema.parse(answer({ opening_balance: 1, closing_balance: 2 })),
      chunkExtractionSchema.parse(answer({ opening_balance: 3, closing_balance: 4 })),
    ];
    expect(mergeChunks(parsed)).toMatchObject({ openingBalance: 100, closingBalance: 400 });
  });
});

describe("isExtractionStale", () => {
  const now = new Date("2026-11-25T12:00:00Z");

  it("keeps a recent run", () => {
    expect(isExtractionStale(new Date(now.getTime() - 60_000), now)).toBe(false);
  });

  it("treats a run untouched for the threshold as stuck", () => {
    expect(isExtractionStale(new Date(now.getTime() - STALE_EXTRACTION_MS), now)).toBe(true);
  });
});
