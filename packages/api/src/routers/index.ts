import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { allocationsRouter } from "./allocations";
import { categoriesRouter } from "./categories";
import { extractionRouter } from "./extraction";
import { statementsRouter } from "./statements";
import { transactionsRouter } from "./transactions";

export const appRouter = {
  extraction: extractionRouter,
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  allocations: allocationsRouter,
  statements: statementsRouter,
  categories: categoriesRouter,
  transactions: transactionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
