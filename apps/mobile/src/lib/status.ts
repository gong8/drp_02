// The single source of truth for plan categorisation on the client. The dashboard tabs, the detail
// header, and the notification scheduler all derive their behaviour from here so the phase/status
// rules can never drift between screens.
//
// IMPORTANT: do NOT bucket off raw `myStatus`. The server returns `awaiting` for a cleared/past plan
// the caller simply ignored (computeBaseStatus in apps/api/src/routers/events.ts), so a finished
// meetup would otherwise sit in "Awaiting" forever - the reported bug. The bucket predicates below
// guard on phase + is-past so that value is harmless on the client.

import { DEADLINE_RSVP, DEADLINE_VOTING } from "./copy";

export type Phase = "collecting" | "moment" | "cleared" | "fizzled";
export type MyStatus = "reacting" | "awaiting" | "going" | "declined";
export type Bucket = "going" | "open" | "done";

// The minimal shapes both events.mine (dashboard) and events.get (detail) rows satisfy.
type Phased = { phase: Phase };
type Timed = Phased & { startsAt: string; decidesBy: string | null; momentEndsAt: string | null };
export type Bucketable = Timed & { myStatus: MyStatus };
type Actionable = Phased & { myStatus: MyStatus; iReacted: boolean; iResponded: boolean };

// A plan is terminal once it has cleared or fizzled; otherwise it is still live.
export function isTerminal(e: Phased): boolean {
  return e.phase === "cleared" || e.phase === "fizzled";
}
export function isLive(e: Phased): boolean {
  return !isTerminal(e);
}

// `startsAt` is only a real time once a slot is locked. A cleared plan is past once its time passes.
// A moment is past only once its RSVP window (momentEndsAt) has closed - the window can legitimately
// run up to/just past the event time, and the server settles a moment to cleared/fizzled at
// momentEndsAt, so a still-live moment must never count as past (else a committed member would drop
// out of Going mid-event). While collecting, startsAt is a placeholder, so it is never past.
export function isPast(e: Timed, now: number = Date.now()): boolean {
  if (e.phase === "cleared") return new Date(e.startsAt).getTime() < now;
  if (e.phase === "moment")
    return e.momentEndsAt != null && new Date(e.momentEndsAt).getTime() < now;
  return false;
}

// GOING / OPEN / DONE - mutually exclusive and total. Returns the first match in order.
//   GOING: you're in and it hasn't happened.
//   OPEN:  still being decided, you've not declined and aren't already in, and it isn't past.
//   DONE:  cleared, fizzled, declined, or past (this is where the server's stale "awaiting" lands).
export function planBucket(e: Bucketable, now: number = Date.now()): Bucket {
  if (e.myStatus === "going" && !isPast(e, now) && e.phase !== "fizzled") return "going";
  if (
    (e.phase === "collecting" || e.phase === "moment") &&
    e.myStatus !== "declined" &&
    e.myStatus !== "going" &&
    !isPast(e, now)
  )
    return "open";
  return "done";
}

// The orthogonal overlay that drives the "ACTION REQUIRED" panel: a live plan still wanting YOUR
// input - an unanswered moment, or a collecting plan you have not voted in and have not opted out of.
export function isActionRequired(e: Actionable): boolean {
  return (
    (e.phase === "moment" && !e.iResponded) ||
    (e.phase === "collecting" && !e.iReacted && e.myStatus !== "declined")
  );
}

// The relevant deadline for the current phase, with its label - one mapping consumed by both the
// dashboard action cards and the detail countdown banner so the field choice and wording stay locked.
export function activeDeadline(e: Timed): { iso: string | null; label: string } {
  if (e.phase === "moment") return { iso: e.momentEndsAt, label: DEADLINE_RSVP };
  if (e.phase === "collecting") return { iso: e.decidesBy, label: DEADLINE_VOTING };
  return { iso: null, label: "" };
}

// The sort key: a collecting plan sorts by when it resolves (decidesBy); a locked plan by its time.
function sortTimeMs(e: Timed): number {
  if (e.phase === "collecting") {
    return new Date(e.decidesBy ?? e.startsAt).getTime();
  }
  return new Date(e.startsAt).getTime();
}

// List order: upcoming first (soonest -> latest), then past most-recent-first - so a tab doubles as
// history with the live items on top.
export function compareForDisplay(a: Timed, b: Timed, now: number = Date.now()): number {
  const ap = isPast(a, now);
  const bp = isPast(b, now);
  if (ap !== bp) return ap ? 1 : -1;
  const am = sortTimeMs(a);
  const bm = sortTimeMs(b);
  return ap ? bm - am : am - bm;
}

// "All" tab order: your agenda first, history below. Going + Open interleave purely by time so the
// top of the list is the true running order of what's coming up; everything DONE sinks beneath it.
// We key on the bucket, not isPast, because a done plan is not always past - a declined-but-upcoming
// or fizzled plan is still future-dated and would otherwise float up among live commitments. Within
// each section the normal display order applies.
export function compareForDisplayAll(
  a: Bucketable,
  b: Bucketable,
  now: number = Date.now(),
): number {
  const ad = planBucket(a, now) === "done";
  const bd = planBucket(b, now) === "done";
  if (ad !== bd) return ad ? 1 : -1;
  return compareForDisplay(a, b, now);
}

// Action-panel order: ticking moments lead (soonest close first), then collecting plans by deadline.
export function compareActions(
  a: Timed & { momentEndsAt: string | null },
  b: Timed & { momentEndsAt: string | null },
): number {
  const aMoment = a.phase === "moment";
  const bMoment = b.phase === "moment";
  if (aMoment !== bMoment) return aMoment ? -1 : 1;
  const am = new Date((aMoment ? a.momentEndsAt : a.decidesBy) ?? a.startsAt).getTime();
  const bm = new Date((bMoment ? b.momentEndsAt : b.decidesBy) ?? b.startsAt).getTime();
  return am - bm;
}
