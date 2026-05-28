import { randomUUID } from "node:crypto";
import { DropAvailabilityInput } from "@bethere/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { availability, suggestions, users } from "../db/schema.js";
import { seedDemoPeerYeses } from "../db/seed.js";
import { tryFireMoment } from "../services/bethere.js";
import { publicProcedure, router } from "../trpc.js";

export const availabilityRouter = router({
  // Drop loose availability for a suggestion (re-dropping replaces the prior set), then
  // try to fire a moment. NEVER returns who-else dropped or any count (privacy §8.1).
  drop: publicProcedure.input(DropAvailabilityInput).mutation(async ({ ctx, input }) => {
    await db
      .delete(availability)
      .where(
        and(eq(availability.suggestionId, input.suggestionId), eq(availability.userId, ctx.userId)),
      );
    await db.insert(availability).values({
      id: randomUUID(),
      suggestionId: input.suggestionId,
      userId: ctx.userId,
      slots: input.slots,
    });
    const firedMomentId = await tryFireMoment(input.suggestionId);
    // DEMO ONLY: simulate the other matched people saying yes so a solo tester can
    // reach a real clear/fizzle. Removed when real multi-user lands.
    if (firedMomentId) await seedDemoPeerYeses(firedMomentId, ctx.userId);
    return { floating: true, firedMomentId };
  }),

  // Silent withdraw - deletes this user's availability for the suggestion. No one notified.
  withdraw: publicProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(availability)
        .where(
          and(
            eq(availability.suggestionId, input.suggestionId),
            eq(availability.userId, ctx.userId),
          ),
        );
      return { ok: true as const };
    }),

  // ONLY the current user's own floating availability - never anyone else's (privacy §8.1).
  mine: publicProcedure.query(async ({ ctx }) => {
    const rows = await db.select().from(availability).where(eq(availability.userId, ctx.userId));
    const items = await Promise.all(
      rows.map(async (r) => {
        const [sug] = await db.select().from(suggestions).where(eq(suggestions.id, r.suggestionId));
        if (sug?.status !== "collecting") return null;
        const [by] = await db.select().from(users).where(eq(users.id, sug.byUserId));
        return {
          suggestionId: r.suggestionId,
          activity: sug.activity,
          byName: by?.name ?? "Someone",
          slots: r.slots,
        };
      }),
    );
    return items.filter((x): x is NonNullable<typeof x> => x !== null);
  }),
});
