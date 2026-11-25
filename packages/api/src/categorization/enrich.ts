import type { Database } from "@finance-ttijari/db";
import type { TransactionType } from "@finance-ttijari/db/schema/enums";
import { categories, merchants, statements, transactions } from "@finance-ttijari/db/schema/index";
import { and, count, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Bindings } from "../bindings";
import { estimateNeurons, type ModelUsage, type RunModel } from "../extraction/extract";
import { normalizeDescription } from "../extraction/fingerprint";
import {
  decideFromNeighbours,
  MERCHANT_DEFAULT_CONFIDENCE,
  merchantVectorMetadata,
  toNeighbourMatch,
  VECTOR_TOP_K,
} from "./decide";
import { merchantName } from "./merchant";
import {
  buildClassifyMessages,
  type ClassifyCategory,
  type ClassifyItem,
  mapClassification,
  MAX_ITEMS_PER_CALL,
  parseJsonResponse,
} from "./prompt";
import { createClassifyRunner, createWorkersAiEmbedder, type Embed } from "./workers-ai";

/** A failure that retrying cannot fix: the consumer logs it and acks. */
export class PermanentEnrichError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PermanentEnrichError";
  }
}

/** Longest merchant name stored. */
const MAX_MERCHANT_NAME = 120;
/** D1 allows 100 bound parameters per statement. */
const NAMES_PER_SELECT = 90;
const IDS_PER_UPDATE = 90;
const MERCHANTS_PER_INSERT = 10;
/** Vectorize queries per invocation; merchants beyond this go to the LLM. */
const MAX_KNN_QUERIES = 40;

export type EnrichDeps = {
  db: Database;
  env: Pick<Bindings, "AI" | "VECTORIZE">;
  embed?: Embed;
  runModel?: RunModel;
};

/** Counts only: never descriptions or amounts, so the result is safe to log. */
export type EnrichResult = {
  transactions: number;
  merchants: number;
  newMerchants: number;
  embedded: number;
  knnQueries: number;
  llmCalls: number;
  /** Rows categorized in this run, by how. "merchant" rows are stored with source vector. */
  categorized: { merchant: number; vector: number; llm: number };
  /** Rows left untouched because they already had a category (user or earlier run). */
  alreadyCategorized: number;
  uncategorized: number;
  neuronsEstimate: number;
};

type Decision = {
  categoryId: string;
  source: "vector" | "llm";
  confidence: number;
  via: "merchant" | "vector" | "llm";
};

type MerchantRow = {
  id: string;
  userId: string;
  normalizedName: string;
  vectorId: string | null;
  defaultCategoryId: string | null;
};

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function runBatch(db: Database, queries: BatchItem<"sqlite">[]): Promise<void> {
  const [first, ...rest] = queries;
  if (!first) return;
  await db.batch([first, ...rest]);
}

/** Text embedded for a merchant. */
export function merchantEmbeddingText(name: string): string {
  return name;
}

/**
 * Writes a merchant's vector with its current default category in the metadata. Vectorize
 * cannot update metadata alone, so the stored values are read back and upserted; the name is
 * embedded only when the merchant has no vector yet. Returns true when it embedded.
 */
export async function syncMerchantVector(
  deps: { db: Database; env: Pick<Bindings, "AI" | "VECTORIZE">; embed?: Embed },
  merchant: MerchantRow,
): Promise<boolean> {
  const { db, env } = deps;
  const [stored] = merchant.vectorId ? await env.VECTORIZE.getByIds([merchant.id]) : [];
  let values: number[] | undefined = stored?.values ? Array.from(stored.values) : undefined;
  const embedded = !values || values.length === 0;
  if (embedded) {
    const embed = deps.embed ?? createWorkersAiEmbedder(env.AI);
    [values] = await embed([merchantEmbeddingText(merchant.normalizedName)]);
  }
  if (!values) throw new Error("embedding returned no vector");
  await env.VECTORIZE.upsert([
    { id: merchant.id, values, metadata: merchantVectorMetadata(merchant) },
  ]);
  if (merchant.vectorId !== merchant.id) {
    await db.update(merchants).set({ vectorId: merchant.id }).where(eq(merchants.id, merchant.id));
  }
  return embedded;
}

/**
 * Categorizes the transactions of one statement:
 * 1. maps each description to a merchant and upserts `merchants`,
 * 2. embeds merchants seen for the first time and stores them in Vectorize,
 * 3. for rows without a category: merchant default category, else kNN over the user's
 *    confirmed merchants, else one batched LLM call against the user's categories.
 * Rows with category_source = user, and rows that already have a category, are never
 * changed. Safe to run again: merchants and vectors are upserts and only empty rows are filled.
 */
export async function enrichStatement(
  deps: EnrichDeps,
  statementId: string,
): Promise<EnrichResult> {
  const { db, env } = deps;
  const embed = deps.embed ?? createWorkersAiEmbedder(env.AI);

  const [statement] = await db
    .select({ id: statements.id, userId: statements.userId })
    .from(statements)
    .where(eq(statements.id, statementId))
    .limit(1);
  if (!statement) throw new PermanentEnrichError("statement_not_found");
  const { userId } = statement;

  const rows = await db
    .select({
      id: transactions.id,
      descriptionRaw: transactions.descriptionRaw,
      descriptionNormalized: transactions.descriptionNormalized,
      type: transactions.type,
      amount: transactions.amount,
      merchantId: transactions.merchantId,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(and(eq(transactions.statementId, statementId), eq(transactions.userId, userId)));

  const result: EnrichResult = {
    transactions: rows.length,
    merchants: 0,
    newMerchants: 0,
    embedded: 0,
    knnQueries: 0,
    llmCalls: 0,
    categorized: { merchant: 0, vector: 0, llm: 0 },
    alreadyCategorized: 0,
    uncategorized: 0,
    neuronsEstimate: 0,
  };
  if (rows.length === 0) return result;

  // 1. Merchants.
  const nameByRow = new Map<string, string>();
  for (const row of rows) {
    const name =
      merchantName(row.descriptionNormalized ?? row.descriptionRaw) ||
      normalizeDescription(row.descriptionRaw);
    if (name) nameByRow.set(row.id, name.slice(0, MAX_MERCHANT_NAME));
  }
  const names = [...new Set(nameByRow.values())];

  await runBatch(
    db,
    chunked(names, MERCHANTS_PER_INSERT).map((chunk) =>
      db
        .insert(merchants)
        .values(chunk.map((normalizedName) => ({ userId, normalizedName })))
        .onConflictDoNothing({ target: [merchants.userId, merchants.normalizedName] }),
    ),
  );
  const merchantRows: MerchantRow[] = (
    await Promise.all(
      chunked(names, NAMES_PER_SELECT).map((chunk) =>
        db
          .select({
            id: merchants.id,
            userId: merchants.userId,
            normalizedName: merchants.normalizedName,
            vectorId: merchants.vectorId,
            defaultCategoryId: merchants.defaultCategoryId,
          })
          .from(merchants)
          .where(and(eq(merchants.userId, userId), inArray(merchants.normalizedName, chunk))),
      ),
    )
  ).flat();
  const merchantByName = new Map(
    merchantRows.map((merchant) => [merchant.normalizedName, merchant]),
  );
  const merchantById = new Map(merchantRows.map((merchant) => [merchant.id, merchant]));
  result.merchants = merchantRows.length;

  // Link rows to their merchant.
  const merchantIdByRow = new Map<string, string>();
  const relink = new Map<string, string[]>();
  for (const row of rows) {
    const name = nameByRow.get(row.id);
    const merchant = name ? merchantByName.get(name) : undefined;
    if (!merchant) continue;
    merchantIdByRow.set(row.id, merchant.id);
    if (row.merchantId !== merchant.id) {
      relink.set(merchant.id, [...(relink.get(merchant.id) ?? []), row.id]);
    }
  }
  await runBatch(
    db,
    [...relink].flatMap(([merchantId, ids]) =>
      chunked(ids, IDS_PER_UPDATE).map((chunk) =>
        db
          .update(transactions)
          .set({ merchantId })
          .where(and(eq(transactions.statementId, statementId), inArray(transactions.id, chunk))),
      ),
    ),
  );

  // 2. Category decisions per merchant, for rows that have no category yet.
  const userCategories: ClassifyCategory[] = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(eq(categories.userId, userId));
  const knownCategoryIds = new Set(userCategories.map((category) => category.id));

  const pendingRows = rows.filter(
    (row) => row.categorySource !== "user" && row.categoryId === null,
  );
  result.alreadyCategorized = rows.length - pendingRows.length;
  const pendingMerchants = new Map<string, MerchantRow>();
  for (const row of pendingRows) {
    const merchantId = merchantIdByRow.get(row.id);
    const merchant = merchantId ? merchantById.get(merchantId) : undefined;
    if (merchant) pendingMerchants.set(merchant.id, merchant);
  }

  const decisions = new Map<string, Decision>();
  for (const merchant of pendingMerchants.values()) {
    if (merchant.defaultCategoryId && knownCategoryIds.has(merchant.defaultCategoryId)) {
      decisions.set(merchant.id, {
        categoryId: merchant.defaultCategoryId,
        source: "vector",
        confidence: MERCHANT_DEFAULT_CONFIDENCE,
        via: "merchant",
      });
    }
  }

  // kNN needs at least one confirmed merchant; skip every query when there is none.
  let undecided = [...pendingMerchants.values()].filter((merchant) => !decisions.has(merchant.id));
  const [confirmed] =
    undecided.length > 0
      ? await db
          .select({ n: count() })
          .from(merchants)
          .where(and(eq(merchants.userId, userId), isNotNull(merchants.defaultCategoryId)))
      : [{ n: 0 }];
  const knnMerchants = (confirmed?.n ?? 0) > 0 ? undecided.slice(0, MAX_KNN_QUERIES) : [];

  // 3. Embeddings: new merchants are stored, kNN candidates are queried.
  const newMerchants = merchantRows.filter((merchant) => merchant.vectorId === null);
  result.newMerchants = newMerchants.length;
  const toEmbed = [...new Map([...newMerchants, ...knnMerchants].map((m) => [m.id, m])).values()];
  const vectors = new Map<string, number[]>();
  if (toEmbed.length > 0) {
    const embeddings = await embed(toEmbed.map((m) => merchantEmbeddingText(m.normalizedName)));
    toEmbed.forEach((merchant, index) => {
      const values = embeddings[index];
      if (values) vectors.set(merchant.id, values);
    });
    result.embedded = toEmbed.length;
  }
  const newVectors = newMerchants.flatMap((merchant) => {
    const values = vectors.get(merchant.id);
    return values ? [{ id: merchant.id, values, metadata: merchantVectorMetadata(merchant) }] : [];
  });
  if (newVectors.length > 0) {
    await env.VECTORIZE.upsert(newVectors);
    await runBatch(
      db,
      chunked(
        newVectors.map((vector) => vector.id),
        IDS_PER_UPDATE,
      ).map((ids) =>
        db
          .update(merchants)
          .set({ vectorId: sql`${merchants.id}` })
          .where(inArray(merchants.id, ids)),
      ),
    );
  }

  const knnResults = await Promise.all(
    knnMerchants.map(async (merchant) => {
      const values = vectors.get(merchant.id);
      if (!values) return null;
      const response = await env.VECTORIZE.query(values, {
        topK: VECTOR_TOP_K,
        filter: { user_id: userId, confirmed: true },
        returnMetadata: "all",
      });
      const decision = decideFromNeighbours(
        response.matches.map((match) =>
          toNeighbourMatch({ score: match.score, metadata: match.metadata ?? null }),
        ),
        { knownCategoryIds, selfMerchantId: merchant.id },
      );
      return decision ? ([merchant.id, decision] as const) : null;
    }),
  );
  result.knnQueries = knnMerchants.length;
  for (const entry of knnResults) {
    if (!entry) continue;
    const [merchantId, decision] = entry;
    decisions.set(merchantId, { ...decision, source: "vector", via: "vector" });
  }

  // Persist merchant and vector decisions before the LLM call, so a failing call keeps them.
  const applyDecisions = async (merchantIds: string[]) =>
    runBatch(
      db,
      merchantIds.flatMap((merchantId) => {
        const decision = decisions.get(merchantId);
        if (!decision) return [];
        return [
          db
            .update(transactions)
            .set({
              categoryId: decision.categoryId,
              categorySource: decision.source,
              confidence: decision.confidence,
            })
            .where(
              and(
                eq(transactions.statementId, statementId),
                eq(transactions.merchantId, merchantId),
                isNull(transactions.categoryId),
                or(isNull(transactions.categorySource), ne(transactions.categorySource, "user")),
              ),
            ),
        ];
      }),
    );
  await applyDecisions([...decisions.keys()]);

  // 4. One batched LLM call for the merchants still undecided.
  undecided = [...pendingMerchants.values()].filter((merchant) => !decisions.has(merchant.id));
  if (undecided.length > 0 && userCategories.length > 0) {
    const runModel = deps.runModel ?? createClassifyRunner(env.AI);
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    const llmDecided: string[] = [];
    for (const batch of chunked(undecided, MAX_ITEMS_PER_CALL)) {
      const items: ClassifyItem[] = batch.map((merchant) => {
        const sample = pendingRows.find((row) => merchantIdByRow.get(row.id) === merchant.id);
        return {
          merchant: merchant.normalizedName,
          example: sample?.descriptionRaw ?? merchant.normalizedName,
          type: (sample?.type ?? "other") as TransactionType,
          direction: (sample?.amount ?? 0) < 0 ? "debit" : "credit",
        };
      });
      const response = await runModel(buildClassifyMessages({ categories: userCategories, items }));
      result.llmCalls += 1;
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      for (const decision of mapClassification(parseJsonResponse(response.data), {
        categories: userCategories,
        itemCount: items.length,
      })) {
        const merchant = batch[decision.index];
        if (!merchant) continue;
        decisions.set(merchant.id, {
          categoryId: decision.categoryId,
          source: "llm",
          confidence: decision.confidence,
          via: "llm",
        });
        llmDecided.push(merchant.id);
      }
    }
    result.neuronsEstimate = estimateNeurons(usage);
    await applyDecisions(llmDecided);
  }

  for (const row of pendingRows) {
    const merchantId = merchantIdByRow.get(row.id);
    const decision = merchantId ? decisions.get(merchantId) : undefined;
    if (decision) result.categorized[decision.via] += 1;
    else result.uncategorized += 1;
  }
  return result;
}
