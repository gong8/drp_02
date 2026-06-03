// Mobile-local mirror of the lock helpers from `packages/shared/src/logic/lock.ts`.
//
// Why duplicated rather than imported: `@bethere/shared`'s barrel re-exports with explicit `.js`
// extensions (required because `apps/api` is ESM). tsx/tsc resolve `.js`->`.ts`, but Metro does not,
// so a *value* import of `@bethere/shared` from the mobile app fails to bundle. Mobile only consumes
// shared as *types* everywhere else. Keep these in sync with the shared helpers; the server is the
// source of truth for what is actually applied. See docs/tech-debt.md.

const MOMENT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * MOMENT_MS;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function defaultLockAtForOptions(
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

export function addCandidateHorizon(
  earliestMs: number,
  latestMs: number,
  isFuzzy: boolean,
): number {
  if (isFuzzy) return latestMs;
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}
