// Mobile-local copy of `defaultLockAt` from `packages/shared/src/logic/lock.ts`.
//
// Why duplicated rather than imported: `@bethere/shared`'s barrel (`src/index.ts`) re-exports with
// explicit `.js` extensions (required because `apps/api` is ESM). tsx/tsc resolve `.js`->`.ts`, but
// Metro does not, so a *value* import of `@bethere/shared` from the mobile app fails to bundle
// ("Unable to resolve ./logic/candidates.js"). Mobile only consumes shared as *types* (erased at
// build time) everywhere else. Keep this in sync with the shared helper; the server is the source of
// truth for the actual default applied on create. See docs/tech-debt.md.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function defaultLockAt(
  earliestMs: number,
  nowMs: number,
  momentMs: number = HOUR_MS,
  leadMs: number = DAY_MS,
): number {
  const latest = earliestMs - momentMs;
  const ideal = earliestMs - leadMs;
  if (ideal > nowMs && ideal <= latest) return Math.round(ideal);
  const midpoint = nowMs + (earliestMs - nowMs) / 2;
  const t = latest > nowMs ? Math.min(midpoint, latest) : midpoint;
  return Math.round(t);
}
