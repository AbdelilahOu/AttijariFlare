import { ORPCError } from "@orpc/server";

import { ServiceError } from "./errors";

// Log hygiene: logs may hold ids, counts, timings and error kinds, never statement text,
// descriptions, amounts, names, emails, prompts or model answers. Error messages from
// libraries can embed any of those (a Drizzle query error lists the bound parameters, a
// JSON.parse error quotes the input), so they pass through `safeErrorSummary` first.

/** Longest error message kept in a log line or in `statements.error`. */
const MAX_MESSAGE = 200;

/** Error classes whose messages are written by this codebase and hold no user data. */
const OWN_MESSAGE_NAMES = new Set([
  "PermanentIngestError",
  "PermanentEnrichError",
  "ExtractionError",
]);

export type SafeError = {
  name: string;
  code?: string;
  message: string;
};

/**
 * Removes the parts of a library error message that can carry user data:
 * everything from "params:" on (Drizzle lists bound values there), and any quoted text
 * (V8 quotes the input in JSON and type errors).
 */
export function redactMessage(message: string): string {
  return message
    .replace(/\bparams:[\s\S]*$/i, "params: [redacted]")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** A summary of `error` that is safe to log: its kind, its code and a redacted message. */
export function safeErrorSummary(error: unknown): SafeError {
  if (error instanceof ORPCError) {
    // Messages of ORPCErrors thrown here are ours; validation failures say only that.
    return { name: "ORPCError", code: String(error.code), message: redactMessage(error.message) };
  }
  if (error instanceof ServiceError) {
    return { name: error.name, code: error.code, message: redactMessage(error.message) };
  }
  if (error instanceof Error) {
    const own = OWN_MESSAGE_NAMES.has(error.name);
    // Drizzle wraps the driver error in `cause`; its message names the SQL, not the values.
    const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
    const message = own ? error.message : `${error.message}${cause}`;
    return { name: error.name || "Error", message: redactMessage(message) };
  }
  return { name: typeof error, message: "non-error value thrown" };
}

/** One structured, redacted error log line. `fields` must hold ids and counts only. */
export function logError(event: string, error: unknown, fields: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ event, ...fields, error: safeErrorSummary(error) }));
}
