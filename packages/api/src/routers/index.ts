import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { allocationsRouter } from "./allocations";
import { categoriesRouter } from "./categories";
import { extractionRouter } from "./extraction";
import { reportsRouter } from "./reports";
import { statementsRouter } from "./statements";
import { transactionsRouter } from "./transactions";

export const appRouter = {
  extraction: extractionRouter,
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  allocations: allocationsRouter,
  reports: reportsRouter,
  statements: statementsRouter,
  categories: categoriesRouter,
  transactions: transactionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
