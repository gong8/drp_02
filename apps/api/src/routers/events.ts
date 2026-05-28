import { randomUUID } from "node:crypto";
import {
  CreateEventInput,
  ResolveInput,
  RespondInput,
  type ResponseInput,
  resolveIn,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { events, groupMembers, groups, responses, users } from "../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

type MyStatus = "awaiting" | "going" | "declined";

async function responsesFor(eventId: string): Promise<ResponseInput[]> {
  const rows = await db.select().from(responses).where(eq(responses.eventId, eventId));
  return rows.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined }));
}

// This user's status for one event: declined (said no), going (a yes or a satisfied
// conditional), or awaiting (no answer yet, or a conditional not yet satisfied).
function statusFor(userId: string, resp: ResponseInput[]): MyStatus {
  const mine = resp.find((r) => r.userId === userId);
  if (mine?.kind === "no") return "declined";
  return resolveIn(resp).has(userId) ? "going" : "awaiting";
}

export const eventsRouter = router({
  // Create a concrete meet for a group. The creator sets the time and place up front.
  create: publicProcedure.input(CreateEventInput).mutation(async ({ ctx, input }) => {
    const id = `e_${randomUUID()}`;
    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      title: input.title,
      description: input.description ?? null,
      location: input.location,
      startsAt: new Date(input.startsAt),
      respondByAt: new Date(input.respondByAt),
      status: "open",
    });
    // TODO push: notify group members "X suggested a meet - can you make it?"
    return { id };
  }),

  // The dashboard: every event in the current user's groups, with this user's status.
  // The client groups these by status (Awaiting / Going / Declined) and then by date.
  mine: publicProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return [];

    const rows = await db.select().from(events).where(inArray(events.groupId, groupIds));
    return Promise.all(
      rows.map(async (e) => {
        const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));
        const resp = await responsesFor(e.id);
        return {
          id: e.id,
          groupName: g?.name ?? "Group",
          title: e.title,
          location: e.location,
          startsAt: e.startsAt.toISOString(),
          respondByAt: e.respondByAt.toISOString(),
          myStatus: statusFor(ctx.userId, resp),
        };
      }),
    );
  }),

  // One event in full: details, my current response, the people I can name in a
  // conditional, and the going crowd (only those going are ever listed).
  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));

    const resp = await responsesFor(e.id);
    const inSet = resolveIn(resp);

    const going: { id: string; name: string; color: string }[] = [];
    for (const id of inSet) {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      going.push({ id, name: u?.name ?? "Someone", color: u?.avatarColor ?? "#8B948B" });
    }

    const memberRows = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, e.groupId));
    const members: { id: string; name: string }[] = [];
    for (const row of memberRows) {
      if (row.userId === ctx.userId) continue;
      const [u] = await db.select().from(users).where(eq(users.id, row.userId));
      members.push({ id: row.userId, name: u?.name ?? "Someone" });
    }

    const mine = resp.find((r) => r.userId === ctx.userId);
    return {
      id: e.id,
      groupName: g?.name ?? "Group",
      title: e.title,
      description: e.description,
      location: e.location,
      startsAt: e.startsAt.toISOString(),
      respondByAt: e.respondByAt.toISOString(),
      msLeft: Math.max(0, e.respondByAt.getTime() - Date.now()),
      resolved: Date.now() > e.respondByAt.getTime() || e.status === "resolved",
      myResponse: mine ? { kind: mine.kind, cond: mine.cond ?? null } : null,
      myStatus: statusFor(ctx.userId, resp),
      members,
      going,
    };
  }),

  // Record (or replace) this user's RSVP.
  respond: publicProcedure.input(RespondInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await db
      .delete(responses)
      .where(and(eq(responses.eventId, input.eventId), eq(responses.userId, ctx.userId)));
    await db.insert(responses).values({
      id: randomUUID(),
      eventId: input.eventId,
      userId: ctx.userId,
      kind: input.kind,
      cond: input.cond ?? null,
    });
    return { recorded: true as const };
  }),

  // The deadline: lock the event. Conditionals are already resolved live for display;
  // the event always happens, so this just flips the status to resolved.
  resolve: publicProcedure.input(ResolveInput).mutation(async ({ input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    if (e.status === "open" && Date.now() > e.respondByAt.getTime()) {
      await db.update(events).set({ status: "resolved" }).where(eq(events.id, input.eventId));
    }
    return { ok: true as const };
  }),
});
