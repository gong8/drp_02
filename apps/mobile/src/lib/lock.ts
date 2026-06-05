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

export function defaultDecidesByForCandidates(
  earliestMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = earliestMs - nowMs;
  const lead = clamp(Math.round(span / 3), momentMs, DAY_MS);
  const ideal = earliestMs - lead;
  if (ideal > nowMs) return ideal;
  const latest = earliestMs - momentMs;
  const midpoint = nowMs + span / 2;
  return Math.round(latest > nowMs ? Math.min(midpoint, latest) : midpoint);
}

export function addCandidateHorizon(earliestMs: number, latestMs: number): number {
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}

// A sensible lead before the event, same shape as the "decides by" default, so the two deadlines feel
// like one system. Degenerate (already-here) events still get a minimal window.
export function defaultReplyByMs(openMs: number, eventMs: number): number {
  if (eventMs <= openMs) return openMs + MOMENT_MS;
  return defaultDecidesByForCandidates(eventMs, openMs);
}
