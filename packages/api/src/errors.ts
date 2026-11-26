import { ORPCError } from "@orpc/server";

/**
 * Base for the domain errors thrown by service functions (statements, extraction,
 * categorization, ...). Each subclass fixes its own set of allowed codes; `mapServiceError`
 * converts any of them to the matching ORPCError, leaving other errors untouched.
 */
export class ServiceError<Code extends string = string> extends Error {
  constructor(
    readonly code: Code,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Converts a `ServiceError` to the ORPCError a router should throw; passes anything else through. */
export function mapServiceError(error: unknown): unknown {
  return error instanceof ServiceError
    ? new ORPCError(error.code, { message: error.message, data: error.data })
    : error;
}
