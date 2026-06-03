import { randomUUID } from "node:crypto";
import {
  AddIdeaInput,
  AddTimeInput,
  ByIdInput,
  CreateFloatInput,
  defaultLockAtForWindow,
  expandWindow,
  type FloatAxis,
  PART_HOUR,
  type PartOfDay,
  ToggleVoteInput,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { FALLBACK_GROUP_NAME, getGroupName } from "../db/groups.js";
import { events, floatSuggestions, floatVotes, groupMembers, groups } from "../db/schema.js";
import { msLeft } from "../format.js";
import { protectedProcedure, router } from "../trpc.js";
import { type EventRow, requireMember, settleFloating } from "./events.js";

type SuggestionRow = typeof floatSuggestions.$inferSelect;

const DEFAULT_MIN_HEAT = 2;

// Idea identity for case-insensitive de-dup: trimmed and lower-cased. Single source so the seed
// de-dup and the addIdea dup-check agree on what counts as "the same idea".
function ideaKey(text: string): string {
  return text.trim().toLowerCase();
}

// Trim + case-insensitive de-dup of seed idea text, preserving first-seen casing and order.
function dedupeIdeas(ideas: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ideas) {
    const text = raw.trim();
    if (!text) continue;
    const key = ideaKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// The brewing-only fields shared by floats.mine and floats.get: when it was floated, its tip
// deadline, and the live countdown to that tip. Single source so the two reads never drift.
function tipFields(e: EventRow): {
  createdAt: string;
  tipAt: string | null;
  msLeftToTip: number | null;
} {
  return {
    createdAt: e.createdAt.toISOString(),
    tipAt: e.lockAt?.toISOString() ?? null,
    msLeftToTip: msLeft(e.lockAt),
  };
}

// Load a float for a mutation: caller must be a member, and it must still be brewing. Settling first
// means a float past its deadline tips here (and then rejects the late chip) rather than mutating a
// stale brew. The loaded row drives only side effects (member-check, settle, phase guard), so this
// returns nothing.
async function loadFloating(eventId: string, userId: string): Promise<void> {
  const [e] = await db.select().from(events).where(eq(events.id, eventId));
  if (!e) throw new TRPCError({ code: "NOT_FOUND" });
  await requireMember(e.groupId, userId);
  await settleFloating(e);
  if (e.phase !== "floating") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "this float has already tipped" });
  }
}

// A member's own +1 on a chip (adding a chip implies +1'ing it). Idempotent.
async function castVote(eventId: string, suggestionId: string, userId: string): Promise<void> {
  await db.insert(floatVotes).values({ eventId, suggestionId, userId }).onConflictDoNothing();
}

// Insert a fresh chip on the given axis (null-filling the columns the axis does not use), then +1 it
// for the author (adding a chip implies +1'ing it). Returns the new chip id. The single source for
// the chip row shape and the axis-prefixed id format across create/addIdea/addTime.
async function addSuggestion(
  eventId: string,
  userId: string,
  axis: FloatAxis,
  payload: { text?: string | null; partOfDay?: PartOfDay | null; startsAt?: Date | null },
): Promise<string> {
  const id = `${eventId}_${axis === "idea" ? "i" : "t"}_${randomUUID()}`;
  await db.insert(floatSuggestions).values({
    id,
    eventId,
    axis,
    text: payload.text ?? null,
    partOfDay: payload.partOfDay ?? null,
    startsAt: payload.startsAt ?? null,
    createdByUserId: userId,
  });
  await castVote(eventId, id, userId);
  return id;
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
      tipAt = new Date(defaultLockAtForWindow(lastMs, Date.now()));
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
      await addSuggestion(id, ctx.userId, "idea", { text });
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
    const dup = existing.find((s) => ideaKey(s.text ?? "") === ideaKey(text));
    if (dup) {
      await castVote(input.eventId, dup.id, ctx.userId);
      return { id: dup.id };
    }
    return { id: await addSuggestion(input.eventId, ctx.userId, "idea", { text }) };
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
    return {
      id: await addSuggestion(input.eventId, ctx.userId, "time", {
        partOfDay: input.band,
        startsAt: day,
      }),
    };
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
    // settleFloating mutates in place and may flip a row out of floating, so run it per-row first,
    // then batch the group-name and suggestion lookups for the survivors (avoids the N+1).
    for (const e of rows) await settleFloating(e);
    const live = rows.filter((e) => e.phase === "floating"); // dropped rows just tipped: events.mine
    if (live.length === 0) return [];

    const groupRows = await db
      .select()
      .from(groups)
      .where(inArray(groups.id, [...new Set(live.map((e) => e.groupId))]));
    const groupNames = new Map(groupRows.map((g) => [g.id, g.name] as const));
    const suggRows = await db
      .select()
      .from(floatSuggestions)
      .where(
        inArray(
          floatSuggestions.eventId,
          live.map((e) => e.id),
        ),
      );
    const ideaCounts = new Map<string, number>();
    const timeCounts = new Map<string, number>();
    for (const s of suggRows) {
      const counts = s.axis === "idea" ? ideaCounts : timeCounts;
      counts.set(s.eventId, (counts.get(s.eventId) ?? 0) + 1);
    }

    return live.map((e) => ({
      id: e.id,
      groupName: groupNames.get(e.groupId) ?? FALLBACK_GROUP_NAME,
      ...tipFields(e),
      ideaCount: ideaCounts.get(e.id) ?? 0,
      timeCount: timeCounts.get(e.id) ?? 0,
    }));
  }),

  // One float's board: the two chip axes with public counts + the caller's own votes. If it tipped
  // while brewing, signal the client to hand off to the normal plan view. NEVER exposes who voted.
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleFloating(e);
    if (e.phase !== "floating") {
      return { phase: "tipped" as const, eventId: e.id };
    }

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
      .map((s) => ({
        ...base(s),
        partOfDay: s.partOfDay,
        startsAt: s.startsAt?.toISOString() ?? null,
      }))
      .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));

    return {
      phase: "floating" as const,
      id: e.id,
      groupName: await getGroupName(e.groupId),
      ...tipFields(e),
      minHeat: e.minHeat,
      ideas,
      times,
    };
  }),
});
