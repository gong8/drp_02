import { randomUUID } from "node:crypto";
import { CreateSuggestionInput } from "@bethere/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { suggestions, users } from "../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

/** Inclusive YYYY-MM-DD strings from `start`..`end`, walked one local day at a time. */
function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${d.getFullYear()}-${month}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const suggestionsRouter = router({
  create: publicProcedure.input(CreateSuggestionInput).mutation(async ({ ctx, input }) => {
    const id = randomUUID();
    await db.insert(suggestions).values({
      id,
      groupId: input.groupId,
      byUserId: ctx.userId,
      activity: input.activity,
      text: input.text ?? null,
      windowStart: new Date(input.window.start),
      windowEnd: new Date(input.window.end),
      status: "collecting",
    });
    // TODO push: notify group members "X suggested … add your availability"
    return { id };
  }),

  // The suggestion as a prospective responder sees it: who suggested + the candidate
  // days. NEVER exposes any availability (who's free / counts) — that stays private.
  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [sug] = await db.select().from(suggestions).where(eq(suggestions.id, input.id));
    if (!sug) return null;
    const [by] = await db.select().from(users).where(eq(users.id, sug.byUserId));
    return {
      id: sug.id,
      activity: sug.activity,
      text: sug.text,
      byName: by?.name ?? "Someone",
      days: daysBetween(sug.windowStart, sug.windowEnd),
    };
  }),
});
