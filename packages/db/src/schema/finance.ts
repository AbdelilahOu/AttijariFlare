import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { categoryKinds, categorySources, statementStatuses, transactionTypes } from "./enums";

// Conventions:
// - Money is a signed integer amount of centimes (MAD). Debits are negative, credits positive.
// - Calendar dates (booking, value, statement period) are ISO `YYYY-MM-DD` text.
// - Every table carries `user_id` so all queries can be scoped to the signed-in user.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
};

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => categories.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: categoryKinds }).notNull(),
    color: text("color"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("categories_user_id_name_uq").on(table.userId, table.name),
    index("categories_parent_id_idx").on(table.parentId),
  ],
);

export const merchants = sqliteTable(
  "merchants",
  {
    id: id(),
    userId: userId(),
    normalizedName: text("normalized_name").notNull(),
    vectorId: text("vector_id"),
    defaultCategoryId: text("default_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("merchants_user_id_normalized_name_uq").on(table.userId, table.normalizedName),
    index("merchants_default_category_id_idx").on(table.defaultCategoryId),
  ],
);

export const statements = sqliteTable(
  "statements",
  {
    id: id(),
    userId: userId(),
    r2Key: text("r2_key").notNull(),
    fileName: text("file_name").notNull(),
    sha256: text("sha256").notNull(),
    accountLabel: text("account_label"),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    openingBalance: integer("opening_balance"),
    closingBalance: integer("closing_balance"),
    status: text("status", { enum: statementStatuses }).notNull().default("uploaded"),
    error: text("error"),
    model: text("model"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("statements_user_id_sha256_uq").on(table.userId, table.sha256),
    index("statements_user_id_period_start_idx").on(table.userId, table.periodStart),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    userId: userId(),
    statementId: text("statement_id")
      .notNull()
      .references(() => statements.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    bookingDate: text("booking_date").notNull(),
    valueDate: text("value_date"),
    descriptionRaw: text("description_raw").notNull(),
    descriptionNormalized: text("description_normalized"),
    merchantId: text("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    type: text("type", { enum: transactionTypes }).notNull().default("other"),
    balanceAfter: integer("balance_after"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: categorySources }),
    confidence: real("confidence"),
    // Deterministic hash of the row's identifying fields; re-ingesting a statement is a no-op.
    fingerprint: text("fingerprint").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("transactions_fingerprint_uq").on(table.fingerprint),
    index("transactions_statement_id_idx").on(table.statementId),
    index("transactions_booking_date_idx").on(table.bookingDate),
    index("transactions_category_id_idx").on(table.categoryId),
    index("transactions_merchant_id_idx").on(table.merchantId),
    index("transactions_user_id_booking_date_idx").on(table.userId, table.bookingDate),
  ],
);

// Splits a transaction (typically a cash withdrawal) across categories.
// `amount` is positive centimes; the sum per transaction must not exceed |transactions.amount|
// (enforced by the application). Allocations override the parent category in reports.
export const transactionAllocations = sqliteTable(
  "transaction_allocations",
  {
    id: id(),
    userId: userId(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    index("transaction_allocations_transaction_id_idx").on(table.transactionId),
    index("transaction_allocations_category_id_idx").on(table.categoryId),
    check("transaction_allocations_amount_positive", sql`${table.amount} > 0`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Merchant = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;
export type Statement = typeof statements.$inferSelect;
export type NewStatement = typeof statements.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionAllocation = typeof transactionAllocations.$inferSelect;
export type NewTransactionAllocation = typeof transactionAllocations.$inferInsert;
