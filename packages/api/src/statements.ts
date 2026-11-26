import { isUniqueConstraintViolation } from "@finance-ttijari/db/errors";
import {
  deleteStatementRow,
  findStatementBySha,
  getStatementFile,
  getStatementSummary,
  insertStatement,
  listStatements as listStatementsQuery,
  markStatementFailed,
} from "@finance-ttijari/db/queries";
import type { Database } from "@finance-ttijari/db";
import type { Statement } from "@finance-ttijari/db/schema/index";

import type { Bindings } from "./bindings";
import { ServiceError } from "./errors";

/** Largest accepted statement PDF. Attijari monthly statements are well under 1 MB. */
export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

/** Every R2 object belonging to a statement lives under this prefix. */
export function statementPrefix(statementId: string): string {
  return `statements/${statementId}/`;
}

export function statementOriginalKey(statementId: string): string {
  return `${statementPrefix(statementId)}original.pdf`;
}

export type StatementDeps = {
  db: Database;
  env: Pick<Bindings, "STATEMENTS" | "STATEMENT_INGEST">;
  userId: string;
};

type StatementErrorCode = "BAD_REQUEST" | "PAYLOAD_TOO_LARGE" | "CONFLICT" | "NOT_FOUND";

/** Error raised by the statement service; `code` maps onto an HTTP status. */
export class StatementError extends ServiceError<StatementErrorCode> {
  constructor(
    code: StatementErrorCode,
    message: string,
    readonly existingId?: string,
  ) {
    super(code, message, existingId ? { existingId } : undefined);
  }
}

export const statementErrorStatus = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
} as const satisfies Record<StatementError["code"], number>;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function isPdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  // Keep the name printable and bounded; it is only displayed and used in Content-Disposition.
  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && char !== '"';
    })
    .join("")
    .slice(0, 200);
  return cleaned || "statement.pdf";
}

/**
 * Validates and stores an uploaded statement PDF:
 * R2 `statements/{id}/original.pdf` -> D1 row (status `uploaded`) -> `statement-ingest` message.
 * Rejects non-PDFs, files over MAX_STATEMENT_BYTES and duplicates (same sha256 for the user).
 */
export async function createStatement(deps: StatementDeps, file: File): Promise<Statement> {
  if (file.size === 0) {
    throw new StatementError("BAD_REQUEST", "The file is empty.");
  }
  if (file.size > MAX_STATEMENT_BYTES) {
    throw new StatementError(
      "PAYLOAD_TOO_LARGE",
      `The file is larger than ${MAX_STATEMENT_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const buffer = await file.arrayBuffer();
  if (!isPdf(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, PDF_MAGIC.length)))) {
    throw new StatementError("BAD_REQUEST", "Only PDF files are accepted.");
  }

  const sha256 = await sha256Hex(buffer);
  const duplicate = await findStatementBySha(deps.db, { userId: deps.userId, sha256 });
  if (duplicate) {
    throw new StatementError("CONFLICT", "This statement has already been uploaded.", duplicate.id);
  }

  const id = crypto.randomUUID();
  const r2Key = statementOriginalKey(id);
  const fileName = sanitizeFileName(file.name);

  await deps.env.STATEMENTS.put(r2Key, buffer, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { userId: deps.userId, fileName },
    sha256,
  });

  let statement: Statement;
  try {
    const inserted = await insertStatement(deps.db, {
      id,
      userId: deps.userId,
      r2Key,
      fileName,
      sha256,
      status: "uploaded",
    });
    if (!inserted) throw new Error("Statement insert returned no row.");
    statement = inserted;
  } catch (error) {
    await deps.env.STATEMENTS.delete(r2Key);
    if (isUniqueConstraintViolation(error)) {
      // Lost a race with a concurrent upload of the same file.
      const existing = await findStatementBySha(deps.db, { userId: deps.userId, sha256 });
      throw new StatementError(
        "CONFLICT",
        "This statement has already been uploaded.",
        existing?.id,
      );
    }
    throw error;
  }

  try {
    await deps.env.STATEMENT_INGEST.send({ statementId: id });
  } catch (error) {
    console.error("statement-ingest: failed to enqueue", id, error);
    const failed = await markStatementFailed(deps.db, {
      id,
      error: "Could not queue the statement for extraction.",
    });
    return failed ?? statement;
  }

  return statement;
}

export type StatementSummary = Awaited<ReturnType<typeof listStatements>>[number];

/** All statements of the user, newest period first (unparsed uploads first). */
export async function listStatements(deps: Pick<StatementDeps, "db" | "userId">) {
  return listStatementsQuery(deps.db, { userId: deps.userId });
}

export async function getStatement(deps: Pick<StatementDeps, "db" | "userId">, id: string) {
  const row = await getStatementSummary(deps.db, { userId: deps.userId, id });
  if (!row) throw new StatementError("NOT_FOUND", "Statement not found.");
  return row;
}

/** Returns the original PDF object if the statement belongs to the user. */
export async function getStatementPdf(deps: StatementDeps, id: string) {
  const row = await getStatementFile(deps.db, { userId: deps.userId, id });
  if (!row) throw new StatementError("NOT_FOUND", "Statement not found.");

  const object = await deps.env.STATEMENTS.get(row.r2Key);
  if (!object) throw new StatementError("NOT_FOUND", "The statement PDF is missing.");
  return { object, fileName: row.fileName };
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Deletes the statement row (D1 cascades its transactions) and every R2 object under its prefix. */
export async function deleteStatement(deps: StatementDeps, id: string): Promise<void> {
  const deleted = await deleteStatementRow(deps.db, { userId: deps.userId, id });
  if (deleted.length === 0) throw new StatementError("NOT_FOUND", "Statement not found.");

  await deletePrefix(deps.env.STATEMENTS, statementPrefix(id));
}
