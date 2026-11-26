import { buildChunkMessages, buildRetryMessage, type ChatMessage } from "./prompts/prompt";
import { type ChunkExtraction, chunkExtractionSchema, type ExtractedTransaction } from "./schema";
import { chunkMarkdown, splitChunk } from "./utils/chunk";

/**
 * Workers AI model used for extraction. It is on the JSON mode list
 * (https://developers.cloudflare.com/workers-ai/features/json-mode/) and handles French and
 * Arabic. Context window is 24k tokens, hence the chunking below.
 */
export const EXTRACTION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Neurons per million tokens for EXTRACTION_MODEL (Workers AI pricing page). */
const NEURONS_PER_M_INPUT = 26_668;
const NEURONS_PER_M_OUTPUT = 204_805;

/** Characters of markdown per model call. Keeps input and output well under 24k tokens. */
export const CHUNK_MAX_CHARS = 6_000;
/** Characters of the statement start passed as context with later chunks. */
const HEADER_CHARS = 800;
/** Model calls per chunk before it is split in two (or the extraction fails). */
const ATTEMPTS_PER_CHUNK = 2;
/** How many times a failing chunk may be halved. */
const MAX_SPLIT_DEPTH = 2;

export type ModelUsage = { inputTokens: number; outputTokens: number };

/**
 * One structured-output model call. `data` is the parsed JSON (or the raw string when the
 * model returned text). Implemented with env.AI in the worker and with fakes in tests.
 */
export type RunModel = (messages: ChatMessage[]) => Promise<{ data: unknown; usage: ModelUsage }>;

export type ChunkAttempt = {
  chunkIndex: number;
  attempt: number;
  ok: boolean;
  error?: string;
  raw?: unknown;
};

export type StatementExtraction = {
  model: string;
  accountLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: ExtractedTransaction[];
  chunks: number;
  attempts: ChunkAttempt[];
  usage: ModelUsage;
  neuronsEstimate: number;
};

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly attempts: ChunkAttempt[],
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export function estimateNeurons(usage: ModelUsage): number {
  return Math.ceil(
    (usage.inputTokens * NEURONS_PER_M_INPUT + usage.outputTokens * NEURONS_PER_M_OUTPUT) /
      1_000_000,
  );
}

function parseModelData(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }
  // Some responses wrap the JSON in a markdown fence or surrounding prose.
  const start = data.indexOf("{");
  const end = data.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("response contains no JSON object");
  }
  return JSON.parse(data.slice(start, end + 1));
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    return error.issues
      .slice(0, 5)
      .map((issue: { path?: unknown[]; message?: string }) =>
        `${(issue.path ?? []).join(".")}: ${issue.message ?? ""}`.trim(),
      )
      .join("; ");
  }
  // A JSON.parse error quotes the model's answer, which holds statement data; this
  // message ends up in logs and in statements.error, so it is replaced by a fixed one.
  if (error instanceof SyntaxError) return "response is not valid JSON";
  return error instanceof Error ? error.message : String(error);
}

/**
 * Layout-agnostic extraction: splits the markdown into chunks, asks the model for
 * structured JSON per chunk, validates each answer with zod (retrying with the validation
 * error, then halving the chunk) and merges the chunks in document order.
 */
export async function extractStatement(
  markdown: string,
  runModel: RunModel,
  options: { chunkMaxChars?: number } = {},
): Promise<StatementExtraction> {
  const chunks = chunkMarkdown(markdown, options.chunkMaxChars ?? CHUNK_MAX_CHARS);
  if (chunks.length === 0) {
    throw new ExtractionError("statement text is empty", []);
  }
  const header = chunks.length > 1 ? markdown.slice(0, HEADER_CHARS) : null;
  const attempts: ChunkAttempt[] = [];
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };

  const extractChunk = async (
    chunk: string,
    chunkIndex: number,
    depth: number,
  ): Promise<ChunkExtraction[]> => {
    const messages = buildChunkMessages({
      chunk,
      index: chunkIndex,
      total: chunks.length,
      header: chunkIndex === 0 ? null : header,
    });
    let lastError = "";
    for (let attempt = 1; attempt <= ATTEMPTS_PER_CHUNK; attempt++) {
      let raw: unknown;
      try {
        const result = await runModel(messages);
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        raw = result.data;
        const parsed = chunkExtractionSchema.parse(parseModelData(raw));
        attempts.push({ chunkIndex, attempt, ok: true });
        return [parsed];
      } catch (error) {
        lastError = describeError(error);
        attempts.push({ chunkIndex, attempt, ok: false, error: lastError, raw });
        messages.push(buildRetryMessage(lastError));
      }
    }
    const halves = depth < MAX_SPLIT_DEPTH ? splitChunk(chunk) : null;
    if (!halves) {
      throw new ExtractionError(`chunk ${chunkIndex + 1}: ${lastError}`, attempts);
    }
    const first = await extractChunk(halves[0], chunkIndex, depth + 1);
    const second = await extractChunk(halves[1], chunkIndex, depth + 1);
    return [...first, ...second];
  };

  // Sequential on purpose: one statement at a time keeps neuron use predictable.
  const parts: ChunkExtraction[] = [];
  for (const [index, chunk] of chunks.entries()) {
    parts.push(...(await extractChunk(chunk, index, 0)));
  }

  const merged = mergeChunks(parts);
  return {
    model: EXTRACTION_MODEL,
    ...merged,
    chunks: chunks.length,
    attempts,
    usage,
    neuronsEstimate: estimateNeurons(usage),
  };
}

/**
 * Merges chunk answers in document order: transactions are concatenated, the opening
 * balance and period start come from the first chunk that has them, the closing balance
 * and period end from the last.
 */
export function mergeChunks(parts: ChunkExtraction[]): Pick<
  StatementExtraction,
  "accountLabel" | "periodStart" | "periodEnd" | "openingBalance" | "closingBalance"
> & {
  transactions: ExtractedTransaction[];
} {
  const first = <K extends keyof ChunkExtraction>(key: K) =>
    parts.find((part) => part[key] !== null)?.[key] ?? null;
  const last = <K extends keyof ChunkExtraction>(key: K) =>
    [...parts].reverse().find((part) => part[key] !== null)?.[key] ?? null;

  return {
    accountLabel: first("account_label") as string | null,
    periodStart: first("period_start") as string | null,
    periodEnd: last("period_end") as string | null,
    openingBalance: first("opening_balance") as number | null,
    closingBalance: last("closing_balance") as number | null,
    transactions: parts.flatMap((part) => part.transactions),
  };
}
