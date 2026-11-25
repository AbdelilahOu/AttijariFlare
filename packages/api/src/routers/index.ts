import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { allocationsRouter } from "./allocations";
import { extractionRouter } from "./extraction";
import { reportsRouter } from "./reports";
import { statementsRouter } from "./statements";

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
  reports: reportsRouter,
  statements: statementsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
