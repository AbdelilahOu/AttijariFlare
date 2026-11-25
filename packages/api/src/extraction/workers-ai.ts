import { EXTRACTION_MODEL, type RunModel } from "./extract";
import { chunkExtractionJsonSchema } from "./schema";

/** Output token budget per call; a 6k-character chunk holds well under this many tokens of rows. */
const MAX_OUTPUT_TOKENS = 6_000;

/** RunModel backed by Workers AI JSON mode. */
export function createWorkersAiRunner(ai: Ai): RunModel {
  return async (messages) => {
    const result = (await ai.run(EXTRACTION_MODEL, {
      messages,
      response_format: { type: "json_schema", json_schema: chunkExtractionJsonSchema },
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
