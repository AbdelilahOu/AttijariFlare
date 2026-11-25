import {
  categories,
  merchants,
  statements,
  transactionAllocations,
  transactions,
  transactionTypes,
} from "@finance-ttijari/db/schema/index";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, gte, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { MERCHANT_DEFAULT_CONFIDENCE } from "../categorization/decide";
import { syncMerchantVector } from "../categorization/enrich";
import { normalizeDescription } from "../extraction/fingerprint";
import { protectedProcedure } from "../index";

/** Category filter value for rows without a category. */
export const UNCATEGORIZED = "none";

const listInput = z.object({
  /** Booking month, `YYYY-MM`. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  /** A category id, or "none" for uncategorized rows. */
  categoryId: z.string().min(1).optional(),
  statementId: z.string().min(1).optional(),
  type: z.enum(transactionTypes).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Rows the categorizer may still change: everything not set by the user. */
const notUserSet = or(isNull(transactions.categorySource), ne(transactions.categorySource, "user"));

export const transactionsRouter = {
  /** Filtered, paginated transactions, newest first, with category, merchant and split info. */
  list: protectedProcedure
    .input(listInput.default({ page: 1, pageSize: 50 }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const filters: (SQL | undefined)[] = [eq(transactions.userId, userId)];
      if (input.month) {
        filters.push(
          gte(transactions.bookingDate, `${input.month}-01`),
          lte(transactions.bookingDate, `${input.month}-31`),
        );
      }
      if (input.categoryId === UNCATEGORIZED) filters.push(isNull(transactions.categoryId));
      else if (input.categoryId) filters.push(eq(transactions.categoryId, input.categoryId));
      if (input.statementId) filters.push(eq(transactions.statementId, input.statementId));
      if (input.type) filters.push(eq(transactions.type, input.type));
      if (input.search) {
        const raw = likePattern(input.search);
        const normalized = likePattern(normalizeDescription(input.search));
        filters.push(
          or(
            sql`${transactions.descriptionRaw} like ${raw} escape '\\'`,
            sql`${transactions.descriptionNormalized} like ${normalized} escape '\\'`,
            sql`${merchants.normalizedName} like ${normalized} escape '\\'`,
          ),
        );
      }
      const where = and(...filters);

      const [rows, [total]] = await Promise.all([
        context.db
          .select({
            id: transactions.id,
            statementId: transactions.statementId,
            statementFileName: statements.fileName,
            bookingDate: transactions.bookingDate,
            valueDate: transactions.valueDate,
            descriptionRaw: transactions.descriptionRaw,
            amount: transactions.amount,
            type: transactions.type,
            balanceAfter: transactions.balanceAfter,
            categoryId: transactions.categoryId,
            categoryName: categories.name,
            categoryColor: categories.color,
            categorySource: transactions.categorySource,
            confidence: transactions.confidence,
            merchantId: transactions.merchantId,
            merchantName: merchants.normalizedName,
            allocationParts: sql<number>`(select count(*) from ${transactionAllocations} where ${transactionAllocations.transactionId} = ${transactions.id})`,
          })
          .from(transactions)
          .innerJoin(statements, eq(statements.id, transactions.statementId))
          .leftJoin(categories, eq(categories.id, transactions.categoryId))
          .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
          .where(where)
          .orderBy(
            desc(transactions.bookingDate),
            asc(transactions.statementId),
            asc(transactions.rowIndex),
          )
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        context.db
          .select({ n: count() })
          .from(transactions)
          .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
          .where(where),
      ]);

      return {
        items: rows.map((row) => ({ ...row, allocationParts: Number(row.allocationParts) })),
        total: total?.n ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** Booking months that have transactions, newest first (`YYYY-MM`). */
  months: protectedProcedure.handler(async ({ context }) => {
    const month = sql<string>`substr(${transactions.bookingDate}, 1, 7)`;
    const rows = await context.db
      .selectDistinct({ month })
      .from(transactions)
      .where(eq(transactions.userId, context.session.user.id))
      .orderBy(desc(month));
    return rows.map((row) => row.month);
  }),

  /**
   * User correction: sets the row's category with source `user`, makes it the merchant's
   * default (so the next occurrence of the merchant gets it) and marks the merchant's vector
   * as confirmed for kNN. With `applyToMerchant`, the merchant's other rows that the user
   * did not set themselves take the category too. Returns how many such rows still differ,
   * so the UI can offer to apply it.
   */
  setCategory: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().min(1),
        categoryId: z.string().min(1),
        applyToMerchant: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      const { db } = context;
      const userId = context.session.user.id;

      const [[row], [category]] = await Promise.all([
        db
          .select({ id: transactions.id, merchantId: transactions.merchantId })
          .from(transactions)
          .where(and(eq(transactions.id, input.transactionId), eq(transactions.userId, userId)))
          .limit(1),
        db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)))
          .limit(1),
      ]);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Transaction not found" });
      if (!category) throw new ORPCError("BAD_REQUEST", { message: "Unknown category" });

      const setRow = db
        .update(transactions)
        .set({ categoryId: category.id, categorySource: "user", confidence: null })
        .where(eq(transactions.id, row.id));

      if (!row.merchantId) {
        await setRow;
        return { applied: 0, sameMerchantPending: 0, vectorSynced: false };
      }
      const merchantId = row.merchantId;
      const otherRows = and(
        eq(transactions.userId, userId),
        eq(transactions.merchantId, merchantId),
        ne(transactions.id, row.id),
        notUserSet,
      );

      const [, [merchant], applied] = await db.batch([
        setRow,
        db
          .update(merchants)
          .set({ defaultCategoryId: category.id })
          .where(and(eq(merchants.id, merchantId), eq(merchants.userId, userId)))
          .returning({
            id: merchants.id,
            userId: merchants.userId,
            normalizedName: merchants.normalizedName,
            vectorId: merchants.vectorId,
            defaultCategoryId: merchants.defaultCategoryId,
          }),
        input.applyToMerchant
          ? db
              .update(transactions)
              .set({
                categoryId: category.id,
                categorySource: "vector",
                confidence: MERCHANT_DEFAULT_CONFIDENCE,
              })
              .where(otherRows)
              .returning({ id: transactions.id })
          : db
              .select({ id: transactions.id })
              .from(transactions)
              .where(sql`0`),
      ]);

      const [pending] = await db
        .select({ n: count() })
        .from(transactions)
        .where(
          and(
            otherRows,
            or(isNull(transactions.categoryId), ne(transactions.categoryId, category.id)),
          ),
        );

      // The correction is saved either way; a failed vector write only delays kNN learning.
      let vectorSynced = false;
      if (merchant) {
        try {
          await syncMerchantVector({ db, env: context.env }, merchant);
          vectorSynced = true;
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "transactions.setCategory.vector-error",
              merchantId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }

      return { applied: applied.length, sameMerchantPending: pending?.n ?? 0, vectorSynced };
    }),
};
