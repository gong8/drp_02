import { randomUUID } from "node:crypto";
import { headlineFor, ResolveInput, RespondInput } from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { groupMembers, moments, plans, responses, suggestions, users } from "../db/schema.js";
import { formatWhen } from "../format.js";
import { resolveMoment } from "../services/bethere.js";
import { publicProcedure, router } from "../trpc.js";

export const momentsRouter = router({
  // The proposal as THIS user may see it. `members` are the GROUP's members (minus the
  // current user) - used to populate the "I'm in if…" picker; group membership is not
  // secret. NEVER returns participantIds, others' responses, or any tally (blind/equal).
  mine: publicProcedure.query(async ({ ctx }) => {
    const open = await db.select().from(moments).where(eq(moments.status, "open"));
    const m = open.find((row) => row.participantIds.includes(ctx.userId));
    if (!m) return null;

    const [sug] = await db.select().from(suggestions).where(eq(suggestions.id, m.suggestionId));
    const memberRows = sug
      ? await db.select().from(groupMembers).where(eq(groupMembers.groupId, sug.groupId))
      : [];
    const members: { id: string; name: string }[] = [];
    for (const row of memberRows) {
      if (row.userId === ctx.userId) continue;
      const [u] = await db.select().from(users).where(eq(users.id, row.userId));
      members.push({ id: row.userId, name: u?.name ?? "Someone" });
    }

    return {
      id: m.id,
      activity: m.activity,
      title: headlineFor(m.activity),
      place: m.proposedPlace,
      detail: formatWhen(m.proposedTime),
      msLeft: Math.max(0, m.windowEndsAt.getTime() - Date.now()),
      members,
    };
  }),

  // Records the user's answer (one per user - a later answer replaces an earlier one).
  // Returns only { recorded } - never the running tally (blind).
  respond: publicProcedure.input(RespondInput).mutation(async ({ ctx, input }) => {
    const [moment] = await db.select().from(moments).where(eq(moments.id, input.momentId));
    if (!moment) throw new TRPCError({ code: "NOT_FOUND" });
    await db
      .delete(responses)
      .where(and(eq(responses.momentId, input.momentId), eq(responses.userId, ctx.userId)));
    await db.insert(responses).values({
      id: randomUUID(),
      momentId: input.momentId,
      userId: ctx.userId,
      kind: input.kind,
      cond: input.cond ?? null,
    });
    return { recorded: true as const };
  }),

  // The buzzer: resolve conditionals and decide clear vs fizzle (delegates to the
  // service). On clear we reveal the IN count; on fizzle nothing (privacy §8.5).
  resolve: publicProcedure.input(ResolveInput).mutation(async ({ input }) => {
    const [moment] = await db.select().from(moments).where(eq(moments.id, input.momentId));
    if (!moment) throw new TRPCError({ code: "NOT_FOUND" });
    return resolveMoment(input.momentId);
  }),

  // The firm plan for a cleared moment. Only a participant may read it. Reveals only the
  // IN crowd (safe - they opted in); No's / non-responders are never represented (§8.4).
  plan: publicProcedure.input(ResolveInput).query(async ({ ctx, input }) => {
    const [m] = await db.select().from(moments).where(eq(moments.id, input.momentId));
    if (!m?.participantIds.includes(ctx.userId)) return null;
    const [p] = await db.select().from(plans).where(eq(plans.momentId, input.momentId));
    if (!p) return null;

    const people: { id: string; name: string; color: string }[] = [];
    for (const id of p.confirmedParticipantIds) {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      people.push({ id, name: u?.name ?? "Someone", color: u?.avatarColor ?? "#8B948B" });
    }

    return {
      activity: p.activity,
      place: p.place,
      detail: formatWhen(p.finalTime),
      finalTimeMs: p.finalTime.getTime(),
      people,
    };
  }),
});
