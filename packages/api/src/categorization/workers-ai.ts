import { EXTRACTION_MODEL, type RunModel } from "../extraction/extract";
import { classifyResponseJsonSchema } from "./prompt";

/** Embedding model for merchant names: multilingual (French, Arabic), 1024 dimensions. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;
/** Texts per embedding call. */
const EMBED_BATCH = 50;

/** Classification uses the same JSON-mode model as extraction. */
export const CLASSIFY_MODEL = EXTRACTION_MODEL;
const MAX_OUTPUT_TOKENS = 3_000;

/** Embeds texts, in order. Implemented with env.AI in the worker and with fakes in tests. */
export type Embed = (texts: string[]) => Promise<number[][]>;

export function createWorkersAiEmbedder(ai: Ai): Embed {
  return async (texts) => {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const batch = texts.slice(start, start + EMBED_BATCH);
      const result = (await ai.run(EMBEDDING_MODEL, { text: batch })) as {
        data?: number[][];
      };
      const data = result.data ?? [];
      if (data.length !== batch.length) {
        throw new Error(`embedding returned ${data.length} vectors for ${batch.length} texts`);
      }
      for (const vector of data) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`embedding has ${vector.length} dimensions`);
        }
        vectors.push(vector);
      }
    }
    return vectors;
  };
}

/** RunModel for the batched classification call, backed by Workers AI JSON mode. */
export function createClassifyRunner(ai: Ai): RunModel {
  return async (messages) => {
    const result = (await ai.run(CLASSIFY_MODEL, {
      messages,
      response_format: { type: "json_schema", json_schema: classifyResponseJsonSchema },
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
    })) as
      | string
      | {
          response?: unknown;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

    if (typeof result === "string") {
      return { data: result, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    return {
      data: result.response,
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
      },
    };
  };
}
