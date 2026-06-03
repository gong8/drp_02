import { randomUUID } from "node:crypto";
import {
  AddIdeaInput,
  AddTimeInput,
  CreateFloatInput,
  defaultLockAtForWindow,
  expandWindow,
  PART_HOUR,
  ToggleVoteInput,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { events, floatSuggestions, floatVotes, groupMembers, groups } from "../db/schema.js";
import { protectedProcedure, router } from "../trpc.js";
import { requireMember, settleFloating } from "./events.js";

type EventRow = typeof events.$inferSelect;
type SuggestionRow = typeof floatSuggestions.$inferSelect;

const DEFAULT_MOMENT_MINUTES = 60;
const DEFAULT_MIN_HEAT = 2;

// Trim + case-insensitive de-dup of seed idea text, preserving first-seen casing and order.
function dedupeIdeas(ideas: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ideas) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// Load a float for a mutation: caller must be a member, and it must still be brewing. Settling first
// means a float past its deadline tips here (and then rejects the late chip) rather than mutating a
// stale brew.
async function loadFloating(eventId: string, userId: string): Promise<EventRow> {
  const [e] = await db.select().from(events).where(eq(events.id, eventId));
  if (!e) throw new TRPCError({ code: "NOT_FOUND" });
  await requireMember(e.groupId, userId);
  await settleFloating(e);
  if (e.phase !== "floating") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "this float has already tipped" });
  }
  return e;
}

// A member's own +1 on a chip (adding a chip implies +1'ing it). Idempotent.
async function castVote(eventId: string, suggestionId: string, userId: string): Promise<void> {
  await db.insert(floatVotes).values({ eventId, suggestionId, userId }).onConflictDoNothing();
}

export const floatsRouter = router({
  // Float a loose idea to a group - ALWAYS unsigned and ownerless. The seed ideas become the first
  // IDEA chips (each auto-+1'd by the floater). The window sets the tip deadline; it converges on its
  // own (no one locks it). `createdByUserId` is stored for accountability but never surfaced.
  create: protectedProcedure.input(CreateFloatInput).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const id = `e_${randomUUID()}`;
    const band = input.window.band ?? "evening";
    const slots = expandWindow(input.window.timescale, band, Date.now());
    const earliestMs = new Date(slots[0].startsAt).getTime();
    const lastMs = new Date(slots[slots.length - 1].startsAt).getTime();

    let tipAt: Date;
    if (input.tipAt) {
      const t = new Date(input.tipAt);
      if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now() || t.getTime() > earliestMs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "tip time must be after now and on or before the window",
        });
      }
      tipAt = t;
    } else {
      tipAt = new Date(
        defaultLockAtForWindow(lastMs, Date.now(), DEFAULT_MOMENT_MINUTES * 60 * 1000),
      );
    }

    const minHeat = input.minHeat ?? DEFAULT_MIN_HEAT;
    const startsAt = new Date(slots[0].startsAt); // window placeholder until it crystallizes

    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      title: "",
      description: null,
      location: "",
      startsAt,
      respondByAt: tipAt,
      status: "open",
      whenMode: "fuzzy",
      contingent: true,
      quorum: minHeat,
      isAnonymous: true,
      minHeat,
      phase: "floating",
      lockAt: tipAt,
      chosenCandidateId: null,
      momentStartsAt: null,
      momentEndsAt: null,
    });

    for (const text of dedupeIdeas(input.ideas)) {
      const sid = `${id}_i_${randomUUID()}`;
      await db.insert(floatSuggestions).values({
        id: sid,
        eventId: id,
        axis: "idea",
        text,
        partOfDay: null,
        startsAt: null,
        createdByUserId: ctx.userId,
      });
      await castVote(id, sid, ctx.userId);
    }
    // TODO push (notifications seam): "someone floated an idea in <group>".
    return { id };
  }),

  // Any member drops a free-text IDEA chip (fused what+where). De-duped case-insensitively against the
  // existing ideas - a duplicate just +1s the one that's already there. Adding implies +1.
  addIdea: protectedProcedure.input(AddIdeaInput).mutation(async ({ ctx, input }) => {
    await loadFloating(input.eventId, ctx.userId);
    const text = input.text.trim();
    if (!text) throw new TRPCError({ code: "BAD_REQUEST", message: "idea cannot be empty" });
    const existing = await db
      .select()
      .from(floatSuggestions)
      .where(and(eq(floatSuggestions.eventId, input.eventId), eq(floatSuggestions.axis, "idea")));
    const dup = existing.find((s) => (s.text ?? "").trim().toLowerCase() === text.toLowerCase());
    if (dup) {
      await castVote(input.eventId, dup.id, ctx.userId);
      return { id: dup.id };
    }
    const id = `${input.eventId}_i_${randomUUID()}`;
    await db.insert(floatSuggestions).values({
      id,
      eventId: input.eventId,
      axis: "idea",
      text,
      partOfDay: null,
      startsAt: null,
      createdByUserId: ctx.userId,
    });
    await castVote(input.eventId, id, ctx.userId);
    return { id };
  }),

  // Any member drops a loose TIME band (a day at a part-of-day). De-duped on the resolved slot.
  addTime: protectedProcedure.input(AddTimeInput).mutation(async ({ ctx, input }) => {
    await loadFloating(input.eventId, ctx.userId);
    const day = new Date(input.day);
    if (Number.isNaN(day.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid day" });
    }
    day.setHours(PART_HOUR[input.band], 0, 0, 0);
    const existing = await db
      .select()
      .from(floatSuggestions)
      .where(and(eq(floatSuggestions.eventId, input.eventId), eq(floatSuggestions.axis, "time")));
    const dup = existing.find((s) => s.startsAt?.getTime() === day.getTime());
    if (dup) {
      await castVote(input.eventId, dup.id, ctx.userId);
      return { id: dup.id };
    }
    const id = `${input.eventId}_t_${randomUUID()}`;
    await db.insert(floatSuggestions).values({
      id,
      eventId: input.eventId,
      axis: "time",
      text: null,
      partOfDay: input.band,
      startsAt: day,
      createdByUserId: ctx.userId,
    });
    await castVote(input.eventId, id, ctx.userId);
    return { id };
  }),

  // One-tap +1 / un-+1 on any chip. Interest, not commitment - it never touches the moment RSVP.
  toggleVote: protectedProcedure.input(ToggleVoteInput).mutation(async ({ ctx, input }) => {
    await loadFloating(input.eventId, ctx.userId);
    const [s] = await db
      .select()
      .from(floatSuggestions)
      .where(eq(floatSuggestions.id, input.suggestionId));
    if (!s || s.eventId !== input.eventId) throw new TRPCError({ code: "NOT_FOUND" });
    const mine = await db
      .select()
      .from(floatVotes)
      .where(
        and(eq(floatVotes.suggestionId, input.suggestionId), eq(floatVotes.userId, ctx.userId)),
      );
    if (mine.length > 0) {
      await db
        .delete(floatVotes)
        .where(
          and(eq(floatVotes.suggestionId, input.suggestionId), eq(floatVotes.userId, ctx.userId)),
        );
      return { voted: false as const };
    }
    await castVote(input.eventId, input.suggestionId, ctx.userId);
    return { voted: true as const };
  }),

  // The Brewing zone: every still-floating plan in the caller's groups. No names, ever - only counts.
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return [];

    const rows = await db
      .select()
      .from(events)
      .where(and(inArray(events.groupId, groupIds), eq(events.phase, "floating")));
    const out: {
      id: string;
      groupName: string;
      createdAt: string;
      tipAt: string | null;
      msLeftToTip: number | null;
      ideaCount: number;
      timeCount: number;
    }[] = [];
    for (const e of rows) {
      await settleFloating(e);
      if (e.phase !== "floating") continue; // just tipped - it surfaces via events.mine now
      const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));
      const sugg = await db
        .select()
        .from(floatSuggestions)
        .where(eq(floatSuggestions.eventId, e.id));
      out.push({
        id: e.id,
        groupName: g?.name ?? "Group",
        createdAt: e.createdAt.toISOString(),
        tipAt: e.lockAt?.toISOString() ?? null,
        msLeftToTip: e.lockAt ? Math.max(0, e.lockAt.getTime() - Date.now()) : null,
        ideaCount: sugg.filter((s) => s.axis === "idea").length,
        timeCount: sugg.filter((s) => s.axis === "time").length,
      });
    }
    return out;
  }),

  // One float's board: the two chip axes with public counts + the caller's own votes. If it tipped
  // while brewing, signal the client to hand off to the normal plan view. NEVER exposes who voted.
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleFloating(e);
    if (e.phase !== "floating") {
      return { phase: "tipped" as const, eventId: e.id };
    }

    const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));
    const sugg = await db.select().from(floatSuggestions).where(eq(floatSuggestions.eventId, e.id));
    const votes = await db.select().from(floatVotes).where(eq(floatVotes.eventId, e.id));

    const countBy = new Map<string, number>();
    const mineSet = new Set<string>();
    for (const v of votes) {
      countBy.set(v.suggestionId, (countBy.get(v.suggestionId) ?? 0) + 1);
      if (v.userId === ctx.userId) mineSet.add(v.suggestionId);
    }
    const base = (s: SuggestionRow) => ({
      id: s.id,
      count: countBy.get(s.id) ?? 0,
      mine: mineSet.has(s.id),
    });
    const ideas = sugg
      .filter((s) => s.axis === "idea")
      .map((s) => ({ ...base(s), text: s.text ?? "" }))
      .sort((a, b) => b.count - a.count);
    const times = sugg
      .filter((s) => s.axis === "time")
      .map((s) => ({ ...base(s), band: s.partOfDay, startsAt: s.startsAt?.toISOString() ?? null }))
      .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));

    return {
      phase: "floating" as const,
      id: e.id,
      groupName: g?.name ?? "Group",
      createdAt: e.createdAt.toISOString(),
      tipAt: e.lockAt?.toISOString() ?? null,
      msLeftToTip: e.lockAt ? Math.max(0, e.lockAt.getTime() - Date.now()) : null,
      minHeat: e.minHeat,
      ideas,
      times,
    };
  }),
});
