import type { Database } from "@attijari-flare/db";
import {
  categories,
  merchants,
  statements,
  transactionAllocations,
  transactions,
  user,
} from "@attijari-flare/db/schema/index";
import { createTestDb } from "@attijari-flare/db/testing";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ingestStatement } from "./extraction/ingest";
import { redactMessage, safeErrorSummary } from "./log";
import {
  acceptPrivacy,
  deleteStatementData,
  getPrivacyStatus,
  PRIVACY_POLICY_VERSION,
  purgeUserData,
} from "./privacy";
import { createStatement, deleteStatement, StatementError } from "./statements";

// All fixtures are made up: no real statement, merchant or person.

class FakeR2 {
  objects = new Map<string, string>();
  failDeletes = 0;

  async put(key: string, value: string | ArrayBuffer) {
    this.objects.set(key, typeof value === "string" ? value : "pdf");
    return {};
  }
  async get(key: string) {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    return { arrayBuffer: async () => new TextEncoder().encode(value).buffer };
  }
  async list(options: { prefix?: string }) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix ?? ""));
    return { objects: keys.map((key) => ({ key })), truncated: false };
  }
  async delete(keys: string | string[]) {
    if (this.failDeletes > 0) {
      this.failDeletes -= 1;
      throw new Error("R2 unavailable");
    }
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

class FakeVectorize {
  ids = new Set<string>();
  failDeletes = 0;

  async deleteByIds(ids: string[]) {
    if (this.failDeletes > 0) {
      this.failDeletes -= 1;
      throw new Error("Vectorize unavailable");
    }
    for (const id of ids) this.ids.delete(id);
    return { mutationId: "m", count: ids.length };
  }
}

class FakeQueue {
  sent: unknown[] = [];
  async send(body: unknown) {
    this.sent.push(body);
  }
}

type Env = {
  STATEMENTS: R2Bucket;
  VECTORIZE: Vectorize;
  STATEMENT_INGEST: Queue<{ statementId: string }>;
  TXN_ENRICH: Queue<{ statementId: string }>;
  AI: Ai;
};

let db: Database;
let r2: FakeR2;
let vectors: FakeVectorize;
let env: Env;

function makeEnv(ai?: unknown): Env {
  return {
    STATEMENTS: r2 as unknown as R2Bucket,
    VECTORIZE: vectors as unknown as Vectorize,
    STATEMENT_INGEST: new FakeQueue() as unknown as Env["STATEMENT_INGEST"],
    TXN_ENRICH: new FakeQueue() as unknown as Env["TXN_ENRICH"],
    AI: (ai ?? {}) as Ai,
  };
}

const userA = "user-a";
const userB = "user-b";

async function addTransaction(values: {
  id: string;
  userId: string;
  statementId: string;
  merchantId: string | null;
  rowIndex: number;
  amount?: number;
}) {
  await db.insert(transactions).values({
    id: values.id,
    userId: values.userId,
    statementId: values.statementId,
    rowIndex: values.rowIndex,
    bookingDate: "2026-10-02",
    descriptionRaw: `PAIEMENT CB EXEMPLE ${values.id}`,
    amount: values.amount ?? -10_000,
    merchantId: values.merchantId,
    fingerprint: `fp-${values.id}`,
  });
}

/**
 * User A: statements s1 and s2, merchants m-only-s1 (used by s1 only) and m-shared (s1 and
 * s2), a split on one s1 transaction. User B: statement s3 with merchant m-other.
 */
async function seed() {
  await db.insert(user).values([
    { id: userA, name: "Exemple A", email: "a@example.test" },
    { id: userB, name: "Exemple B", email: "b@example.test" },
  ]);
  await db.insert(categories).values([
    { id: "cat-a", userId: userA, name: "Groceries", kind: "expense" },
    { id: "cat-a-child", userId: userA, name: "Bakery", kind: "expense", parentId: "cat-a" },
    { id: "cat-b", userId: userB, name: "Groceries", kind: "expense" },
  ]);
  await db.insert(statements).values([
    {
      id: "s1",
      userId: userA,
      r2Key: "statements/s1/original.pdf",
      fileName: "a1.pdf",
      sha256: "h1",
    },
    {
      id: "s2",
      userId: userA,
      r2Key: "statements/s2/original.pdf",
      fileName: "a2.pdf",
      sha256: "h2",
    },
    {
      id: "s3",
      userId: userB,
      r2Key: "statements/s3/original.pdf",
      fileName: "b1.pdf",
      sha256: "h3",
    },
  ]);
  await db.insert(merchants).values([
    {
      id: "m-only-s1",
      userId: userA,
      normalizedName: "only s1",
      vectorId: "m-only-s1",
      defaultCategoryId: "cat-a",
    },
    { id: "m-shared", userId: userA, normalizedName: "shared", vectorId: "m-shared" },
    // A vector written before vector_id was recorded (the enrich step writes the vector first).
    { id: "m-unlinked", userId: userA, normalizedName: "unlinked", vectorId: null },
    { id: "m-other", userId: userB, normalizedName: "other", vectorId: "m-other" },
  ]);
  await addTransaction({
    id: "t1",
    userId: userA,
    statementId: "s1",
    merchantId: "m-only-s1",
    rowIndex: 0,
  });
  await addTransaction({
    id: "t2",
    userId: userA,
    statementId: "s1",
    merchantId: "m-shared",
    rowIndex: 1,
  });
  await addTransaction({
    id: "t3",
    userId: userA,
    statementId: "s1",
    merchantId: "m-unlinked",
    rowIndex: 2,
  });
  await addTransaction({
    id: "t4",
    userId: userA,
    statementId: "s2",
    merchantId: "m-shared",
    rowIndex: 0,
  });
  await addTransaction({
    id: "t5",
    userId: userB,
    statementId: "s3",
    merchantId: "m-other",
    rowIndex: 0,
  });
  await db
    .insert(transactionAllocations)
    .values([
      { id: "al1", userId: userA, transactionId: "t1", amount: 5_000, categoryId: "cat-a-child" },
    ]);
  for (const id of ["s1", "s2", "s3"]) {
    r2.objects.set(`statements/${id}/original.pdf`, "pdf");
    r2.objects.set(`statements/${id}/extracted.md`, "md");
    r2.objects.set(`statements/${id}/extraction.json`, "{}");
  }
  for (const id of ["m-only-s1", "m-shared", "m-unlinked", "m-other"]) vectors.ids.add(id);
}

const ids = async <T extends { id: string }>(rows: Promise<T[]>) =>
  (await rows).map((row) => row.id).sort();

beforeEach(async () => {
  db = await createTestDb();
  r2 = new FakeR2();
  vectors = new FakeVectorize();
  env = makeEnv();
  await seed();
});

describe("deleteStatementData", () => {
  it("deletes the statement's R2 objects, rows, splits and orphaned merchants with their vectors", async () => {
    const result = await deleteStatementData({ db, env, userId: userA }, "s1");

    expect(result).toEqual({ r2Objects: 3, merchants: 2 });
    expect([...r2.objects.keys()].filter((key) => key.startsWith("statements/s1/"))).toEqual([]);
    expect(r2.objects.has("statements/s2/original.pdf")).toBe(true);
    expect(await ids(db.select({ id: statements.id }).from(statements))).toEqual(["s2", "s3"]);
    expect(await ids(db.select({ id: transactions.id }).from(transactions))).toEqual(["t4", "t5"]);
    expect(
      await ids(db.select({ id: transactionAllocations.id }).from(transactionAllocations)),
    ).toEqual([]);
    expect(await ids(db.select({ id: merchants.id }).from(merchants))).toEqual([
      "m-other",
      "m-shared",
    ]);
    expect([...vectors.ids].sort()).toEqual(["m-other", "m-shared"]);
    // Categories are the user's own settings, not statement data.
    expect(await ids(db.select({ id: categories.id }).from(categories))).toHaveLength(3);
  });

  it("refuses another user's statement and deletes nothing", async () => {
    await expect(deleteStatementData({ db, env, userId: userB }, "s1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(r2.objects.size).toBe(9);
    expect(vectors.ids.size).toBe(4);
    expect(await ids(db.select({ id: transactions.id }).from(transactions))).toHaveLength(5);
  });

  it("finishes on a retry after a failure part-way, and is NOT_FOUND once done", async () => {
    vectors.failDeletes = 1;
    await expect(deleteStatementData({ db, env, userId: userA }, "s1")).rejects.toThrow(
      "Vectorize unavailable",
    );
    // R2 is already empty for s1, but the rows that say what to delete are still there.
    expect(await ids(db.select({ id: statements.id }).from(statements))).toContain("s1");

    await deleteStatementData({ db, env, userId: userA }, "s1");
    expect(await ids(db.select({ id: statements.id }).from(statements))).toEqual(["s2", "s3"]);
    expect(vectors.ids.has("m-only-s1")).toBe(false);

    await expect(deleteStatement({ db, env, userId: userA }, "s1")).rejects.toBeInstanceOf(
      StatementError,
    );
  });

  it("deletes the last statement of a merchant shared by two statements", async () => {
    await deleteStatementData({ db, env, userId: userA }, "s1");
    await deleteStatementData({ db, env, userId: userA }, "s2");
    expect(await ids(db.select({ id: merchants.id }).from(merchants))).toEqual(["m-other"]);
    expect([...vectors.ids]).toEqual(["m-other"]);
  });
});

describe("purgeUserData", () => {
  it("deletes every R2 object, vector and finance row of the user, and nothing of others", async () => {
    const result = await purgeUserData({ db, env }, userA);

    expect(result).toEqual({ statements: 2, r2Objects: 6, vectors: 3 });
    expect([...r2.objects.keys()].every((key) => key.startsWith("statements/s3/"))).toBe(true);
    expect([...vectors.ids]).toEqual(["m-other"]);
    for (const table of [statements, transactions, merchants, categories, transactionAllocations]) {
      const rows = await db.select({ userId: table.userId }).from(table);
      expect(rows.every((row) => row.userId === userB)).toBe(true);
    }
    expect(await ids(db.select({ id: transactions.id }).from(transactions))).toEqual(["t5"]);
  });

  it("is resumable: a failure leaves the rows that list what is left, and a retry completes", async () => {
    r2.failDeletes = 1;
    await expect(purgeUserData({ db, env }, userA)).rejects.toThrow("R2 unavailable");
    expect(await ids(db.select({ id: statements.id }).from(statements))).toEqual([
      "s1",
      "s2",
      "s3",
    ]);

    await purgeUserData({ db, env }, userA);
    await purgeUserData({ db, env }, userA);
    expect(await ids(db.select({ id: statements.id }).from(statements))).toEqual(["s3"]);
    expect(r2.objects.size).toBe(3);
  });

  it("lets the user row be deleted afterwards (no foreign key left pointing at it)", async () => {
    await purgeUserData({ db, env }, userA);
    await db.delete(user).where(eq(user.id, userA));
    expect(await ids(db.select({ id: user.id }).from(user))).toEqual([userB]);
  });
});

describe("upload consent", () => {
  const pdf = () => new File([new TextEncoder().encode("%PDF-1.4 made up")], "exemple.pdf");

  it("refuses an upload before the notice is accepted, records acceptance, then accepts", async () => {
    expect((await getPrivacyStatus({ db, userId: userA })).accepted).toBe(false);
    await expect(createStatement({ db, env, userId: userA }, pdf())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect([...r2.objects.keys()].filter((key) => key.endsWith("exemple.pdf"))).toEqual([]);

    const now = new Date("2026-11-26T10:00:00Z");
    const status = await acceptPrivacy({ db, userId: userA, now });
    expect(status).toMatchObject({
      accepted: true,
      acceptedVersion: PRIVACY_POLICY_VERSION,
      acceptedAt: now,
    });

    const statement = await createStatement({ db, env, userId: userA }, pdf());
    expect(statement.status).toBe("uploaded");
    expect((await getPrivacyStatus({ db, userId: userB })).accepted).toBe(false);
  });

  it("asks again when the accepted version is not the current one", async () => {
    await db
      .update(user)
      .set({ privacyAcceptedAt: new Date(), privacyPolicyVersion: "2000-01-01" })
      .where(eq(user.id, userA));
    expect((await getPrivacyStatus({ db, userId: userA })).accepted).toBe(false);
  });
});

describe("temporary extraction artifacts", () => {
  const markdown = `Releve de compte exemple\n${"Ligne de releve exemple ".repeat(10)}`;
  const answer = (closing: number) => ({
    account_label: null,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    opening_balance: 1000,
    closing_balance: closing,
    transactions: [
      {
        booking_date: "2026-10-02",
        value_date: null,
        description: "PAIEMENT CB EXEMPLE",
        amount: -10,
        balance_after: 990,
        type: "card_payment",
      },
    ],
  });

  async function ingest(closing: number) {
    const ai = { toMarkdown: async () => ({ format: "markdown", data: markdown }) };
    await db.insert(statements).values({
      id: "s9",
      userId: userA,
      r2Key: "statements/s9/original.pdf",
      fileName: "a9.pdf",
      sha256: "h9",
    });
    r2.objects.set("statements/s9/original.pdf", "pdf");
    return ingestStatement(
      {
        db,
        env: makeEnv(ai),
        runModel: async () => ({
          data: answer(closing),
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      },
      "s9",
    );
  }

  it("deletes extracted.md and extraction.json once a statement parses cleanly", async () => {
    const result = await ingest(990);
    expect(result.status).toBe("parsed");
    expect([...r2.objects.keys()].filter((key) => key.startsWith("statements/s9/"))).toEqual([
      "statements/s9/original.pdf",
    ]);
  });

  it("keeps them while the statement needs review", async () => {
    const result = await ingest(500);
    expect(result.status).toBe("needs_review");
    expect(r2.objects.has("statements/s9/extracted.md")).toBe(true);
    expect(r2.objects.has("statements/s9/extraction.json")).toBe(true);
  });

  it("removes what a run left behind when the statement was deleted", async () => {
    r2.objects.set("statements/gone/extracted.md", "md");
    await expect(ingestStatement({ db, env }, "gone")).rejects.toThrow("statement_not_found");
    expect(r2.objects.has("statements/gone/extracted.md")).toBe(false);
  });
});

describe("log redaction", () => {
  it("drops the bound values Drizzle puts in a query error", () => {
    const error = new Error(
      'Failed query: insert into "transactions" ("description_raw", "amount") values (?, ?)\nparams: PAIEMENT CB EXEMPLE,-10000',
    );
    error.cause = new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT");
    const summary = safeErrorSummary(error);
    expect(summary.message).not.toContain("EXEMPLE");
    expect(summary.message).not.toContain("10000");
    expect(summary.message).toContain("[redacted]");
  });

  it("drops quoted input from JSON parse errors", () => {
    let error: unknown;
    try {
      JSON.parse("Solde exemple 1 234,56 MAD");
    } catch (caught) {
      error = caught;
    }
    expect(safeErrorSummary(error).message).not.toContain("1 234,56");
    expect(redactMessage(`Unexpected token 'S', "Solde exem"... is not valid JSON`)).toBe(
      "Unexpected token [redacted], [redacted]... is not valid JSON",
    );
  });
});
