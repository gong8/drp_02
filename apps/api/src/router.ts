import { momentsRouter } from "./routers/moments.js";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  moments: momentsRouter,
});

export type AppRouter = typeof appRouter;
