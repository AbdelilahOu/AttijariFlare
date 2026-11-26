import type { CategoryKind, TransactionType } from "@attijari-flare/db/schema/enums";
import { z } from "zod";

import type { ChatMessage } from "../../extraction/prompts/prompt";
import { MIN_LLM_CONFIDENCE } from "../utils/decide";

/** Merchants per LLM call. A statement rarely has more; larger ones take a second call. */
export const MAX_ITEMS_PER_CALL = 60;

/** Description characters sent per merchant as an example. */
const EXAMPLE_CHARS = 80;

export type ClassifyCategory = { id: string; name: string; kind: CategoryKind };

/** One distinct merchant of the statement to classify. */
export type ClassifyItem = {
  merchant: string;
  /** One description of the merchant, as printed on the statement. */
  example: string;
  type: TransactionType;
  direction: "debit" | "credit";
};

export const CLASSIFY_SYSTEM_PROMPT = `You categorize bank transactions of a Moroccan personal account (Attijariwafa bank). Labels are in French, sometimes Arabic or English, and are often truncated.

For each item choose exactly one category from the list you are given, using its exact name. Use the merchant, the example label, the transaction type and the direction (debit = money out, credit = money in). Moroccan merchants you may meet: Marjane, Carrefour, BIM, Aswak Assalam (groceries), Afriquia, Shell, Total, Winxo (fuel), Maroc Telecom / IAM, Orange, inwi (telecom), ONCF, CTM, Careem, inDrive (transport), Lydec, Redal, Amendis, ONEE (utilities), Jumia, Decathlon (shopping).

Rules:
- Cash withdrawals (retrait, GAB, DAB) go to a cash category when there is one.
- Bank charges, commissions and card fees go to a fees category when there is one.
- Transfers between people go to a transfer category matching the direction, unless the label clearly says salary or rent.
- Credits should not get an expense category unless the label is clearly a refund.
- confidence is your probability (0 to 1) that the category is right. Use a low value when you are guessing.

Return JSON only: {"items": [{"i": <item index>, "category": "<category name>", "confidence": <0..1>}]}, one entry per item.`;

export function buildClassifyMessages(input: {
  categories: readonly ClassifyCategory[];
  items: readonly ClassifyItem[];
}): ChatMessage[] {
  const categoryLines = input.categories.map((category) => `- ${category.name} (${category.kind})`);
  const itemLines = input.items.map((item, i) =>
    JSON.stringify({
      i,
      merchant: item.merchant,
      example: item.example.slice(0, EXAMPLE_CHARS),
      type: item.type,
      direction: item.direction,
    }),
  );
  return [
    { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Categories:\n${categoryLines.join("\n")}\n\nItems:\n${itemLines.join("\n")}`,
    },
  ];
}

const classifiedItemSchema = z.object({
  i: z.coerce.number().int().min(0),
  category: z.string().trim(),
  confidence: z.coerce.number().catch(0.5),
});

export const classifyResponseSchema = z.object({
  items: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      // One malformed entry should not discard the rest of the answer.
      const parsed = classifiedItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** JSON schema for Workers AI JSON mode. */
export const classifyResponseJsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          category: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["i", "category", "confidence"],
      },
    },
  },
  required: ["items"],
} as const;

function categoryKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type LlmDecision = { index: number; categoryId: string; confidence: number };

/**
 * Maps the model's answer to category ids. Names are matched case and accent insensitively;
 * unknown names, out of range indexes, duplicates (first wins) and answers below
 * MIN_LLM_CONFIDENCE are dropped. Confidence is clamped to [0, 1].
 */
export function mapClassification(
  data: unknown,
  input: { categories: readonly ClassifyCategory[]; itemCount: number },
): LlmDecision[] {
  const parsed = classifyResponseSchema.safeParse(data);
  if (!parsed.success) return [];
  const byName = new Map(
    input.categories.map((category) => [categoryKey(category.name), category]),
  );
  const seen = new Set<number>();
  const decisions: LlmDecision[] = [];
  for (const item of parsed.data.items) {
    if (item.i >= input.itemCount || seen.has(item.i)) continue;
    const category = byName.get(categoryKey(item.category));
    if (!category) continue;
    const confidence = Math.min(
      1,
      Math.max(0, Number.isFinite(item.confidence) ? item.confidence : 0),
    );
    if (confidence < MIN_LLM_CONFIDENCE) continue;
    seen.add(item.i);
    decisions.push({ index: item.i, categoryId: category.id, confidence });
  }
  return decisions;
}

/** Parses a model response that may be a JSON string wrapped in prose or a fence. */
export function parseJsonResponse(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const start = data.indexOf("{");
  const end = data.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(data.slice(start, end + 1));
  } catch {
    return null;
  }
}
