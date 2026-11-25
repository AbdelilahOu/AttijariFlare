export const statementStatuses = [
  "uploaded",
  "extracting",
  "parsed",
  "needs_review",
  "failed",
] as const;
export type StatementStatus = (typeof statementStatuses)[number];

export const transactionTypes = [
  "card_payment",
  "cash_withdrawal",
  "transfer_in",
  "transfer_out",
  "fee",
  "salary",
  "other",
] as const;
export type TransactionType = (typeof transactionTypes)[number];

export const categorySources = ["vector", "llm", "user"] as const;
export type CategorySource = (typeof categorySources)[number];

export const categoryKinds = ["expense", "income", "transfer"] as const;
export type CategoryKind = (typeof categoryKinds)[number];
