import { randomUUID } from "node:crypto";
import {
  AddCandidateInput,
  addCandidateHorizon,
  ByIdInput,
  type CandidateKind,
  CreateEventInput,
  clears,
  defaultDecidesByForCandidates,
  defaultReplyByMs,
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
import { displayTitle, planOpensMoment, resolveTitle } from "./create-plan.js";

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

// When the blind moment ends: the creator's "reply by" if set, else the default (one-day-capped from
// the open, to the event). Clamped to leave a real window after the moment starts and to never run
// past the event itself; if the event is already here, fall back to a full short window so there is
// always a moment to answer (and we never reveal before anyone could respond).
function resolveMomentEnd(openMs: number, eventMs: number, replyByMs: number | null): Date {
  if (eventMs <= openMs) return new Date(openMs + MOMENT_MS);
  const wanted = replyByMs ?? defaultReplyByMs(openMs, eventMs);
  const floor = openMs + Math.min(MOMENT_MS, eventMs - openMs);
  return new Date(Math.min(eventMs, Math.max(wanted, floor)));
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

// The author's own public +1 on a candidate (adding a candidate implies +1'ing it). Idempotent.
async function reactFor(eventId: string, candidateId: string, userId: string): Promise<void> {
  await db
    .insert(candidateReactions)
    .values({ eventId, candidateId, userId })
    .onConflictDoNothing();
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

// Lazily auto-lock a collecting plan whose "Decides by" deadline has passed (no scheduler): pick the
// best-supported TIME candidate (quorum, else most-reacted), resolve the winning activity into the
// title if empty, and open the blind moment. Opted-out members have no reactions so they drop for
// free; with no time candidates, or no reactions of any kind, the plan fizzles silently (any +1 -
// even on an activity - keeps it alive, and it locks the best-supported or first time). Mutates + persists.
async function settleCollecting(e: EventRow): Promise<void> {
  if (e.phase !== "collecting" || !e.decidesBy || Date.now() < e.decidesBy.getTime()) return;
  const cands = await candidatesFor(e.id);
  const timeCands = cands.filter((c) => c.kind === "time" && c.startsAt);
  const reactions = await reactionsFor(e.id);
  if (timeCands.length === 0 || reactions.length === 0) {
    await fizzle(e);
    return;
  }
  const timeIds = timeCands.map((c) => c.id);
  const chosenId = pickWinnerOrBestId(timeIds, reactions, e.quorum);
  const chosen = timeCands.find((c) => c.id === chosenId) as (typeof timeCands)[number];
  const startsAt = chosen.startsAt as Date;
  const title = resolveTitle(
    e.title,
    cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })),
    reactions,
  );
  const now = new Date();
  const endsAt = resolveMomentEnd(now.getTime(), startsAt.getTime(), e.replyBy?.getTime() ?? null);
  await db
    .update(events)
    .set({
      phase: "moment",
      title,
      chosenCandidateId: chosenId,
      momentStartsAt: now,
      momentEndsAt: endsAt,
      startsAt,
      respondByAt: endsAt,
    })
    .where(eq(events.id, e.id));
  e.phase = "moment";
  e.title = title;
  e.chosenCandidateId = chosenId;
  e.momentStartsAt = now;
  e.momentEndsAt = endsAt;
  e.startsAt = startsAt;
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
// The shared head of the NOT_FOUND mutations (toggleReaction/setOptOut/addCandidate/lock/respond/
// unrespond/resolve); the null-returning read (events.get) keeps its own preamble.
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

    const opensMoment = planOpensMoment(
      timeCands.length,
      input.lockTimes,
      activityCands.length,
      input.lockThings,
    );
    const quorum = input.quorum ?? (opensMoment ? 1 : DEFAULT_QUORUM);

    // Concrete plans skip lock()/settleCollecting (where the collecting path resolves the title), so
    // resolve the single activity into the stored title now; collecting plans resolve it at lock.
    const resolvedTitle = opensMoment
      ? resolveTitle(
          input.title ?? "",
          activityCands.map((c) => ({ id: c.id, label: c.label })),
          [],
        )
      : (input.title ?? "");

    // Time anchors. With no time candidates a plan still collects (on activities), so anchor the
    // placeholder start + the default decides-by to a sensible horizon instead of a candidate.
    const now = Date.now();
    const earliestMs =
      timeCands.length > 0 ? timeCands[0].startsAt.getTime() : now + DEFAULT_HORIZON_MS;
    const lastMs =
      timeCands.length > 0 ? timeCands[timeCands.length - 1].startsAt.getTime() : earliestMs;
    const startsAt = new Date(earliestMs); // the chosen time when opensMoment; a placeholder otherwise

    const momentStartsAt = opensMoment ? new Date() : null;

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

    // Reply-by: when the blind RSVP window closes (then it reveals + resolves). Editable; defaulted at
    // lock when unset. Must sit after the vote closes (or now, for a concrete plan) and no later than
    // the earliest event time. Loose plans (no times yet) have no editor; it defaults at lock.
    let replyBy: Date | null = null;
    if (input.replyBy) {
      const t = new Date(input.replyBy);
      const floorMs = decidesBy ? decidesBy.getTime() : now;
      const tooLate = timeCands.length > 0 && t.getTime() > earliestMs;
      if (Number.isNaN(t.getTime()) || t.getTime() <= floorMs || tooLate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "reply-by must be after the vote closes and no later than the event",
        });
      }
      replyBy = t;
    }

    // The concrete shortcut opens the blind moment now and runs until reply-by (default one-day-capped,
    // to the event). Otherwise the moment opens later, at the lock.
    const momentEndsAt: Date | null = opensMoment
      ? resolveMomentEnd(now, earliestMs, replyBy?.getTime() ?? null)
      : null;
    const respondByAt = momentEndsAt ?? new Date(lastMs);

    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      title: resolvedTitle,
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
      replyBy,
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

  // Any member adds a candidate while collecting - a new time, or a new place/thing - and the crowd
  // gains another row to +1. Kind-gated by the creator's locks: a locked axis rejects new candidates.
  // Time candidates dedupe by minute; activity candidates dedupe case-insensitively. Adding +1s it.
  addCandidate: protectedProcedure.input(AddCandidateInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    if (input.kind === "time" && e.lockTimes) {
      throw new TRPCError({ code: "FORBIDDEN", message: "times are locked on this plan" });
    }
    if (input.kind === "activity" && e.lockThings) {
      throw new TRPCError({ code: "FORBIDDEN", message: "activities are locked on this plan" });
    }
    const existing = await candidatesFor(input.eventId);

    let newId: string;
    if (input.kind === "time") {
      if (!input.startsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "a time candidate needs a start time",
        });
      }
      const startsAt = new Date(input.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid time" });
      }
      // A new slot must sit after the decides-by deadline (still a live choice when we lock) and
      // within the plan's horizon (a small slack past the existing time spread).
      if (e.decidesBy && startsAt.getTime() <= e.decidesBy.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that time is before the decides-by deadline",
        });
      }
      const times = existing
        .filter((c) => c.kind === "time" && c.startsAt)
        .map((c) => (c.startsAt as Date).getTime());
      if (times.length > 0) {
        const horizon = addCandidateHorizon(Math.min(...times), Math.max(...times));
        if (startsAt.getTime() > horizon) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "that time is past this plan's window",
          });
        }
      }
      const dup = existing.find(
        (c) => c.kind === "time" && c.startsAt?.getTime() === startsAt.getTime(),
      );
      if (dup) {
        await reactFor(input.eventId, dup.id, ctx.userId);
        return { id: dup.id };
      }
      newId = `${input.eventId}_t_${randomUUID()}`;
      await db.insert(eventCandidates).values({
        id: newId,
        eventId: input.eventId,
        kind: "time",
        startsAt,
        partOfDay: input.partOfDay ?? null,
        label: null,
      });
    } else {
      if (!input.text) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "an activity needs a name" });
      }
      const text = input.text.trim();
      if (!text)
        throw new TRPCError({ code: "BAD_REQUEST", message: "an activity needs a name" });
      const key = text.toLowerCase();
      const dup = existing.find(
        (c) => c.kind === "activity" && (c.label ?? "").trim().toLowerCase() === key,
      );
      if (dup) {
        await reactFor(input.eventId, dup.id, ctx.userId);
        return { id: dup.id };
      }
      newId = `${input.eventId}_a_${randomUUID()}`;
      await db.insert(eventCandidates).values({
        id: newId,
        eventId: input.eventId,
        kind: "activity",
        startsAt: null,
        partOfDay: null,
        label: text,
      });
    }
    await reactFor(input.eventId, newId, ctx.userId);
    return { id: newId };
  }),

  // The creator locks the winning TIME, opening the blind moment. The creator is anonymous to others
  // but we still authorize via the stored createdByUserId (a self-check, never surfaced). With no
  // candidateId we pick the best-supported time (most public +1s). If the plan has no title yet, the
  // winning ACTIVITY becomes the title at lock.
  lock: protectedProcedure.input(LockInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.createdByUserId !== ctx.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "only the creator can lock the moment" });
    }
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    const cands = await candidatesFor(input.eventId);
    const timeCands = cands.filter((c) => c.kind === "time" && c.startsAt);
    if (timeCands.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "no time candidates to lock" });
    }
    const reactions = await reactionsFor(input.eventId);
    const timeIds = timeCands.map((c) => c.id);

    const requestedId =
      input.candidateId && timeIds.includes(input.candidateId) ? input.candidateId : null;
    const chosenId = requestedId ?? pickWinnerOrBestId(timeIds, reactions, e.quorum);
    const chosen = timeCands.find((c) => c.id === chosenId);
    if (!chosen?.startsAt)
      throw new TRPCError({ code: "BAD_REQUEST", message: "unknown candidate" });

    const title = resolveTitle(
      e.title,
      cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })),
      reactions,
    );

    const now = new Date();
    const momentEndsAt = resolveMomentEnd(
      now.getTime(),
      chosen.startsAt.getTime(),
      e.replyBy?.getTime() ?? null,
    );
    await db
      .update(events)
      .set({
        phase: "moment",
        title,
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
        if (e.phase === "fizzled") return null; // silent: a fizzle leaves no trace
        const resp = await responsesFor(e.id);
        const revealed = goingFromRow(e, resp);
        const { goingCount, preview } = await goingPreview(revealed);
        // A private self-check: returned as a boolean only, never the id - the creator stays anonymous.
        const isCreator = e.createdByUserId === ctx.userId;
        const iOptedOut = (await optedOut(e.id)).has(ctx.userId);
        const myStatus = computeMyStatus(e.phase, ctx.userId, resp, revealed, iOptedOut);

        let iReacted = false;
        let candidateCount = 0;
        let readyToLock = false;
        // Collecting plans have no real title yet (it is fixed at lock); show the leading activity or
        // a placeholder so a card never renders blank. Locked plans already carry a real title.
        let title = e.title;
        if (e.phase === "collecting") {
          const cands = await candidatesFor(e.id);
          candidateCount = cands.length;
          const reactions = await reactionsFor(e.id);
          iReacted = reactions.some((r) => r.userId === ctx.userId);
          title = displayTitle(
            e.title,
            cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })),
            reactions,
          );
          if (isCreator) {
            const timeIds = cands.filter((c) => c.kind === "time" && c.startsAt).map((c) => c.id);
            readyToLock = pickWinningCandidate(timeIds, reactions, e.quorum) !== null;
          }
        }

        return {
          id: e.id,
          groupName: await getGroupName(e.groupId),
          title,
          location: e.location,
          phase: e.phase,
          startsAt: e.startsAt.toISOString(),
          createdAt: e.createdAt.toISOString(),
          decidesBy: e.decidesBy?.toISOString() ?? null,
          msLeftToDecide: msLeft(e.decidesBy),
          momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
          momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
          msLeft: msLeft(e.momentEndsAt),
          myStatus,
          iReacted,
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

  // One plan in full, phase-aware: time + activity candidates with public +1 counts (collecting),
  // the blind countdown (moment), and the revealed IN crowd (cleared).
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleLifecycle(e);

    const resp = await responsesFor(e.id);
    const revealed = goingFromRow(e, resp);
    // A private self-check: returned as a boolean only, never the id - the creator stays anonymous.
    const isCreator = e.createdByUserId === ctx.userId;
    const iOptedOut = (await optedOut(e.id)).has(ctx.userId);

    const cands = await candidatesFor(e.id);
    const reactions = await reactionsFor(e.id);
    // Public per-candidate +1 counts (momentum) for BOTH kinds; who reacted is never returned, only
    // the count and whether the caller themselves reacted.
    const countBy = new Map<string, number>();
    const mineSet = new Set<string>();
    for (const r of reactions) {
      countBy.set(r.candidateId, (countBy.get(r.candidateId) ?? 0) + 1);
      if (r.userId === ctx.userId) mineSet.add(r.candidateId);
    }
    const timeCandidates = cands
      .filter((c) => c.kind === "time" && c.startsAt)
      .map((c) => ({
        id: c.id,
        startsAt: (c.startsAt as Date).toISOString(),
        partOfDay: c.partOfDay,
        count: countBy.get(c.id) ?? 0,
        mine: mineSet.has(c.id),
      }));
    const activityCandidates = cands
      .filter((c) => c.kind === "activity")
      .map((c) => ({
        id: c.id,
        text: c.label ?? "",
        count: countBy.get(c.id) ?? 0,
        mine: mineSet.has(c.id),
      }))
      .sort((a, b) => b.count - a.count);

    const timeIds = timeCandidates.map((c) => c.id);
    const readyToLock =
      isCreator &&
      e.phase === "collecting" &&
      pickWinningCandidate(timeIds, reactions, e.quorum) !== null;

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
      // No real title until lock; show the leading activity (or a placeholder) so it never renders blank.
      title: displayTitle(
        e.title,
        cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })),
        reactions,
      ),
      description: e.description,
      location: e.location,
      phase: e.phase,
      contingent: e.contingent,
      quorum: e.quorum,
      lockTimes: e.lockTimes,
      lockThings: e.lockThings,
      startsAt: e.startsAt.toISOString(),
      decidesBy: e.decidesBy?.toISOString() ?? null,
      msLeftToDecide: msLeft(e.decidesBy),
      // The planned RSVP deadline (set/defaulted at lock); shown while collecting so the creator can
      // see when replies will close. Once the moment opens, momentEndsAt is the live countdown.
      replyBy: e.replyBy?.toISOString() ?? null,
      chosenStartsAt: chosen?.startsAt?.toISOString() ?? null,
      momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
      momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
      msLeft: msLeft(e.momentEndsAt),
      revealed: showCrowd,
      isCreator,
      iOptedOut,
      readyToLock,
      timeCandidates,
      activityCandidates,
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
