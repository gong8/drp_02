import { defaultDecidesByForCandidates, defaultReplyByMs, MOMENT_MS } from "@bethere/shared";
import { TRPCError } from "@trpc/server";

// When the blind moment ends: the creator's "reply by" if set, else the default (one-day-capped from
// the open, to the event). Clamped to leave a real window after the moment starts and to never run
// past the event itself; if the event is already here, fall back to a full short window so there is
// always a moment to answer (and we never reveal before anyone could respond). Pure; shared by
// create's concrete shortcut and openMoment's lock transition.
export function resolveMomentEnd(openMs: number, eventMs: number, replyByMs: number | null): Date {
  if (eventMs <= openMs) return new Date(openMs + MOMENT_MS);
  const wanted = replyByMs ?? defaultReplyByMs(openMs, eventMs);
  const floor = openMs + Math.min(MOMENT_MS, eventMs - openMs);
  return new Date(Math.min(eventMs, Math.max(wanted, floor)));
}

// Derive a new plan's deadlines from its (already-validated) candidate anchors. PURE: no db/ctx, and
// no clock of its own (nowMs is passed in). Mirrors the create() rules verbatim:
// - collecting plans get a "decides by" (custom, validated after-now + a moment of headroom before the
//   earliest time, else the default); concrete plans have none.
// - "reply by" (the blind RSVP close) is validated after the vote-close floor and no later than the
//   earliest time; concrete plans floor it at now.
// - momentEndsAt is set only for the concrete shortcut (the moment opens now); respondByAt falls back
//   to the last time when there is no live moment yet.
// Throws BAD_REQUEST with the same messages create used. momentStartsAt/startsAt stay at the call site
// (they read a fresh clock / the chosen anchor) - this returns deadlines only.
export function resolveCreateDeadlines(
  opensMoment: boolean,
  earliestMs: number,
  lastMs: number,
  hasTimes: boolean,
  decidesByInput: string | undefined,
  replyByInput: string | undefined,
  nowMs: number,
): { decidesBy: Date | null; replyBy: Date | null; momentEndsAt: Date | null; respondByAt: Date } {
  let decidesBy: Date | null = null;
  if (!opensMoment) {
    if (decidesByInput) {
      const t = new Date(decidesByInput);
      const tooLate = hasTimes && t.getTime() > earliestMs - MOMENT_MS;
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

  let replyBy: Date | null = null;
  if (replyByInput) {
    const t = new Date(replyByInput);
    const floorMs = decidesBy ? decidesBy.getTime() : nowMs;
    const tooLate = hasTimes && t.getTime() > earliestMs;
    if (Number.isNaN(t.getTime()) || t.getTime() <= floorMs || tooLate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "reply-by must be after the vote closes and no later than the event",
      });
    }
    replyBy = t;
  }

  const momentEndsAt: Date | null = opensMoment
    ? resolveMomentEnd(nowMs, earliestMs, replyBy?.getTime() ?? null)
    : null;
  const respondByAt = momentEndsAt ?? new Date(lastMs);
  return { decidesBy, replyBy, momentEndsAt, respondByAt };
}
