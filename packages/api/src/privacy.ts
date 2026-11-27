import type { Database } from "@attijari-flare/db";
import {
  deleteStatementRows,
  deleteUserFinanceRows,
  getPrivacyAcceptance,
  getStatementFile,
  listMerchantsOrphanedByStatement,
  listUserMerchantIds,
  listUserStatementIds,
  recordPrivacyAcceptance,
} from "@attijari-flare/db/queries";

import type { Bindings } from "./bindings";
import { ServiceError } from "./errors";

/**
 * Version of the privacy notice users accept before their first upload
 * (apps/web/src/routes/privacy.tsx, PRIVACY.md). Bump it when the notice changes in a way
 * users must accept again.
 */
export const PRIVACY_POLICY_VERSION = "2026-11-27";

/** Vectorize accepts up to 1000 ids per delete; stay well below. */
const VECTOR_IDS_PER_DELETE = 100;

export type DeletionDeps = {
  db: Database;
  env: Pick<Bindings, "STATEMENTS" | "VECTORIZE">;
};

/** Raised by the deletion and consent services. */
export class PrivacyError extends ServiceError<"NOT_FOUND" | "FORBIDDEN"> {}

/** Every R2 object belonging to a statement lives under this prefix. */
export function statementPrefix(statementId: string): string {
  return `statements/${statementId}/`;
}

/** Deletes every R2 object under `prefix`. Safe to call again: an empty prefix is a no-op. */
export async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
      deleted += page.objects.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

/** Deletes vectors by id in batches. Unknown ids are ignored by Vectorize. */
export async function deleteVectors(index: Vectorize, ids: readonly string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += VECTOR_IDS_PER_DELETE) {
    await index.deleteByIds(ids.slice(start, start + VECTOR_IDS_PER_DELETE));
  }
}

export type StatementDeletion = {
  r2Objects: number;
  merchants: number;
};

/**
 * Deletes a statement and everything derived from it: every R2 object under its prefix
 * (original.pdf, extracted.md, extraction.json), its transactions and their allocations,
 * and the merchants (with their Vectorize vectors) that no other transaction references.
 *
 * Order: ownership check, R2, Vectorize, then one D1 batch. The D1 rows go last, so if any
 * step fails the statement is still listed and deleting it again finishes the job; every
 * step is a no-op when already done. Throws NOT_FOUND when the statement is not the user's.
 */
export async function deleteStatementData(
  deps: DeletionDeps & { userId: string },
  statementId: string,
): Promise<StatementDeletion> {
  const { db, env, userId } = deps;
  if (!(await getStatementFile(db, { userId, id: statementId }))) {
    throw new PrivacyError("NOT_FOUND", "Statement not found.");
  }
  const orphans = await listMerchantsOrphanedByStatement(db, { userId, statementId });

  const r2Objects = await deleteR2Prefix(env.STATEMENTS, statementPrefix(statementId));
  const orphanIds = orphans.map((merchant) => merchant.id);
  await deleteVectors(env.VECTORIZE, orphanIds);
  const deleted = await deleteStatementRows(db, {
    userId,
    statementId,
    orphanMerchantIds: orphanIds,
  });
  if (!deleted) throw new PrivacyError("NOT_FOUND", "Statement not found.");
  return { r2Objects, merchants: orphanIds.length };
}

export type UserPurge = {
  statements: number;
  r2Objects: number;
  vectors: number;
};

/**
 * Deletes every piece of the user's data outside the auth tables: R2 objects of each
 * statement, the Vectorize vectors of each merchant, then (in one D1 batch) allocations,
 * transactions, statements, merchants and categories. Runs before better-auth deletes the
 * user, sessions and accounts (packages/auth `deleteUser.beforeDelete`).
 *
 * Resumable: the D1 rows that list what to delete in R2 and Vectorize are removed last,
 * so a failure part-way leaves them in place and the next attempt picks up the rest.
 */
export async function purgeUserData(deps: DeletionDeps, userId: string): Promise<UserPurge> {
  const { db, env } = deps;
  const statementIds = await listUserStatementIds(db, { userId });
  let r2Objects = 0;
  for (const statementId of statementIds) {
    r2Objects += await deleteR2Prefix(env.STATEMENTS, statementPrefix(statementId));
  }
  const merchantIds = await listUserMerchantIds(db, { userId });
  await deleteVectors(env.VECTORIZE, merchantIds);
  await deleteUserFinanceRows(db, { userId });
  return { statements: statementIds.length, r2Objects, vectors: merchantIds.length };
}

export type PrivacyStatus = {
  currentVersion: string;
  acceptedAt: Date | null;
  acceptedVersion: string | null;
  /** True when the user accepted the current version. */
  accepted: boolean;
};

export async function getPrivacyStatus(deps: {
  db: Database;
  userId: string;
}): Promise<PrivacyStatus> {
  const row = await getPrivacyAcceptance(deps.db, { userId: deps.userId });
  const acceptedAt = row?.acceptedAt ?? null;
  const acceptedVersion = row?.version ?? null;
  return {
    currentVersion: PRIVACY_POLICY_VERSION,
    acceptedAt,
    acceptedVersion,
    accepted: acceptedAt !== null && acceptedVersion === PRIVACY_POLICY_VERSION,
  };
}

/** Records that the user accepted the current privacy notice, now. */
export async function acceptPrivacy(deps: {
  db: Database;
  userId: string;
  now?: Date;
}): Promise<PrivacyStatus> {
  const row = await recordPrivacyAcceptance(deps.db, {
    userId: deps.userId,
    version: PRIVACY_POLICY_VERSION,
    at: deps.now ?? new Date(),
  });
  if (!row) throw new PrivacyError("NOT_FOUND", "User not found.");
  return getPrivacyStatus(deps);
}

/** Throws FORBIDDEN unless the user accepted the current privacy notice. */
export async function assertPrivacyAccepted(deps: { db: Database; userId: string }) {
  const status = await getPrivacyStatus(deps);
  if (!status.accepted) {
    throw new PrivacyError(
      "FORBIDDEN",
      "Read and accept the privacy notice before uploading a statement.",
    );
  }
}
