/**
 * Cosine similarity from which a confirmed neighbour's category is copied (bge-m3).
 * Unrelated short merchant names score around 0.4 to 0.6 with this model, spelling variants
 * of one merchant (city suffix, truncation) 0.85 and above.
 */
export const VECTOR_MATCH_THRESHOLD = 0.82;

/** Neighbours requested per merchant. */
export const VECTOR_TOP_K = 5;

/** LLM answers below this confidence are dropped and the row stays uncategorized. */
export const MIN_LLM_CONFIDENCE = 0.3;

/**
 * Confidence stored when a row takes its merchant's default category. The merchant's own
 * vector is confirmed, so this is the similarity a kNN lookup would return for it.
 */
export const MERCHANT_DEFAULT_CONFIDENCE = 1;

export type NeighbourMatch = {
  score: number;
  merchantId: string | null;
  categoryId: string | null;
};

export type VectorDecision = { categoryId: string; confidence: number };

/**
 * Picks a category from the nearest confirmed merchants. Only matches at or above the
 * threshold whose category still exists count. Each category is scored by the sum of its
 * matches' similarities; ties go to the category with the single best match. The reported
 * confidence is that category's best similarity. Returns null when nothing qualifies.
 */
export function decideFromNeighbours(
  matches: readonly NeighbourMatch[],
  options: {
    knownCategoryIds: ReadonlySet<string>;
    selfMerchantId?: string;
    threshold?: number;
  },
): VectorDecision | null {
  const threshold = options.threshold ?? VECTOR_MATCH_THRESHOLD;
  const totals = new Map<string, { sum: number; best: number }>();
  for (const match of matches) {
    if (!match.categoryId || !options.knownCategoryIds.has(match.categoryId)) continue;
    if (options.selfMerchantId && match.merchantId === options.selfMerchantId) continue;
    if (!Number.isFinite(match.score) || match.score < threshold) continue;
    const entry = totals.get(match.categoryId) ?? { sum: 0, best: 0 };
    entry.sum += match.score;
    entry.best = Math.max(entry.best, match.score);
    totals.set(match.categoryId, entry);
  }

  let winner: { categoryId: string; sum: number; best: number } | null = null;
  for (const [categoryId, entry] of totals) {
    if (
      !winner ||
      entry.sum > winner.sum ||
      (entry.sum === winner.sum && entry.best > winner.best)
    ) {
      winner = { categoryId, ...entry };
    }
  }
  if (!winner) return null;
  return { categoryId: winner.categoryId, confidence: Math.min(1, winner.best) };
}

/** Vectorize metadata stored with each merchant vector. */
export type MerchantVectorMetadata = {
  user_id: string;
  merchant_id: string;
  /** Empty string while the merchant has no default category. */
  category_id: string;
  /** True once the user confirmed the merchant's category; kNN only searches these. */
  confirmed: boolean;
};

export function merchantVectorMetadata(merchant: {
  id: string;
  userId: string;
  defaultCategoryId: string | null;
}): MerchantVectorMetadata {
  return {
    user_id: merchant.userId,
    merchant_id: merchant.id,
    category_id: merchant.defaultCategoryId ?? "",
    confirmed: merchant.defaultCategoryId !== null,
  };
}

/** Reads a Vectorize match back into a NeighbourMatch, tolerating missing metadata. */
export function toNeighbourMatch(match: {
  score: number;
  metadata?: Record<string, unknown> | null;
}): NeighbourMatch {
  const metadata = match.metadata ?? {};
  const categoryId = typeof metadata.category_id === "string" ? metadata.category_id : "";
  const merchantId = typeof metadata.merchant_id === "string" ? metadata.merchant_id : "";
  return {
    score: match.score,
    merchantId: merchantId || null,
    categoryId: categoryId || null,
  };
}
