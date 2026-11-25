import { defineRelations, defineRelationsPart } from "drizzle-orm";

import * as schema from "./schema";

const financeRelations = defineRelationsPart(
  {
    user: schema.user,
    categories: schema.categories,
    merchants: schema.merchants,
    statements: schema.statements,
    transactions: schema.transactions,
    transactionAllocations: schema.transactionAllocations,
  },
  (r) => ({
    categories: {
      user: r.one.user({ from: r.categories.userId, to: r.user.id }),
      parent: r.one.categories({
        from: r.categories.parentId,
        to: r.categories.id,
        alias: "category_parent",
      }),
      children: r.many.categories({
        from: r.categories.id,
        to: r.categories.parentId,
        alias: "category_parent",
      }),
      transactions: r.many.transactions({
        from: r.categories.id,
        to: r.transactions.categoryId,
      }),
      allocations: r.many.transactionAllocations({
        from: r.categories.id,
        to: r.transactionAllocations.categoryId,
      }),
      merchants: r.many.merchants({
        from: r.categories.id,
        to: r.merchants.defaultCategoryId,
      }),
    },
    merchants: {
      user: r.one.user({ from: r.merchants.userId, to: r.user.id }),
      defaultCategory: r.one.categories({
        from: r.merchants.defaultCategoryId,
        to: r.categories.id,
      }),
      transactions: r.many.transactions({
        from: r.merchants.id,
        to: r.transactions.merchantId,
      }),
    },
    statements: {
      user: r.one.user({ from: r.statements.userId, to: r.user.id }),
      transactions: r.many.transactions({
        from: r.statements.id,
        to: r.transactions.statementId,
      }),
    },
    transactions: {
      user: r.one.user({ from: r.transactions.userId, to: r.user.id }),
      statement: r.one.statements({
        from: r.transactions.statementId,
        to: r.statements.id,
        optional: false,
      }),
      merchant: r.one.merchants({ from: r.transactions.merchantId, to: r.merchants.id }),
      category: r.one.categories({ from: r.transactions.categoryId, to: r.categories.id }),
      allocations: r.many.transactionAllocations({
        from: r.transactions.id,
        to: r.transactionAllocations.transactionId,
      }),
    },
    transactionAllocations: {
      user: r.one.user({ from: r.transactionAllocations.userId, to: r.user.id }),
      transaction: r.one.transactions({
        from: r.transactionAllocations.transactionId,
        to: r.transactions.id,
        optional: false,
      }),
      category: r.one.categories({
        from: r.transactionAllocations.categoryId,
        to: r.categories.id,
        optional: false,
      }),
    },
  }),
);

export const relations = {
  ...defineRelations(schema),
  ...schema.authRelations,
  ...financeRelations,
};
