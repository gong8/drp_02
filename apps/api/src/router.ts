import { availabilityRouter } from "./routers/availability.js";
import { groupsRouter } from "./routers/groups.js";
import { momentsRouter } from "./routers/moments.js";
import { suggestionsRouter } from "./routers/suggestions.js";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  groups: groupsRouter,
  suggestions: suggestionsRouter,
  availability: availabilityRouter,
  moments: momentsRouter,
});
export type AppRouter = typeof appRouter;
