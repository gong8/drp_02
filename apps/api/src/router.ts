import { eventsRouter } from "./routers/events.js";
import { groupsRouter } from "./routers/groups.js";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  groups: groupsRouter,
  events: eventsRouter,
});
export type AppRouter = typeof appRouter;
