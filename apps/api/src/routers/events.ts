import { randomUUID } from "node:crypto";
import {
  AddCandidateInput,
  addCandidateHorizon,
  ByEvent,
  ByGroupInput,
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
  RespondInput,
  resolveIn,
  revealGoing,
  SetOptOutInput,
  ToggleReactionInput,
  UpdateEventInput,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { FALLBACK_GROUP_NAME, getGroupNames } from "../db/groups.js";
import {
  candidateReactions,
  eventCandidates,
  eventOptOuts,
  events,
  groupMembers,
  responses,
} from "../db/schema.js";
import type { UserCard } from "../db/users.js";
import { FALLBACK_AVATAR_COLOR, FALLBACK_USER_NAME, getUserCards } from "../db/users.js";
import { msLeft } from "../format.js";
import { shapePastMeetups } from "../logic/past-meetups.js";
import { displayActivity, planOpensMoment, resolveActivity } from "../logic/plan-activity.js";
import { protectedProcedure, router } from "../trpc.js";

type EventRow = typeof events.$inferSelect;
type MyStatus = "reacting" | "awaiting" | "going" | "declined";

const DEFAULT_QUORUM = 2;
// With no time candidates a plan still collects (on activities); anchor its placeholder start and
// default decides-by this far out so the deadline is sane without a concrete time to hang it on.
const DEFAULT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

// Row->domain mappers shared by the per-event and bulk (loadEventBundle) readers so the two paths
// cannot drift. Pure; keep them the single source of truth for these shapes.
const toMomentResponse = (r: typeof responses.$inferSelect): MomentResponse => ({
  userId: r.userId,
  kind: r.kind,
  cond: r.cond ?? undefined,
});
const toReaction = (r: typeof candidateReactions.$inferSelect) => ({
  candidateId: r.candidateId,
  userId: r.userId,
});

async function responsesFor(eventId: string): Promise<MomentResponse[]> {
  const rows = await db.select().from(responses).where(eq(responses.eventId, eventId));
  return rows.map(toMomentResponse);
}

async function reactionsFor(eventId: string): Promise<{ candidateId: string; userId: string }[]> {
  const rows = await db
    .select()
    .from(candidateReactions)
    .where(eq(candidateReactions.eventId, eventId));
  return rows.map(toReaction);
}

// Candidate display order: startsAt ascending, nulls (activities) last.
const byStartsAtThenNullsLast = (a: { startsAt: Date | null }, b: { startsAt: Date | null }) =>
  (a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) -
  (b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY);

async function candidatesFor(eventId: string): Promise<(typeof eventCandidates.$inferSelect)[]> {
  const rows = await db.select().from(eventCandidates).where(eq(eventCandidates.eventId, eventId));
  return rows.sort(byStartsAtThenNullsLast);
}

// A usable time candidate: a time-kind row with a concrete startsAt. Narrows startsAt to non-null
// at the value level, so the `as Date` casts on the filtered rows downstream stay valid.
const isTimeCand = (c: typeof eventCandidates.$inferSelect) =>
  c.kind === "time" && c.startsAt != null;

// The creator lock-readiness rule: a winning time candidate exists at the given quorum.
function isReadyToLock(
  timeIds: string[],
  reactions: { candidateId: string; userId: string }[],
  quorum: number,
): boolean {
  return pickWinningCandidate(timeIds, reactions, quorum) !== null;
}

// Projects mixed candidate rows into the {id,label} shape resolveActivity/displayActivity expect.
function activityCandidateInputs(cands: (typeof eventCandidates.$inferSelect)[]) {
  return cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label }));
}

// Maps an EventRow into revealGoing's opts; see revealGoing for the blind-until-end rule.
function goingFromRow(e: EventRow, resp: MomentResponse[]): string[] | null {
  return revealGoing(resp, {
    momentEndsAtMs: e.momentEndsAt ? e.momentEndsAt.getTime() : Number.POSITIVE_INFINITY,
    terminal: e.phase === "cleared" || e.phase === "fizzled",
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
async function ensureReaction(eventId: string, candidateId: string, userId: string): Promise<void> {
  await db
    .insert(candidateReactions)
    .values({ eventId, candidateId, userId })
    .onConflictDoNothing();
}

// The pooled db or a transaction handle from db.transaction's callback - both expose the
// delete/where surface clearOptOut needs (the tx omits db's $client, so it is not `typeof db`).
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Drop the caller's opt-out row (a +1 / explicit RSVP rejoins them - mutual exclusion with "I can't
// make it"). Idempotent; pass a tx handle to enlist in a wrapping transaction.
async function clearOptOut(eventId: string, userId: string, handle: DbOrTx = db): Promise<void> {
  await handle
    .delete(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, eventId), eq(eventOptOuts.userId, userId)));
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

// The shared "open the blind moment" transition out of collecting, used by both auto-lock
// (settleCollecting) and manual lock. Resolves the winning activity into the plan's name if empty,
// then runs the guarded compare-and-set main UPDATE: it is conditioned on the row STILL being a
// collecting plan with no chosen time, so a concurrent lock/auto-lock cannot be clobbered (its moment
// window reset). .returning() tells us whether THIS call did the transition; on a lost race it reloads
// the winner's state onto the in-memory row and returns false, so each caller serves the winner's slot.
// On a won transition it fills the derived activity (guarded), mirrors the moment fields onto e, and
// returns true. Mutates + persists; each call site keeps only its own preconditions.
async function openMoment(
  e: EventRow,
  chosen: { startsAt: Date | null },
  chosenId: string,
  cands: (typeof eventCandidates.$inferSelect)[],
  reactions: { candidateId: string; userId: string }[],
): Promise<boolean> {
  const startsAt = chosen.startsAt as Date;
  const activity = resolveActivity(e.activity, activityCandidateInputs(cands), reactions);
  const now = new Date();
  const endsAt = resolveMomentEnd(now.getTime(), startsAt.getTime(), e.replyBy?.getTime() ?? null);
  const locked = await db
    .update(events)
    .set({
      phase: "moment",
      chosenCandidateId: chosenId,
      momentStartsAt: now,
      momentEndsAt: endsAt,
      startsAt,
      respondByAt: endsAt,
    })
    .where(
      and(eq(events.id, e.id), eq(events.phase, "collecting"), isNull(events.chosenCandidateId)),
    )
    .returning();
  if (locked.length === 0) {
    const [fresh] = await db.select().from(events).where(eq(events.id, e.id));
    if (fresh) Object.assign(e, fresh);
    return false;
  }
  // Fill the derived activity only if the row still has none. A member may have edited the activity
  // concurrently (events.update); guarding the write on activity still being "" means an auto-lock can
  // never clobber an explicit activity. resolveActivity already returns e.activity unchanged when
  // non-empty, so this writes the activity-derived name solely for the never-named case.
  if (activity) {
    await db
      .update(events)
      .set({ activity })
      .where(and(eq(events.id, e.id), eq(events.activity, "")));
  }
  e.phase = "moment";
  e.activity = activity;
  e.chosenCandidateId = chosenId;
  e.momentStartsAt = now;
  e.momentEndsAt = endsAt;
  e.startsAt = startsAt;
  return true;
}

// Lazily auto-lock a collecting plan whose "Decides by" deadline has passed (no scheduler): pick the
// best-supported TIME candidate (quorum, else most-reacted), resolve the winning activity into the
// plan's name if empty, and open the blind moment. Opted-out members have no reactions so they drop for
// free; with no time candidates, or no reactions of any kind, the plan fizzles silently (any +1 -
// even on an activity - keeps it alive, and it locks the best-supported or first time). Mutates + persists.
async function settleCollecting(e: EventRow): Promise<void> {
  if (e.phase !== "collecting" || !e.decidesBy || Date.now() < e.decidesBy.getTime()) return;
  const cands = await candidatesFor(e.id);
  const timeCands = cands.filter(isTimeCand);
  const reactions = await reactionsFor(e.id);
  if (timeCands.length === 0 || reactions.length === 0) {
    await fizzle(e);
    return;
  }
  const timeIds = timeCands.map((c) => c.id);
  const chosenId = pickWinnerOrBestId(timeIds, reactions, e.quorum);
  const chosen = timeCands.find((c) => c.id === chosenId) as (typeof timeCands)[number];
  await openMoment(e, chosen, chosenId, cands, reactions);
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
async function loadEvent(eventId: string, userId: string): Promise<EventRow> {
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

// Settle first (loadEvent never settles): a plan past its deadline has already
// auto-locked/cleared/fizzled, so a late write must gate on the SETTLED phase.
async function settleAndRequirePhase(
  e: EventRow,
  phase: EventRow["phase"],
  message: string,
): Promise<void> {
  await settleLifecycle(e);
  if (e.phase !== phase) throw new TRPCError({ code: "BAD_REQUEST", message });
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

// The caller-scoped derivation shared by mine (dashboard) and get (detail): from a SETTLED row and
// its already-loaded bundle, derive the caller's responses view, the going reveal, the anonymous
// creator self-check, the opt-out flag, and the resulting status. Settle and the batched reads live
// outside (mine settles + bundles all rows at once; get does the single row), so this is pure
// in-memory derivation off the bundle - no extra queries.
function derivePlanView(
  e: EventRow,
  userId: string,
  bundle: Awaited<ReturnType<typeof loadEventBundle>>,
): {
  resp: MomentResponse[];
  revealed: string[] | null;
  isCreator: boolean;
  iOptedOut: boolean;
  myStatus: MyStatus;
} {
  const resp = bundle.responses(e.id);
  const revealed = goingFromRow(e, resp);
  // A private self-check: returned as a boolean only, never the id - the creator stays anonymous.
  const isCreator = e.createdByUserId === userId;
  const iOptedOut = bundle.optOuts(e.id).has(userId);
  const myStatus = computeMyStatus(e.phase, userId, resp, revealed, iOptedOut);
  return { resp, revealed, isCreator, iOptedOut, myStatus };
}

// A read-only bulk loader: for a set of SETTLED event rows, issue ONE inArray query each for
// responses, candidates, reactions, and opt-outs (instead of per-event SELECTs), then resolve group
// names and user cards in one batched query each. This collapses mine/get's N+1 per-plan read chain
// to a fixed handful of round-trips. It is strictly post-settle - settleLifecycle must run on each
// row first (it writes the events row), then this reads the settled rows so derived phase/going stay
// correct. Anonymity is unaffected: it only groups rows in memory; callers still surface counts and
// the caller's own booleans, never voter ids. `extraUserIds` lets a caller (get) pull additional
// cards (e.g. group members) into the same batched user query.
async function loadEventBundle(
  rows: EventRow[],
  extraUserIds: string[] = [],
): Promise<{
  responses: (id: string) => MomentResponse[];
  candidates: (id: string) => (typeof eventCandidates.$inferSelect)[];
  reactions: (id: string) => { candidateId: string; userId: string }[];
  optOuts: (id: string) => Set<string>;
  groupName: (id: string) => string;
  userCard: (id: string) => UserCard;
  hasUser: (id: string) => boolean;
}> {
  const ids = rows.map((e) => e.id);

  const [respRows, candRows, reactRows, optRows] =
    ids.length === 0
      ? ([[], [], [], []] as [
          (typeof responses.$inferSelect)[],
          (typeof eventCandidates.$inferSelect)[],
          (typeof candidateReactions.$inferSelect)[],
          (typeof eventOptOuts.$inferSelect)[],
        ])
      : await Promise.all([
          db.select().from(responses).where(inArray(responses.eventId, ids)),
          db.select().from(eventCandidates).where(inArray(eventCandidates.eventId, ids)),
          db.select().from(candidateReactions).where(inArray(candidateReactions.eventId, ids)),
          db.select().from(eventOptOuts).where(inArray(eventOptOuts.eventId, ids)),
        ]);

  const respMap = new Map<string, MomentResponse[]>();
  for (const r of respRows) {
    const list = respMap.get(r.eventId) ?? [];
    list.push(toMomentResponse(r));
    respMap.set(r.eventId, list);
  }
  const candMap = new Map<string, (typeof eventCandidates.$inferSelect)[]>();
  for (const c of candRows) {
    const list = candMap.get(c.eventId) ?? [];
    list.push(c);
    candMap.set(c.eventId, list);
  }
  // Candidate display order shared with candidatesFor: startsAt asc, nulls (activities) last.
  for (const list of candMap.values()) {
    list.sort(byStartsAtThenNullsLast);
  }
  const reactMap = new Map<string, { candidateId: string; userId: string }[]>();
  for (const r of reactRows) {
    const list = reactMap.get(r.eventId) ?? [];
    list.push(toReaction(r));
    reactMap.set(r.eventId, list);
  }
  const optMap = new Map<string, Set<string>>();
  for (const o of optRows) {
    const set = optMap.get(o.eventId) ?? new Set<string>();
    set.add(o.userId);
    optMap.set(o.eventId, set);
  }

  const groupNameMap = await getGroupNames([...new Set(rows.map((e) => e.groupId))]);

  // The uids any card may render: each row's revealed crowd (going preview / full going list) plus
  // any extra ids the caller needs (get's members). Resolve them all in one batched users query.
  const uidUnion = new Set<string>(extraUserIds);
  for (const e of rows) {
    const revealed = goingFromRow(e, respMap.get(e.id) ?? []);
    if (revealed) for (const uid of revealed) uidUnion.add(uid);
  }
  const userCardMap = await getUserCards([...uidUnion]);

  return {
    responses: (id) => respMap.get(id) ?? [],
    candidates: (id) => candMap.get(id) ?? [],
    reactions: (id) => reactMap.get(id) ?? [],
    optOuts: (id) => optMap.get(id) ?? new Set(),
    groupName: (id) => groupNameMap.get(id) ?? FALLBACK_GROUP_NAME,
    userCard: (id) =>
      userCardMap.get(id) ?? { id, name: FALLBACK_USER_NAME, color: FALLBACK_AVATAR_COLOR },
    hasUser: (id) => userCardMap.has(id),
  };
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

    const nowMs = Date.now();
    const sortedTimeInputs = timeInputs
      .map((t, i) => ({
        id: `${id}_t${i + 1}`,
        kind: "time" as const,
        startsAt: new Date(t.startsAt),
        partOfDay: t.partOfDay ?? null,
        label: null,
      }))
      // Drop genuinely invalid date strings, but a valid time in the past is a hard error: it would
      // give a collecting plan an already-expired default decides-by (an immediate silent self-fizzle).
      // Mirrors addCandidate's future check + the explicit decides-by guard.
      .filter((c) => !Number.isNaN(c.startsAt.getTime()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (sortedTimeInputs.some((c) => c.startsAt.getTime() <= nowMs)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "a time candidate must be in the future",
      });
    }
    // Collapse candidates that land in the same minute (the wizard's granularity), keeping the
    // earliest. A single intended slot sent twice must stay one row - otherwise it splits +1
    // momentum and defeats the concrete-moment shortcut (planOpensMoment needs exactly one time).
    // This mirrors addCandidate's minute dedupe so create and add agree.
    const seenMinutes = new Set<number>();
    const timeCands = sortedTimeInputs.filter((c) => {
      const minute = Math.floor(c.startsAt.getTime() / 60_000);
      if (seenMinutes.has(minute)) return false;
      seenMinutes.add(minute);
      return true;
    });

    // Trim each label, drop any empty-after-trim (no whitespace-only plan names), and dedupe
    // case-insensitively keeping the first occurrence - mirroring addCandidate's key. Two labels that
    // collapse to one row keep the both-axes-pinned moment shortcut intact for duplicate activities.
    const seenActivityKeys = new Set<string>();
    const activityCands = activityInputs
      .map((text) => text.trim())
      .filter((text) => {
        if (text === "") return false;
        const key = text.toLowerCase();
        if (seenActivityKeys.has(key)) return false;
        seenActivityKeys.add(key);
        return true;
      })
      .map((text, i) => ({
        id: `${id}_a${i + 1}`,
        kind: "activity" as const,
        startsAt: null,
        partOfDay: null,
        label: text,
      }));

    // You can only lock an axis that has at least one candidate - locking nothing would just leave a
    // plan that can never converge (a locked, empty time axis can never get a time and silently fizzles).
    if (input.lockTimes && timeCands.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "cannot lock the times with no time" });
    }
    if (input.lockActivity && activityCands.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "cannot lock the activity with no activity",
      });
    }

    const opensMoment = planOpensMoment(
      timeCands.length,
      input.lockTimes,
      activityCands.length,
      input.lockActivity,
    );
    const quorum = input.quorum ?? (opensMoment ? 1 : DEFAULT_QUORUM);

    // Concrete plans skip lock()/settleCollecting (where the collecting path resolves the activity),
    // so resolve the single activity into the stored name now; collecting plans resolve it at lock.
    const resolvedActivity = opensMoment
      ? resolveActivity(
          "",
          activityCands.map((c) => ({ id: c.id, label: c.label })),
          [],
        )
      : "";

    // Time anchors. With no time candidates a plan still collects (on activities), so anchor the
    // placeholder start + the default decides-by to a sensible horizon instead of a candidate.
    const earliestMs =
      timeCands.length > 0 ? timeCands[0].startsAt.getTime() : nowMs + DEFAULT_HORIZON_MS;
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
        if (Number.isNaN(t.getTime()) || t.getTime() <= nowMs || tooLate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "decides-by must be after now and leave room before the plan's window",
          });
        }
        decidesBy = t;
      } else {
        decidesBy = new Date(defaultDecidesByForCandidates(earliestMs, nowMs));
      }
    }

    // Reply-by: when the blind RSVP window closes (then it reveals + resolves). Editable; defaulted at
    // lock when unset. Must sit after the vote closes (or now, for a concrete plan) and no later than
    // the earliest event time. Loose plans (no times yet) have no editor; it defaults at lock.
    let replyBy: Date | null = null;
    if (input.replyBy) {
      const t = new Date(input.replyBy);
      const floorMs = decidesBy ? decidesBy.getTime() : nowMs;
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
      ? resolveMomentEnd(nowMs, earliestMs, replyBy?.getTime() ?? null)
      : null;
    const respondByAt = momentEndsAt ?? new Date(lastMs);

    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      activity: resolvedActivity,
      description: input.description ?? null,
      location: input.location ?? "",
      startsAt,
      respondByAt,
      status: "open",
      contingent: !opensMoment,
      quorum,
      isAnonymous: true,
      lockTimes: input.lockTimes,
      lockActivity: input.lockActivity,
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
    await settleAndRequirePhase(e, "collecting", "plan is not collecting reactions");
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
    // The +1 and the opt-out clear are one unit (a +1 rejoins anyone who had opted out - mutual
    // exclusion with "I can't make it"), so wrap both in a transaction. onConflictDoNothing makes a
    // concurrent/double +1 a clean no-op (the (candidateId,userId) PK) instead of a 500.
    await db.transaction(async (tx) => {
      await tx
        .insert(candidateReactions)
        .values({ eventId: input.eventId, candidateId: input.candidateId, userId: ctx.userId })
        .onConflictDoNothing();
      await clearOptOut(input.eventId, ctx.userId, tx);
    });
    return { reacted: true as const };
  }),

  // A member bows out of a collecting plan ("I can't make it") or rejoins. Opting out clears their
  // reactions (dropping them from the tally/quorum) and excludes them from the moment + reminders.
  // Private: no one else, not even the creator, sees it. Reversible via out:false or by reacting.
  setOptOut: protectedProcedure.input(SetOptOutInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await settleAndRequirePhase(e, "collecting", "plan is not collecting");
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
      await clearOptOut(input.eventId, ctx.userId);
    }
    return { ok: true as const };
  }),

  // Any member adds a candidate while collecting - a new time, or a new activity - and the crowd
  // gains another row to +1. Kind-gated by the creator's locks: a locked axis rejects new candidates.
  // Time candidates dedupe by minute; activity candidates dedupe case-insensitively. Adding +1s it.
  addCandidate: protectedProcedure.input(AddCandidateInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await settleAndRequirePhase(e, "collecting", "plan is not collecting");
    if (input.kind === "time" && e.lockTimes) {
      throw new TRPCError({ code: "FORBIDDEN", message: "times are locked on this plan" });
    }
    if (input.kind === "activity" && e.lockActivity) {
      throw new TRPCError({ code: "FORBIDDEN", message: "activities are locked on this plan" });
    }
    const cands = await candidatesFor(input.eventId);

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
      const times = cands.filter(isTimeCand).map((c) => (c.startsAt as Date).getTime());
      if (times.length > 0) {
        const horizon = addCandidateHorizon(Math.min(...times), Math.max(...times));
        if (startsAt.getTime() > horizon) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "that time is past this plan's window",
          });
        }
      }
      // Dedupe by minute (the comment above and the wizard's granularity): a candidate at HH:MM:00
      // and a new add at HH:MM:30 are the same slot, so the add +1s the existing row.
      const startMinute = Math.floor(startsAt.getTime() / 60_000);
      const dup = cands.find(
        (c) =>
          c.kind === "time" &&
          c.startsAt != null &&
          Math.floor(c.startsAt.getTime() / 60_000) === startMinute,
      );
      if (dup) {
        await ensureReaction(input.eventId, dup.id, ctx.userId);
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
      if (!text) throw new TRPCError({ code: "BAD_REQUEST", message: "an activity needs a name" });
      const key = text.toLowerCase();
      const dup = cands.find(
        (c) => c.kind === "activity" && (c.label ?? "").trim().toLowerCase() === key,
      );
      if (dup) {
        await ensureReaction(input.eventId, dup.id, ctx.userId);
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
    await ensureReaction(input.eventId, newId, ctx.userId);
    return { id: newId };
  }),

  // The creator locks the winning TIME, opening the blind moment. The creator is anonymous to others
  // but we still authorize via the stored createdByUserId (a self-check, never surfaced). With no
  // candidateId we pick the best-supported time (most public +1s). If the plan has no activity yet,
  // the winning ACTIVITY becomes the plan's name at lock.
  lock: protectedProcedure.input(LockInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.createdByUserId !== ctx.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "only the creator can lock the moment" });
    }
    await settleAndRequirePhase(e, "collecting", "plan is not collecting");
    const cands = await candidatesFor(input.eventId);
    const timeCands = cands.filter(isTimeCand);
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

    // The shared transition: on a lost race openMoment reloads the winner onto e, so e.chosenCandidateId
    // serves the winner's slot; on a won transition it equals chosenId. Either way mirror it out.
    await openMoment(e, chosen, chosenId, cands, reactions);
    return { ok: true as const, chosenCandidateId: e.chosenCandidateId ?? chosenId };
  }),

  // Any member edits a plan's text metadata - activity, location, notes - while it is not yet
  // cleared/fizzled. Anonymous, like every other write (no creator check, no attribution). Each field
  // is an optimistic compare-and-set: the client sends the value it loaded (`from`) and the new value
  // (`to`); we apply `to` only if the row's current value still equals `from`, else we report the
  // field in `conflicts` carrying the now-current value and leave it untouched. A SELECT ... FOR UPDATE
  // serializes concurrent updates, so same-field edits never clobber (first wins, second conflicts)
  // and different-field edits both apply. An empty activity reverts to auto-derive (stored ""); an
  // empty location stays "" (the column is notNull); empty notes clear to null.
  update: protectedProcedure.input(UpdateEventInput).mutation(async ({ ctx, input }) => {
    return db.transaction(async (tx) => {
      const [e] = await tx.select().from(events).where(eq(events.id, input.eventId)).for("update");
      if (!e) throw new TRPCError({ code: "NOT_FOUND" });
      await requireMember(e.groupId, ctx.userId);
      if (e.phase === "cleared" || e.phase === "fizzled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "this plan is final" });
      }
      // While collecting, the activity is whatever ACTIVITY candidate wins the vote - it is not a
      // free-text field yet, so reject an edit until the plan locks.
      if (input.activity && e.phase === "collecting") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "the activity is decided by the vote while collecting",
        });
      }

      const set: Partial<typeof events.$inferInsert> = {};
      const conflicts: { field: string; current: string }[] = [];
      // activity/location are non-null strings; description is nullable, so treat its current as "".
      if (input.activity) {
        if (e.activity === input.activity.from) set.activity = input.activity.to;
        else conflicts.push({ field: "activity", current: e.activity });
      }
      if (input.location) {
        if (e.location === input.location.from) set.location = input.location.to;
        else conflicts.push({ field: "location", current: e.location });
      }
      if (input.description) {
        const current = e.description ?? "";
        if (current === input.description.from) {
          set.description = input.description.to === "" ? null : input.description.to;
        } else conflicts.push({ field: "description", current });
      }

      const applied = Object.keys(set);
      if (applied.length > 0) {
        await tx.update(events).set(set).where(eq(events.id, input.eventId));
      }
      return { applied, conflicts };
    });
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
    // Settle each row first (it writes the events row and is phase-ordered), drop the silent fizzles,
    // then bulk-load the surviving rows' read data in a fixed handful of batched queries.
    for (const e of rows) await settleLifecycle(e);
    const live = rows.filter((e) => e.phase !== "fizzled"); // silent: a fizzle leaves no trace
    const bundle = await loadEventBundle(live);

    return live.map((e) => {
      const { resp, revealed, isCreator, myStatus } = derivePlanView(e, ctx.userId, bundle);
      // Going preview: the first 4 revealed cards (count is the full revealed length, or null blind).
      const goingCount = revealed ? revealed.length : null;
      const preview = (revealed ?? []).slice(0, 4).map((uid) => {
        const card = bundle.userCard(uid);
        // Match goingPreview's old fallback: a missing users row shows "?" (not the name sentinel).
        const initial = (bundle.hasUser(uid) ? card.name : "?").charAt(0).toUpperCase();
        return { uid, color: card.color, initial };
      });

      let iReacted = false;
      let candidateCount = 0;
      let readyToLock = false;
      // Collecting plans have no real activity yet (it is fixed at lock); show the leading activity
      // candidate (or blank, the client falls back) so a card stays meaningful. Locked plans already
      // carry a real activity name.
      let activity = e.activity;
      if (e.phase === "collecting") {
        const cands = bundle.candidates(e.id);
        candidateCount = cands.length;
        const reactions = bundle.reactions(e.id);
        iReacted = reactions.some((r) => r.userId === ctx.userId);
        activity = displayActivity(e.activity, activityCandidateInputs(cands), reactions);
        if (isCreator) {
          const timeIds = cands.filter(isTimeCand).map((c) => c.id);
          readyToLock = isReadyToLock(timeIds, reactions, e.quorum);
        }
      }

      return {
        id: e.id,
        groupName: bundle.groupName(e.groupId),
        activity,
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
    });
  }),

  // The redo picker: a group's past (cleared) meetups, each reduced to a clonable shell - the won
  // activity (the plan's name), lock-times flag, location, notes - so the wizard can pre-fill a fresh
  // plan from one (the activity preloaded + locked; the creator just picks a new time). The name is the
  // `events.activity` scalar, so it is carried directly (not re-derived from candidate rows). Carries
  // no time (always stale) and no RSVP data; the creator stays anonymous (no creator identity).
  pastForGroup: protectedProcedure.input(ByGroupInput).query(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.groupId, input.groupId), eq(events.phase, "cleared")));
    return shapePastMeetups(
      rows.map((e) => ({
        id: e.id,
        activity: e.activity,
        location: e.location,
        description: e.description,
        startsAt: e.startsAt,
        lockTimes: e.lockTimes,
      })),
    );
  }),

  // One plan in full, phase-aware: time + activity candidates with public +1 counts (collecting),
  // the blind countdown (moment), and the revealed IN crowd (cleared).
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleLifecycle(e);

    // Members are a membership query (not in the bundle); read them first so their uids join the
    // bundle's batched user-card query alongside the revealed crowd.
    const memberRows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, e.groupId));
    const bundle = await loadEventBundle(
      [e],
      memberRows.map((m) => m.userId),
    );

    const { resp, revealed, isCreator, iOptedOut, myStatus } = derivePlanView(
      e,
      ctx.userId,
      bundle,
    );

    const cands = bundle.candidates(e.id);
    const reactions = bundle.reactions(e.id);
    // Public per-candidate +1 counts (momentum) for BOTH kinds; who reacted is never returned, only
    // the count and whether the caller themselves reacted.
    const countBy = new Map<string, number>();
    const myReactedIds = new Set<string>();
    for (const r of reactions) {
      countBy.set(r.candidateId, (countBy.get(r.candidateId) ?? 0) + 1);
      if (r.userId === ctx.userId) myReactedIds.add(r.candidateId);
    }
    const timeCandidates = cands.filter(isTimeCand).map((c) => ({
      id: c.id,
      startsAt: (c.startsAt as Date).toISOString(),
      partOfDay: c.partOfDay,
      count: countBy.get(c.id) ?? 0,
      mine: myReactedIds.has(c.id),
    }));
    const activityCandidates = cands
      .filter((c) => c.kind === "activity")
      .map((c) => ({
        id: c.id,
        text: c.label ?? "",
        count: countBy.get(c.id) ?? 0,
        mine: myReactedIds.has(c.id),
      }))
      .sort((a, b) => b.count - a.count);

    const timeIds = timeCandidates.map((c) => c.id);
    const readyToLock =
      isCreator && e.phase === "collecting" && isReadyToLock(timeIds, reactions, e.quorum);

    const members: { id: string; name: string }[] = [];
    for (const row of memberRows) {
      if (row.userId === ctx.userId) continue;
      members.push({ id: row.userId, name: bundle.userCard(row.userId).name });
    }

    const showCrowd = revealed !== null && e.phase !== "fizzled";
    const going = showCrowd ? revealed.map((id) => bundle.userCard(id)) : [];
    const myResponse = resp.find((r) => r.userId === ctx.userId);
    const chosen = cands.find((c) => c.id === e.chosenCandidateId) ?? null;

    return {
      id: e.id,
      groupName: bundle.groupName(e.groupId),
      // No real activity until lock; show the leading activity candidate (or blank, the client falls
      // back) so it stays meaningful while collecting.
      activity: displayActivity(e.activity, activityCandidateInputs(cands), reactions),
      // The RAW stored activity (often "" while collecting); the edit sheet needs it so an empty
      // activity keeps auto-deriving rather than locking in the derived value.
      activityRaw: e.activity,
      description: e.description,
      location: e.location,
      phase: e.phase,
      contingent: e.contingent,
      quorum: e.quorum,
      lockTimes: e.lockTimes,
      lockActivity: e.lockActivity,
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
      myResponse: myResponse ? { kind: myResponse.kind, cond: myResponse.cond ?? null } : null,
      myStatus,
      members,
      going,
    };
  }),

  // Record (or replace) this user's commitment during the moment.
  respond: protectedProcedure.input(RespondInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await settleAndRequirePhase(e, "moment", "the moment is not open");
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
    await clearOptOut(input.eventId, ctx.userId);
    return { recorded: true as const };
  }),

  // Clear the caller's moment answer (the "Change" action): they return to un-answered, so the plan
  // goes back to Action Required until they answer again.
  unrespond: protectedProcedure.input(ByEvent).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await settleAndRequirePhase(e, "moment", "the moment is not open");
    await db
      .delete(responses)
      .where(and(eq(responses.eventId, input.eventId), eq(responses.userId, ctx.userId)));
    return { ok: true as const };
  }),

  // Settle the moment once its countdown has ended: cleared (quorum met or non-contingent) or a
  // silent fizzle. Idempotent and safe to call early (it no-ops until the deadline passes).
  resolve: protectedProcedure.input(ByEvent).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await settleLifecycle(e);
    return { ok: true as const, phase: e.phase };
  }),
});
