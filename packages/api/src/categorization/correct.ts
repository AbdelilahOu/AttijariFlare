import type { Database } from "@attijari-flare/db";
import {
  applyCategoryCorrection,
  getOwnedCategory,
  getTransactionWithMerchant,
  setTransactionCategoryByUser,
} from "@attijari-flare/db/queries";

import type { Bindings } from "../bindings";
import { ServiceError } from "../errors";
import { MERCHANT_DEFAULT_CONFIDENCE } from "./utils/decide";
import { syncMerchantVector } from "./enrich";

/** Raised by `correctCategory`. */
export class CorrectCategoryError extends ServiceError<"NOT_FOUND" | "BAD_REQUEST"> {}

export type CorrectCategoryDeps = {
  db: Database;
  env: Pick<Bindings, "AI" | "VECTORIZE">;
  userId: string;
};

export type CorrectCategoryInput = {
  transactionId: string;
  categoryId: string;
  applyToMerchant: boolean;
};

export type CorrectCategoryResult = {
  applied: number;
  sameMerchantPending: number;
  vectorSynced: boolean;
};

/**
 * User correction: sets the row's category with source `user`, makes it the merchant's
 * default (so the next occurrence of the merchant gets it) and marks the merchant's vector
 * as confirmed for kNN. With `applyToMerchant`, the merchant's other rows that the user
 * did not set themselves take the category too. Returns how many such rows still differ,
 * so the caller can offer to apply it.
 */
export async function correctCategory(
  deps: CorrectCategoryDeps,
  input: CorrectCategoryInput,
): Promise<CorrectCategoryResult> {
  const { db, userId } = deps;

  const [row, category] = await Promise.all([
    getTransactionWithMerchant(db, { userId, transactionId: input.transactionId }),
    getOwnedCategory(db, { userId, categoryId: input.categoryId }),
  ]);
  if (!row) throw new CorrectCategoryError("NOT_FOUND", "Transaction not found");
  if (!category) throw new CorrectCategoryError("BAD_REQUEST", "Unknown category");

  if (!row.merchantId) {
    await setTransactionCategoryByUser(db, { transactionId: row.id, categoryId: category.id });
    return { applied: 0, sameMerchantPending: 0, vectorSynced: false };
  }

  const { merchant, applied, sameMerchantPending } = await applyCategoryCorrection(db, {
    userId,
    transactionId: row.id,
    categoryId: category.id,
    merchantId: row.merchantId,
    applyToMerchant: input.applyToMerchant,
    merchantDefaultConfidence: MERCHANT_DEFAULT_CONFIDENCE,
  });

  // The correction is saved either way; a failed vector write only delays kNN learning.
  let vectorSynced = false;
  if (merchant) {
    try {
      await syncMerchantVector({ db, env: deps.env }, merchant);
      vectorSynced = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "categorization.correctCategory.vector-error",
          merchantId: row.merchantId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return { applied, sameMerchantPending, vectorSynced };
}
