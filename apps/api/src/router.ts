import { eventsRouter } from "./routers/events.js";
import { floatsRouter } from "./routers/floats.js";
import { groupsRouter } from "./routers/groups.js";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  groups: groupsRouter,
  events: eventsRouter,
  floats: floatsRouter,
});
export type AppRouter = typeof appRouter;
