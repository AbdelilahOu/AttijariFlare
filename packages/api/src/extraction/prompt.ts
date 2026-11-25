export type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export const SYSTEM_PROMPT = `You extract data from Moroccan bank account statements (relevé de compte). The text was converted from a PDF to markdown, so tables may be broken, columns may be shifted and labels can be in French, Arabic or English. Do not assume any fixed layout: read what is there.

Return JSON that matches the provided schema:
- account_label: the account name or masked account number (for example "Compte courant ****1234"), or null.
- period_start, period_end: the statement period as YYYY-MM-DD, or null if not in this part.
- opening_balance: the balance before the first transaction (ancien solde, solde initial, solde au debut, solde precedent). null if not in this part.
- closing_balance: the balance after the last transaction (nouveau solde, solde final, solde a la fin). null if not in this part.
- transactions: every transaction row in this part, in the order they appear. Never skip, merge or invent rows.

For each transaction:
- booking_date: date of the operation (date d'operation) as YYYY-MM-DD. If a row shows only day and month, take the year from the statement period.
- value_date: date de valeur as YYYY-MM-DD, or null.
- description: the full label text of the row (libelle), including continuation lines, copied as written.
- amount: a number in MAD. Debits (debit, retrait, paiement, prelevement, frais, commission) are negative. Credits (credit, versement, virement recu, salaire) are positive. Use a dot as the decimal separator and no thousands separator.
- balance_after: the running balance shown on that row, or null if the row has none.
- type: card_payment for card purchases (paiement par carte, achat TPE), cash_withdrawal for ATM or counter withdrawals (retrait GAB, retrait DAB), transfer_in for incoming transfers, transfer_out for outgoing transfers, fee for bank fees, commissions, taxes and subscriptions charged by the bank, salary for salary or payroll credits, other otherwise.

Rows that are only totals (total des mouvements, total debit, total credit), page headers or balance lines are not transactions. If this part holds no transactions, return an empty array.`;

/**
 * Builds the chat messages for one chunk. `header` is the beginning of the statement,
 * passed with later chunks so the model knows the period (for year inference) and the
 * column order, without extracting rows from it twice.
 */
export function buildChunkMessages(input: {
  chunk: string;
  index: number;
  total: number;
  header: string | null;
}): ChatMessage[] {
  const parts: string[] = [];
  if (input.total > 1) {
    parts.push(`This is part ${input.index + 1} of ${input.total} of the statement.`);
  }
  if (input.header) {
    parts.push(
      `Context only (the start of the statement). Do not extract transactions or balances from it:\n<context>\n${input.header}\n</context>`,
    );
  }
  parts.push(`Statement text to extract:\n<statement>\n${input.chunk}\n</statement>`);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/** Message appended when the previous answer was not valid, so the retry can correct it. */
export function buildRetryMessage(error: string): ChatMessage {
  return {
    role: "user",
    content: `Your previous answer was rejected: ${error.slice(0, 500)}. Answer again with JSON that matches the schema exactly.`,
  };
}
