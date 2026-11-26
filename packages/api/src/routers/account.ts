import { mapServiceError } from "../errors";
import { protectedProcedure } from "../index";
import { acceptPrivacy, getPrivacyStatus } from "../privacy";

// Account deletion is better-auth's POST /api/auth/delete-user; its beforeDelete hook runs
// `purgeUserData` (apps/server/src/services.ts) before the user row goes.
export const accountRouter = {
  /** Whether the user accepted the current privacy notice, and when. */
  privacy: protectedProcedure.handler(({ context }) =>
    getPrivacyStatus({ db: context.db, userId: context.session.user.id }),
  ),

  /** Records acceptance of the current privacy notice. Required before the first upload. */
  acceptPrivacy: protectedProcedure.handler(async ({ context }) => {
    try {
      return await acceptPrivacy({ db: context.db, userId: context.session.user.id });
    } catch (error) {
      throw mapServiceError(error);
    }
  }),
};
