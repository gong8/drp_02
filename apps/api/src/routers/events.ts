import { randomUUID } from "node:crypto";
import {
  AddCandidateInput,
  CreateEventInput,
  clears,
  defaultLockAt,
  expandWindow,
  LockInput,
  type PartOfDay,
  pickWinningCandidate,
  ReactInput,
  ResolveInput,
  RespondInput,
  type ResponseInput,
  resolveIn,
  revealGoing,
  SetOptOutInput,
  tallyCandidates,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  candidateReactions,
  eventCandidates,
  eventOptOuts,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "../db/schema.js";
import { protectedProcedure, router } from "../trpc.js";

type EventRow = typeof events.$inferSelect;
type MyStatus = "reacting" | "awaiting" | "going" | "declined";

const DEFAULT_QUORUM = 2;
const DEFAULT_MOMENT_MINUTES = 60;

async function responsesFor(eventId: string): Promise<ResponseInput[]> {
  const rows = await db.select().from(responses).where(eq(responses.eventId, eventId));
  return rows.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined }));
}

async function reactionsFor(eventId: string): Promise<{ candidateId: string; userId: string }[]> {
  const rows = await db
    .select()
    .from(candidateReactions)
    .where(eq(candidateReactions.eventId, eventId));
  return rows.map((r) => ({ candidateId: r.candidateId, userId: r.userId }));
}

async function candidatesFor(eventId: string): Promise<(typeof eventCandidates.$inferSelect)[]> {
  const rows = await db.select().from(eventCandidates).where(eq(eventCandidates.eventId, eventId));
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// The crowd is hidden until the moment ends (or the plan is cleared/fizzled), so a live moment
// shows its countdown instead of biasing people with who is already in. null while still blind.
function revealedGoing(e: EventRow, resp: ResponseInput[]): string[] | null {
  return revealGoing(resp, {
    respondByAtMs: e.momentEndsAt ? e.momentEndsAt.getTime() : Number.POSITIVE_INFINITY,
    status: e.phase === "cleared" || e.phase === "fizzled" ? "resolved" : e.phase,
    nowMs: Date.now(),
  });
}

// The blind moment always ends by the event itself. Use the configured window, but never run past
// the chosen start; if the start is already here, fall back to a full window so there is always a
// real moment to answer (and we never reveal before anyone could respond).
function momentEnd(now: Date, minutes: number, chosenStartsAt: Date): Date {
  const windowEnd = new Date(now.getTime() + minutes * 60 * 1000);
  if (chosenStartsAt.getTime() <= now.getTime()) return windowEnd;
  return new Date(Math.min(windowEnd.getTime(), chosenStartsAt.getTime()));
}

// Who has opted out of a (collecting) plan. Their reactions are already cleared, so this is only
// needed to reflect their own "declined" status; the tally never sees them.
async function optedOut(eventId: string): Promise<Set<string>> {
  const rows = await db.select().from(eventOptOuts).where(eq(eventOptOuts.eventId, eventId));
  return new Set(rows.map((r) => r.userId));
}

// Lazily settle a moment whose countdown has ended (no scheduler): clears if quorum is met, else
// fizzles - but a non-contingent (exact) plan always happens, so it clears regardless. Mutates the
// in-memory row and persists, so reads converge the lifecycle on their own.
async function settlePhase(e: EventRow): Promise<void> {
  if (e.phase !== "moment" || !e.momentEndsAt || Date.now() <= e.momentEndsAt.getTime()) return;
  const resp = await responsesFor(e.id);
  const next = clears(resp, e.quorum) || !e.contingent ? "cleared" : "fizzled";
  await db.update(events).set({ phase: next, status: "resolved" }).where(eq(events.id, e.id));
  e.phase = next;
}

// Lazily auto-lock a collecting plan whose deadline (`lockAt`) has passed (no scheduler): pick the
// best-supported slot - the one meeting quorum, else the most-reacted ("lock the best anyway") -
// and open the blind moment. Opted-out members have no reactions, so they are excluded for free;
// with zero reactions at all the plan fizzles silently rather than opening an empty moment. Mutates
// the in-memory row and persists, so reads converge the lifecycle on their own.
async function settleCollecting(e: EventRow): Promise<void> {
  if (e.phase !== "collecting" || !e.lockAt || Date.now() < e.lockAt.getTime()) return;
  const cands = await candidatesFor(e.id);
  const reactions = await reactionsFor(e.id);
  if (cands.length === 0 || reactions.length === 0) {
    await db
      .update(events)
      .set({ phase: "fizzled", status: "resolved" })
      .where(eq(events.id, e.id));
    e.phase = "fizzled";
    return;
  }
  const candIds = cands.map((c) => c.id);
  const winner = pickWinningCandidate(candIds, reactions, e.quorum);
  const chosenId = winner
    ? winner.candidateId
    : [...tallyCandidates(candIds, reactions)].sort(
        (a, b) => b.userIds.length - a.userIds.length,
      )[0].candidateId;
  const chosen = cands.find((c) => c.id === chosenId);
  if (!chosen) return;
  const now = new Date();
  const endsAt = momentEnd(now, DEFAULT_MOMENT_MINUTES, chosen.startsAt);
  await db
    .update(events)
    .set({
      phase: "moment",
      chosenCandidateId: chosenId,
      momentStartsAt: now,
      momentEndsAt: endsAt,
      startsAt: chosen.startsAt,
      respondByAt: endsAt,
    })
    .where(eq(events.id, e.id));
  e.phase = "moment";
  e.chosenCandidateId = chosenId;
  e.momentStartsAt = now;
  e.momentEndsAt = endsAt;
  e.startsAt = chosen.startsAt;
}

// This user's status. During a blind moment we only ever reflect their OWN answer (we cannot leak
// others); once revealed we use the full resolved IN set.
function statusFor(userId: string, resp: ResponseInput[], revealed: string[] | null): MyStatus {
  const mine = resp.find((r) => r.userId === userId);
  if (revealed) {
    if (mine?.kind === "no") return "declined";
    return resolveIn(resp).has(userId) ? "going" : "awaiting";
  }
  if (!mine) return "awaiting";
  if (mine.kind === "no") return "declined";
  if (mine.kind === "yes") return "going";
  return "awaiting"; // a conditional we cannot resolve blind
}

async function buildGoing(
  revealed: string[],
): Promise<{ id: string; name: string; color: string }[]> {
  const out: { id: string; name: string; color: string }[] = [];
  for (const id of revealed) {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    out.push({ id, name: u?.name ?? "Someone", color: u?.avatarColor ?? "#8B948B" });
  }
  return out;
}

async function goingPreview(revealed: string[] | null): Promise<{
  goingCount: number | null;
  preview: { uid: string; color: string; initial: string }[];
}> {
  if (!revealed) return { goingCount: null, preview: [] };
  const preview: { uid: string; color: string; initial: string }[] = [];
  for (const uid of revealed.slice(0, 4)) {
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    preview.push({
      uid,
      color: u?.avatarColor ?? "#8B948B",
      initial: (u?.name ?? "?").charAt(0).toUpperCase(),
    });
  }
  return { goingCount: revealed.length, preview };
}

// Caller must belong to the group. Identity (ctx.userId) is a dev stub today, so this is
// correctness/scoping rather than real auth - see docs/tech-debt.md for the auth gap.
async function requireMember(groupId: string, userId: string): Promise<void> {
  const m = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  if (m.length === 0) throw new TRPCError({ code: "FORBIDDEN" });
}

export const eventsRouter = router({
  // Create one plan. The `when` precision routes everything: an exact time opens straight into the
  // blind moment and always happens; an options menu or a fuzzy window starts collecting reactions.
  create: protectedProcedure.input(CreateEventInput).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const id = `e_${randomUUID()}`;
    const when = input.when;

    let cands: { id: string; startsAt: Date; partOfDay: PartOfDay | null }[] = [];
    if (when.mode === "exact") {
      cands = [{ id: `${id}_c1`, startsAt: new Date(when.startsAt), partOfDay: null }];
    } else if (when.mode === "options") {
      cands = when.options.map((iso, i) => ({
        id: `${id}_c${i + 1}`,
        startsAt: new Date(iso),
        partOfDay: null,
      }));
    } else {
      const slots = expandWindow(when.timescale, when.band, Date.now());
      cands = slots.map((s, i) => ({
        id: `${id}_d${i + 1}`,
        startsAt: new Date(s.startsAt),
        partOfDay: s.partOfDay,
      }));
    }
    cands.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const exact = when.mode === "exact";
    const quorum = input.quorum ?? (exact ? 1 : DEFAULT_QUORUM);
    const startsAt = cands[0].startsAt; // the chosen time for exact; a placeholder until lock otherwise
    // Exact plans open the blind moment now and run until the event itself, so respond stays open the
    // whole time and the crowd reveals when it starts. If that time is already here, fall back to a
    // short window so there is always a real moment to answer (and we never reveal before anyone can).
    const momentStartsAt = exact ? new Date() : null;
    let momentEndsAt: Date | null = exact ? startsAt : null;
    if (exact && momentEndsAt && momentEndsAt.getTime() <= Date.now()) {
      momentEndsAt = new Date(Date.now() + DEFAULT_MOMENT_MINUTES * 60 * 1000);
    }
    const respondByAt = momentEndsAt ?? cands[cands.length - 1].startsAt;

    // Non-exact plans collect until a deadline, then auto-lock the winning slot. Default to "the day
    // before" the earliest slot; honour an explicit creator override if it sits after now and no
    // later than that earliest slot (so we never lock in a time that has already passed).
    let lockAt: Date | null = null;
    if (!exact) {
      const earliestMs = cands[0].startsAt.getTime();
      if (input.lockAt) {
        const t = new Date(input.lockAt);
        if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now() || t.getTime() > earliestMs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "lock-in time must be after now and on or before the earliest proposed time",
          });
        }
        lockAt = t;
      } else {
        lockAt = new Date(
          defaultLockAt(earliestMs, Date.now(), DEFAULT_MOMENT_MINUTES * 60 * 1000),
        );
      }
    }

    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? "",
      startsAt,
      respondByAt,
      status: "open",
      whenMode: when.mode,
      contingent: !exact,
      quorum,
      phase: exact ? "moment" : "collecting",
      lockAt,
      chosenCandidateId: exact ? cands[0].id : null,
      momentStartsAt,
      momentEndsAt,
    });
    for (const c of cands) {
      await db.insert(eventCandidates).values({
        id: c.id,
        eventId: id,
        startsAt: c.startsAt,
        partOfDay: c.partOfDay,
        label: null,
      });
    }
    // TODO push: notify group members "X floated a plan - which times work?" / "you're in a moment".
    return { id };
  }),

  // Replace the caller's "these times work for me" reactions during collecting. Private: only the
  // caller and the creator (via the tally) ever see them.
  react: protectedProcedure.input(ReactInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await requireMember(e.groupId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting reactions" });
    }
    const cands = await candidatesFor(input.eventId);
    const valid = new Set(cands.map((c) => c.id));
    const chosen = input.worksCandidateIds.filter((cid) => valid.has(cid));
    await db
      .delete(candidateReactions)
      .where(
        and(
          eq(candidateReactions.eventId, input.eventId),
          eq(candidateReactions.userId, ctx.userId),
        ),
      );
    for (const candidateId of chosen) {
      await db
        .insert(candidateReactions)
        .values({ eventId: input.eventId, candidateId, userId: ctx.userId });
    }
    // Reacting to a time rejoins anyone who had opted out (mutual exclusion with "I can't make it").
    if (chosen.length > 0) {
      await db
        .delete(eventOptOuts)
        .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));
    }
    return { recorded: true as const };
  }),

  // A member bows out of a collecting plan ("I can't make it") or rejoins. Opting out clears their
  // reactions (dropping them from the tally/quorum) and excludes them from the moment + reminders.
  // Private: no one else, not even the creator, sees it. Reversible via out:false or by reacting.
  setOptOut: protectedProcedure.input(SetOptOutInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await requireMember(e.groupId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    if (input.out) {
      await db
        .delete(candidateReactions)
        .where(
          and(
            eq(candidateReactions.eventId, input.eventId),
            eq(candidateReactions.userId, ctx.userId),
          ),
        );
      await db
        .insert(eventOptOuts)
        .values({ eventId: input.eventId, userId: ctx.userId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(eventOptOuts)
        .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));
    }
    return { ok: true as const };
  }),

  // Any group member (not just the creator) can propose a new concrete time while the plan is still
  // collecting - the crowd simply gains another slot to react to. New candidates carry no
  // part-of-day and no author. Identical minutes are de-duped so two proposers can't clutter the list.
  addCandidate: protectedProcedure.input(AddCandidateInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await requireMember(e.groupId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid time" });
    }
    // A new slot must sit after the lock-in deadline, so it is still a live choice when we lock and
    // the invariant lockAt <= earliest candidate holds.
    if (e.lockAt && startsAt.getTime() <= e.lockAt.getTime()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "that time is before the lock-in deadline",
      });
    }
    const existing = await candidatesFor(input.eventId);
    const dup = existing.find((c) => c.startsAt.getTime() === startsAt.getTime());
    if (dup) return { id: dup.id };
    const id = `${input.eventId}_c_${randomUUID()}`;
    await db.insert(eventCandidates).values({
      id,
      eventId: input.eventId,
      startsAt,
      partOfDay: null,
      label: null,
    });
    return { id };
  }),

  // The creator locks the winning slot, opening the blind timed moment. With no candidateId we pick
  // the best-supported candidate (falling back to the most-reacted so a lock always succeeds).
  lock: protectedProcedure.input(LockInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await requireMember(e.groupId, ctx.userId);
    if (e.createdByUserId !== ctx.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "only the creator can lock the moment" });
    }
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    const cands = await candidatesFor(input.eventId);
    if (cands.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "no candidates" });
    const candIds = cands.map((c) => c.id);
    const reactions = await reactionsFor(input.eventId);

    let chosenId =
      input.candidateId && candIds.includes(input.candidateId) ? input.candidateId : null;
    if (!chosenId) {
      const winner = pickWinningCandidate(candIds, reactions, e.quorum);
      chosenId = winner
        ? winner.candidateId
        : [...tallyCandidates(candIds, reactions)].sort(
            (a, b) => b.userIds.length - a.userIds.length,
          )[0].candidateId;
    }
    const chosen = cands.find((c) => c.id === chosenId);
    if (!chosen) throw new TRPCError({ code: "BAD_REQUEST", message: "unknown candidate" });

    const minutes = input.momentMinutes ?? DEFAULT_MOMENT_MINUTES;
    const now = new Date();
    const momentEndsAt = momentEnd(now, minutes, chosen.startsAt);
    await db
      .update(events)
      .set({
        phase: "moment",
        chosenCandidateId: chosenId,
        momentStartsAt: now,
        momentEndsAt,
        startsAt: chosen.startsAt,
        respondByAt: momentEndsAt,
      })
      .where(eq(events.id, input.eventId));
    return { ok: true as const, chosenCandidateId: chosenId };
  }),

  // The dashboard: every (non-fizzled) plan in the user's groups, phase-aware.
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return [];

    const rows = await db.select().from(events).where(inArray(events.groupId, groupIds));
    const out = await Promise.all(
      rows.map(async (e) => {
        await settleCollecting(e);
        await settlePhase(e);
        if (e.phase === "fizzled") return null; // silent: a fizzle leaves no trace
        const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));
        const resp = await responsesFor(e.id);
        const revealed = revealedGoing(e, resp);
        const { goingCount, preview } = await goingPreview(revealed);
        const isCreator = e.createdByUserId === ctx.userId;
        const iOpted = (await optedOut(e.id)).has(ctx.userId);

        let myStatus: MyStatus;
        let iReacted = false;
        let candidateCount = 0;
        let readyToLock = false;
        if (e.phase === "collecting") {
          myStatus = iOpted ? "declined" : "reacting";
          const cands = await candidatesFor(e.id);
          candidateCount = cands.length;
          const myReacts = await db
            .select()
            .from(candidateReactions)
            .where(
              and(eq(candidateReactions.eventId, e.id), eq(candidateReactions.userId, ctx.userId)),
            );
          iReacted = myReacts.length > 0;
          if (isCreator) {
            const reactions = await reactionsFor(e.id);
            readyToLock =
              pickWinningCandidate(
                cands.map((c) => c.id),
                reactions,
                e.quorum,
              ) !== null;
          }
        } else {
          const mineResp = resp.find((r) => r.userId === ctx.userId);
          myStatus = iOpted && !mineResp ? "declined" : statusFor(ctx.userId, resp, revealed);
        }

        return {
          id: e.id,
          groupName: g?.name ?? "Group",
          title: e.title,
          location: e.location,
          whenMode: e.whenMode,
          phase: e.phase,
          startsAt: e.startsAt.toISOString(),
          createdAt: e.createdAt.toISOString(),
          lockAt: e.lockAt?.toISOString() ?? null,
          msLeftToLock: e.lockAt ? Math.max(0, e.lockAt.getTime() - Date.now()) : null,
          momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
          momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
          msLeft: e.momentEndsAt ? Math.max(0, e.momentEndsAt.getTime() - Date.now()) : null,
          myStatus,
          iReacted,
          candidateCount,
          isCreator,
          readyToLock,
          goingCount,
          goingPreview: preview,
        };
      }),
    );
    return out.filter((x): x is NonNullable<typeof x> => x !== null);
  }),

  // One plan in full, phase-aware: candidates + my reactions (collecting), the blind countdown
  // (moment), and the revealed IN crowd (cleared). Counts stay private to the creator.
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleCollecting(e);
    await settlePhase(e);
    const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));

    const resp = await responsesFor(e.id);
    const revealed = revealedGoing(e, resp);
    const isCreator = e.createdByUserId === ctx.userId;
    const iOptedOut = (await optedOut(e.id)).has(ctx.userId);

    const cands = await candidatesFor(e.id);
    const reactions = await reactionsFor(e.id);
    const myReacts = new Set(
      reactions.filter((r) => r.userId === ctx.userId).map((r) => r.candidateId),
    );
    // Per-candidate counts are deliberately NOT returned: nobody (not even the creator) sees how
    // many are free for each slot before the lock. The auto-lock picks the winner server-side.
    const candidates = cands.map((c) => ({
      id: c.id,
      startsAt: c.startsAt.toISOString(),
      partOfDay: c.partOfDay,
      label: c.label,
      worksForMe: myReacts.has(c.id),
    }));
    const readyToLock =
      isCreator &&
      e.phase === "collecting" &&
      pickWinningCandidate(
        cands.map((c) => c.id),
        reactions,
        e.quorum,
      ) !== null;

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

    const showCrowd = revealed !== null && e.phase !== "fizzled";
    const going = showCrowd ? await buildGoing(revealed) : [];
    const mine = resp.find((r) => r.userId === ctx.userId);
    const chosen = cands.find((c) => c.id === e.chosenCandidateId) ?? null;

    return {
      id: e.id,
      groupName: g?.name ?? "Group",
      title: e.title,
      description: e.description,
      location: e.location,
      whenMode: e.whenMode,
      phase: e.phase,
      contingent: e.contingent,
      quorum: e.quorum,
      startsAt: e.startsAt.toISOString(),
      lockAt: e.lockAt?.toISOString() ?? null,
      msLeftToLock: e.lockAt ? Math.max(0, e.lockAt.getTime() - Date.now()) : null,
      chosenStartsAt: chosen?.startsAt.toISOString() ?? null,
      momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
      momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
      msLeft: e.momentEndsAt ? Math.max(0, e.momentEndsAt.getTime() - Date.now()) : null,
      revealed: showCrowd,
      isCreator,
      iOptedOut,
      readyToLock,
      candidates,
      myReactionCandidateIds: [...myReacts],
      myResponse: mine ? { kind: mine.kind, cond: mine.cond ?? null } : null,
      myStatus:
        e.phase === "collecting"
          ? iOptedOut
            ? ("declined" as const)
            : ("reacting" as const)
          : iOptedOut && !mine
            ? ("declined" as const)
            : statusFor(ctx.userId, resp, revealed),
      members,
      going,
    };
  }),

  // Record (or replace) this user's commitment during the moment.
  respond: protectedProcedure.input(RespondInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await requireMember(e.groupId, ctx.userId);
    if (e.phase !== "moment") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "the moment is not open" });
    }
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
    // An explicit moment answer supersedes any earlier opt-out (the escape hatch back in).
    await db
      .delete(eventOptOuts)
      .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));
    return { recorded: true as const };
  }),

  // Settle the moment once its countdown has ended: cleared (quorum met or non-contingent) or a
  // silent fizzle. Idempotent and safe to call early (it no-ops until the deadline passes).
  resolve: protectedProcedure.input(ResolveInput).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await requireMember(e.groupId, ctx.userId);
    await settleCollecting(e);
    await settlePhase(e);
    return { ok: true as const, phase: e.phase };
  }),
});
