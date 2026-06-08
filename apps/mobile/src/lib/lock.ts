// Mobile-local mirror of the lock helpers from `packages/shared/src/logic/lock.ts`.
//
// Why duplicated rather than imported: `@bethere/shared`'s barrel re-exports with explicit `.js`
// extensions (required because `apps/api` is ESM). tsx/tsc resolve `.js`->`.ts`, but Metro does not,
// so a *value* import of `@bethere/shared` from the mobile app fails to bundle. Mobile only consumes
// shared as *types* everywhere else. Keep these in sync with the shared helpers; the server is the
// source of truth for what is actually applied. See docs/tech-debt.md.

export const MOMENT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * MOMENT_MS;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Default "decides by" instant for a collecting plan, anchored to its earliest TIME candidate. The
 * notice lead scales as a third of the time-to-earliest (so the active reacting phase gets the
 * larger share) and caps at one day. Returns an instant strictly in (now, earliest).
 */
export function defaultDecidesByForCandidates(
  earliestMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = earliestMs - nowMs;
  const lead = clamp(Math.round(span / 3), momentMs, DAY_MS);
  const ideal = earliestMs - lead;
  if (ideal > nowMs) return ideal;
  // Degenerate near-term plan: not enough room for the lead. Fall back to the midpoint, pulled no
  // later than earliest - moment so the blind moment still fits before the event.
  const latest = earliestMs - momentMs;
  const midpoint = nowMs + span / 2;
  return Math.round(latest > nowMs ? Math.min(midpoint, latest) : midpoint);
}

/**
 * Default "reply by" instant: a sensible lead BEFORE the event - the same shape as the "decides by"
 * default (lead = a third of the run-up, floored at a moment, capped at a day), so the two deadlines
 * feel like one system. A degenerate already-here event still gets a minimal window. Always returns
 * an instant strictly in (openMs, eventMs) for a future event.
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
