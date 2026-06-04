import { randomUUID } from "node:crypto";
import {
  AddCandidateInput,
  addCandidateHorizon,
  ByIdInput,
  CandidateKind,
  CreateEventInput,
  clears,
  DEFAULT_MOMENT_MINUTES,
  defaultDecidesByForCandidates,
  LockInput,
  MOMENT_MS,
  type MomentResponse,
  type PartOfDay,
  pickWinnerOrBestId,
  pickWinningCandidate,
  ResolveInput,
  RespondInput,
  resolveIn,
  revealGoing,
  SetOptOutInput,
  ToggleReactionInput,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { getGroupName } from "../db/groups.js";
import {
  candidateReactions,
  eventCandidates,
  eventOptOuts,
  events,
  groupMembers,
  responses,
  users,
} from "../db/schema.js";
import { FALLBACK_AVATAR_COLOR, FALLBACK_USER_NAME, getUserCard } from "../db/users.js";
import { msLeft } from "../format.js";
import { protectedProcedure, router } from "../trpc.js";
import { planOpensMoment } from "./create-plan.js";

export type EventRow = typeof events.$inferSelect;
type MyStatus = "reacting" | "awaiting" | "going" | "declined";

const DEFAULT_QUORUM = 2;
// With no time candidates a plan still collects (on activities); anchor its placeholder start and
// default decides-by this far out so the deadline is sane without a concrete time to hang it on.
const DEFAULT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

async function responsesFor(eventId: string): Promise<MomentResponse[]> {
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
  return rows.sort((a, b) => {
    const at = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

// The crowd is hidden until the moment ends (or the plan is cleared/fizzled), so a live moment
// shows its countdown instead of biasing people with who is already in. null while still blind.
function goingFromRow(e: EventRow, resp: MomentResponse[]): string[] | null {
  return revealGoing(resp, {
    momentEndsAtMs: e.momentEndsAt ? e.momentEndsAt.getTime() : Number.POSITIVE_INFINITY,
    resolved: e.phase === "cleared" || e.phase === "fizzled",
    nowMs: Date.now(),
  });
}

// The blind moment always ends by the event itself. Use the configured window, but never run past
// the chosen start; if the start is already here, fall back to a full window so there is always a
// real moment to answer (and we never reveal before anyone could respond).
function computeMomentEnd(now: Date, minutes: number, chosenStartsAt: Date): Date {
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

// Fizzle a plan: persist the silent dead-end (and resolve it) then mirror onto the in-memory row so
// the same read returns the new phase. The single source for every "this plan fizzles" transition.
async function fizzle(e: EventRow): Promise<void> {
  await db.update(events).set({ phase: "fizzled", status: "resolved" }).where(eq(events.id, e.id));
  e.phase = "fizzled";
}

// Persist a plan's candidate slate (one row per slot). Time candidates carry a startsAt + optional
// part-of-day hint; activity candidates carry a label and a null startsAt. Single source for the
// candidate row shape across create and the addCandidate mutation.
async function insertCandidates(
  eventId: string,
  rows: {
    id: string;
    kind: CandidateKind;
    startsAt: Date | null;
    partOfDay: PartOfDay | null;
    label: string | null;
  }[],
): Promise<void> {
  for (const r of rows) {
    await db.insert(eventCandidates).values({
      id: r.id,
      eventId,
      kind: r.kind,
      startsAt: r.startsAt,
      partOfDay: r.partOfDay,
      label: r.label,
    });
  }
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
    await fizzle(e);
    return;
  }
  const candIds = cands.map((c) => c.id);
  // The slate is non-empty (guarded above), so the winner-or-best id always resolves to a real
  // candidate here - the lookup is guaranteed to hit.
  const chosenId = pickWinnerOrBestId(candIds, reactions, e.quorum);
  const chosen = cands.find((c) => c.id === chosenId) as (typeof cands)[number];
  const now = new Date();
  const endsAt = computeMomentEnd(now, DEFAULT_MOMENT_MINUTES, chosen.startsAt);
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
function computeBaseStatus(
  userId: string,
  resp: MomentResponse[],
  revealed: string[] | null,
): MyStatus {
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
    out.push(await getUserCard(id));
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
      color: u?.avatarColor ?? FALLBACK_AVATAR_COLOR,
      initial: (u?.name ?? "?").charAt(0).toUpperCase(),
    });
  }
  return { goingCount: revealed.length, preview };
}

// Caller must belong to the group. Identity (ctx.userId) is a dev stub today, so this is
// correctness/scoping rather than real auth - see docs/tech-debt.md for the auth gap.
export async function requireMember(groupId: string, userId: string): Promise<void> {
  const m = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  if (m.length === 0) throw new TRPCError({ code: "FORBIDDEN" });
}

// Load an event for a member-scoped mutation: fetch by id, 404 if missing, then assert membership.
// The shared head of the NOT_FOUND mutations (react/setOptOut/addCandidate/lock/respond/unrespond/
// resolve); the null-returning reads (events.get, floats.get) keep their own preamble.
export async function loadEvent(eventId: string, userId: string): Promise<EventRow> {
  const [e] = await db.select().from(events).where(eq(events.id, eventId));
  if (!e) throw new TRPCError({ code: "NOT_FOUND" });
  await requireMember(e.groupId, userId);
  return e;
}

// Run the convergence pass in its load-bearing order: a collecting round locks, then a moment
// clears/fizzles. Each step no-ops unless the row is in its phase, so it is safe on any row.
async function settleLifecycle(e: EventRow): Promise<void> {
  await settleCollecting(e);
  await settlePhase(e);
}

// The opt-out-aware status of the caller, shared by mine (dashboard) and get (detail). In collecting
// an opt-out reads as declined else reacting; after collecting an opt-out with no moment answer reads
// as declined, else the blind/revealed rule. Takes iOptedOut precomputed - it never queries.
function computeMyStatus(
  phase: EventRow["phase"],
  userId: string,
  resp: MomentResponse[],
  revealed: string[] | null,
  iOptedOut: boolean,
): MyStatus {
  if (phase === "collecting") return iOptedOut ? "declined" : "reacting";
  return iOptedOut && !resp.find((r) => r.userId === userId)
    ? "declined"
    : computeBaseStatus(userId, resp, revealed);
}

export const eventsRouter = router({
  // Create one plan. It owns two candidate lists - TIME and ACTIVITY - each react-able with public
  // +1 counts. The creator is ALWAYS anonymous. The only real fork is the concrete shortcut: one time
  // candidate that the creator locks opens the blind moment immediately; everything else collects.
  create: protectedProcedure.input(CreateEventInput).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const id = `e_${randomUUID()}`;

    const timeInputs = input.timeCandidates ?? [];
    const activityInputs = input.activityCandidates ?? [];

    const timeCands = timeInputs
      .map((t, i) => ({
        id: `${id}_t${i + 1}`,
        kind: "time" as const,
        startsAt: new Date(t.startsAt),
        partOfDay: t.partOfDay ?? null,
        label: null,
      }))
      .filter((c) => !Number.isNaN(c.startsAt.getTime()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const activityCands = activityInputs.map((text, i) => ({
      id: `${id}_a${i + 1}`,
      kind: "activity" as const,
      startsAt: null,
      partOfDay: null,
      label: text,
    }));

    const opensMoment = planOpensMoment(timeCands.length, input.lockTimes);
    const quorum = input.quorum ?? (opensMoment ? 1 : DEFAULT_QUORUM);

    // Time anchors. With no time candidates a plan still collects (on activities), so anchor the
    // placeholder start + the default decides-by to a sensible horizon instead of a candidate.
    const now = Date.now();
    const earliestMs = timeCands.length > 0 ? timeCands[0].startsAt.getTime() : now + DEFAULT_HORIZON_MS;
    const lastMs =
      timeCands.length > 0 ? timeCands[timeCands.length - 1].startsAt.getTime() : earliestMs;
    const startsAt = new Date(earliestMs); // the chosen time when opensMoment; a placeholder otherwise

    // The concrete shortcut opens the blind moment now and runs until the event itself; respond stays
    // open the whole time and the crowd reveals when it starts. If that time is already here, fall
    // back to a short window so there is always a real moment to answer.
    const momentStartsAt = opensMoment ? new Date() : null;
    let momentEndsAt: Date | null = opensMoment ? startsAt : null;
    if (opensMoment && momentEndsAt && momentEndsAt.getTime() <= now) {
      momentEndsAt = new Date(now + MOMENT_MS);
    }
    const respondByAt = momentEndsAt ?? new Date(lastMs);

    // Collecting plans converge by a fixed deadline ("Decides by"), then auto-pick the winner. The
    // creator may override it; the override must sit after now and leave the blind moment room before
    // the time window. With no time candidates we only have activities, so any future deadline is fine.
    let decidesBy: Date | null = null;
    if (!opensMoment) {
      if (input.decidesBy) {
        const t = new Date(input.decidesBy);
        const tooLate = timeCands.length > 0 && t.getTime() > earliestMs - MOMENT_MS;
        if (Number.isNaN(t.getTime()) || t.getTime() <= now || tooLate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "decides-by must be after now and leave room before the plan's window",
          });
        }
        decidesBy = t;
      } else {
        decidesBy = new Date(defaultDecidesByForCandidates(earliestMs, now));
      }
    }

    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      title: input.title ?? "",
      description: input.description ?? null,
      location: input.location ?? "",
      startsAt,
      respondByAt,
      status: "open",
      contingent: !opensMoment,
      quorum,
      isAnonymous: true,
      lockTimes: input.lockTimes,
      lockThings: input.lockThings,
      phase: opensMoment ? "moment" : "collecting",
      decidesBy,
      chosenCandidateId: opensMoment && timeCands.length > 0 ? timeCands[0].id : null,
      momentStartsAt,
      momentEndsAt,
    });
    await insertCandidates(id, [...timeCands, ...activityCands]);
    // TODO push: notify group members "a plan went out - what works?" / "you're in a moment".
    return { id };
  }),

  // Toggle the caller's public +1 on ONE candidate (time or activity) during collecting. Counts are
  // PUBLIC (momentum), but who reacted is never shown. Adding a +1 rejoins anyone who had opted out.
  toggleReaction: protectedProcedure.input(ToggleReactionInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting reactions" });
    }
    const [cand] = await db
      .select()
      .from(eventCandidates)
      .where(eq(eventCandidates.id, input.candidateId));
    if (!cand || cand.eventId !== input.eventId) throw new TRPCError({ code: "NOT_FOUND" });

    const mine = await db
      .select()
      .from(candidateReactions)
      .where(
        and(
          eq(candidateReactions.eventId, input.eventId),
          eq(candidateReactions.candidateId, input.candidateId),
          eq(candidateReactions.userId, ctx.userId),
        ),
      );
    if (mine.length > 0) {
      await db
        .delete(candidateReactions)
        .where(
          and(
            eq(candidateReactions.eventId, input.eventId),
            eq(candidateReactions.candidateId, input.candidateId),
            eq(candidateReactions.userId, ctx.userId),
          ),
        );
      return { reacted: false as const };
    }
    await db
      .insert(candidateReactions)
      .values({ eventId: input.eventId, candidateId: input.candidateId, userId: ctx.userId });
    // A +1 rejoins anyone who had opted out (mutual exclusion with "I can't make it").
    await db
      .delete(eventOptOuts)
      .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));
    return { reacted: true as const };
  }),

  // A member bows out of a collecting plan ("I can't make it") or rejoins. Opting out clears their
  // reactions (dropping them from the tally/quorum) and excludes them from the moment + reminders.
  // Private: no one else, not even the creator, sees it. Reversible via out:false or by reacting.
  setOptOut: protectedProcedure.input(SetOptOutInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
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
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid time" });
    }
    // A new slot must sit after the lock-in deadline (still a live choice when we lock) and within
    // the plan's window/horizon (fuzzy: the window's last day; options: a small slack past the
    // existing spread). Keeps the deadline meaningful without recomputing it.
    if (e.lockAt && startsAt.getTime() <= e.lockAt.getTime()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "that time is before the lock-in deadline",
      });
    }
    const existing = await candidatesFor(input.eventId);
    if (existing.length === 0) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "plan has no candidates" });
    }
    const times = existing.map((c) => c.startsAt.getTime());
    const horizon = addCandidateHorizon(
      Math.min(...times),
      Math.max(...times),
      e.whenMode === "fuzzy",
    );
    if (startsAt.getTime() > horizon) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "that time is past this plan's window",
      });
    }
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
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.isAnonymous) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "a float is ownerless - it tips on its own",
      });
    }
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

    const requestedId =
      input.candidateId && candIds.includes(input.candidateId) ? input.candidateId : null;
    const chosenId = requestedId ?? pickWinnerOrBestId(candIds, reactions, e.quorum);
    const chosen = cands.find((c) => c.id === chosenId);
    if (!chosen) throw new TRPCError({ code: "BAD_REQUEST", message: "unknown candidate" });

    const minutes = input.momentMinutes ?? DEFAULT_MOMENT_MINUTES;
    const now = new Date();
    const momentEndsAt = computeMomentEnd(now, minutes, chosen.startsAt);
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
        await settleLifecycle(e);
        if (e.phase === "floating") return null; // still brewing: shown in the Brewing zone (floats.mine)
        if (e.phase === "fizzled") return null; // silent: a fizzle leaves no trace
        const resp = await responsesFor(e.id);
        const revealed = goingFromRow(e, resp);
        const { goingCount, preview } = await goingPreview(revealed);
        // A float stays unsigned forever: the originator is never flagged as creator, even post-tip.
        const isCreator = !e.isAnonymous && e.createdByUserId === ctx.userId;
        const iOptedOut = (await optedOut(e.id)).has(ctx.userId);
        const myStatus = computeMyStatus(e.phase, ctx.userId, resp, revealed, iOptedOut);

        let iReacted = false;
        let candidateCount = 0;
        let readyToLock = false;
        if (e.phase === "collecting") {
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
        }

        return {
          id: e.id,
          groupName: await getGroupName(e.groupId),
          title: e.title,
          location: e.location,
          whenMode: e.whenMode,
          phase: e.phase,
          startsAt: e.startsAt.toISOString(),
          createdAt: e.createdAt.toISOString(),
          lockAt: e.lockAt?.toISOString() ?? null,
          msLeftToLock: msLeft(e.lockAt),
          momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
          momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
          msLeft: msLeft(e.momentEndsAt),
          myStatus,
          iReacted,
          // Whether the caller has a moment answer on record (any of yes/no/conditional). Drives
          // "is this still Action Required" for the moment, where myStatus alone can't tell a blind
          // conditional ("awaiting") from a genuine no-answer.
          iResponded: resp.some((r) => r.userId === ctx.userId),
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
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleLifecycle(e);
    if (e.phase === "floating") return null; // a still-brewing float is read via floats.get

    const resp = await responsesFor(e.id);
    const revealed = goingFromRow(e, resp);
    // A float stays unsigned forever: the originator is never flagged as creator, even post-tip.
    const isCreator = !e.isAnonymous && e.createdByUserId === ctx.userId;
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
      members.push({ id: row.userId, name: u?.name ?? FALLBACK_USER_NAME });
    }

    const showCrowd = revealed !== null && e.phase !== "fizzled";
    const going = showCrowd ? await buildGoing(revealed) : [];
    const mine = resp.find((r) => r.userId === ctx.userId);
    const chosen = cands.find((c) => c.id === e.chosenCandidateId) ?? null;

    return {
      id: e.id,
      groupName: await getGroupName(e.groupId),
      title: e.title,
      description: e.description,
      location: e.location,
      whenMode: e.whenMode,
      phase: e.phase,
      contingent: e.contingent,
      quorum: e.quorum,
      startsAt: e.startsAt.toISOString(),
      lockAt: e.lockAt?.toISOString() ?? null,
      msLeftToLock: msLeft(e.lockAt),
      chosenStartsAt: chosen?.startsAt.toISOString() ?? null,
      momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
      momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
      msLeft: msLeft(e.momentEndsAt),
      revealed: showCrowd,
      isCreator,
      iOptedOut,
      readyToLock,
      candidates,
      myReactionCandidateIds: [...myReacts],
      myResponse: mine ? { kind: mine.kind, cond: mine.cond ?? null } : null,
      myStatus: computeMyStatus(e.phase, ctx.userId, resp, revealed, iOptedOut),
      members,
      going,
    };
  }),

  // Record (or replace) this user's commitment during the moment.
  respond: protectedProcedure.input(RespondInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
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

  // Clear the caller's moment answer (the "Change" action): they return to un-answered, so the plan
  // goes back to Action Required until they answer again.
  unrespond: protectedProcedure.input(ResolveInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.phase !== "moment") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "the moment is not open" });
    }
    await db
      .delete(responses)
      .where(and(eq(responses.eventId, input.eventId), eq(responses.userId, ctx.userId)));
    return { ok: true as const };
  }),

  // Settle the moment once its countdown has ended: cleared (quorum met or non-contingent) or a
  // silent fizzle. Idempotent and safe to call early (it no-ops until the deadline passes).
  resolve: protectedProcedure.input(ResolveInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await settleCollecting(e);
    await settlePhase(e);
    return { ok: true as const, phase: e.phase };
  }),
});
