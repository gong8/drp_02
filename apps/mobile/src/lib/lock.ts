// Mobile-local mirror of the lock helpers from `packages/shared/src/logic/lock.ts`.
//
// Why duplicated rather than imported: `@bethere/shared`'s barrel re-exports with explicit `.js`
// extensions (required because `apps/api` is ESM). tsx/tsc resolve `.js`->`.ts`, but Metro does not,
// so a *value* import of `@bethere/shared` from the mobile app fails to bundle. Mobile only consumes
// shared as *types* everywhere else. Keep these in sync with the shared helpers; the server is the
// source of truth for what is actually applied. See docs/tech-debt.md.

export const MOMENT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * MOMENT_MS;
const HALF_HOUR_MS = 30 * 60 * 1000;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// Floor an instant to the half hour, so a default deadline reads as a time a human picked ("13:00",
// "18:30") instead of leaking the creation instant's minutes ("13:03"). When flooring would land at
// or below `floorMs` (an exclusive lower bound, e.g. "must be after now") the exact instant is kept:
// correctness beats prettiness in the degenerate near-term cases.
function floorToHalfHour(ms: number, floorMs: number): number {
  const floored = ms - (ms % HALF_HOUR_MS);
  return floored > floorMs ? floored : ms;
}

/**
 * Default "decides by" instant for a collecting plan, anchored to its earliest TIME candidate. The
 * notice lead scales as a third of the time-to-earliest (so the active reacting phase gets the
 * larger share) and caps at one day; the result is floored to the half hour when there is room, so
 * the shown deadline reads as a chosen time. Returns an instant strictly in (now, earliest).
 */
export function defaultDecidesByForCandidates(
  earliestMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = earliestMs - nowMs;
  const lead = clamp(Math.round(span / 3), momentMs, DAY_MS);
  const ideal = earliestMs - lead;
  if (ideal > nowMs) return floorToHalfHour(ideal, nowMs);
  // Degenerate near-term plan: not enough room for the lead. Fall back to the midpoint, pulled no
  // later than earliest - moment so the blind moment still fits before the event.
  const latest = earliestMs - momentMs;
  const midpoint = nowMs + span / 2;
  return floorToHalfHour(Math.round(latest > nowMs ? Math.min(midpoint, latest) : midpoint), nowMs);
}

/**
 * Default "reply by" instant: a sensible lead BEFORE the event - the same shape (and half-hour
 * flooring) as the "decides by" default (lead = a third of the run-up, floored at a moment, capped
 * at a day), so the two deadlines feel like one system. A degenerate already-here event still gets
 * a minimal (unrounded) window. Always returns an instant strictly in (openMs, eventMs) for a
 * future event.
 */
export function defaultReplyByMs(openMs: number, eventMs: number): number {
  if (eventMs <= openMs) return openMs + MOMENT_MS;
  return defaultDecidesByForCandidates(eventMs, openMs);
}

/**
 * Upper bound (epoch ms) for a member-added TIME candidate. Allows a small slack past the creator's
 * spread - the spread length, capped at two days - so a member can suggest a slightly later time
 * without an absurd jump. (The old fuzzy/window branch is gone: the wizard sends concrete times.)
 */
export function addCandidateHorizon(earliestMs: number, latestMs: number): number {
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}
