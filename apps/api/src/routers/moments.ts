import { randomUUID } from "node:crypto";
import { ResolveInput, RespondInput, resolveIn } from "@drp/shared";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { moments, responses } from "../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

export const momentsRouter = router({
  // The proposal as THIS user may see it. Returns only display fields — never
  // participantIds, others' responses, or any tally (blind/equal during the window).
  mine: publicProcedure.query(async ({ ctx }) => {
    const open = await db.select().from(moments).where(eq(moments.status, "open"));
    const forMe = open.find((m) => m.participantIds.includes(ctx.userId));
    if (!forMe) return null;
    return {
      id: forMe.id,
      activity: forMe.activity,
      title: forMe.title,
      place: forMe.place,
      detail: forMe.detail,
    };
  }),

  // Records the user's answer (one per user — a later answer replaces an earlier one).
  // Returns only { recorded } — never the running tally (blind).
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

  // The buzzer: resolve conditionals and decide clear vs fizzle. On clear we reveal
  // the IN count (those people opted in — safe to show). On fizzle we reveal nothing,
  // not even how close it got (privacy §8.5). Idempotent once resolved.
  resolve: publicProcedure.input(ResolveInput).mutation(async ({ input }) => {
    const [moment] = await db.select().from(moments).where(eq(moments.id, input.momentId));
    if (!moment) throw new TRPCError({ code: "NOT_FOUND" });

    const rows = await db.select().from(responses).where(eq(responses.momentId, moment.id));
    const inSet = resolveIn(
      rows.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined })),
    );

    let status = moment.status;
    if (status === "open") {
      status = inSet.size >= moment.quorum ? "cleared" : "fizzled";
      await db.update(moments).set({ status }).where(eq(moments.id, moment.id));
    }
    return status === "cleared"
      ? { status: "cleared" as const, inCount: inSet.size }
      : { status: "fizzled" as const };
  }),
});
