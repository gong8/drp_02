const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The default lock-in deadline for a collecting plan, as an epoch-ms instant. This is Tom's "it
 * locks the day before to give everyone notice", clamped so it always sits strictly after `now` and
 * leaves the blind moment room to finish before the soonest proposed slot.
 *
 * - If there is runway for the full lead time (a day before), use it.
 * - Otherwise (a near-term plan where "a day before" is already past) fall back to the midpoint of
 *   (now, earliest), pulled no later than `earliest - momentMs` when that still sits after now, so
 *   there is a real collecting window before the deadline and a real moment after it.
 *
 * The caller's invariant is `now < lockAt <= earliest`; for any `earliest > now` this returns a
 * value in `(now, earliest)`. The lock's `momentEndsAt = min(lockTime + moment, chosenStartsAt)`
 * clamp guarantees the moment never overruns the event even in the degenerate near-term case.
 */
export function defaultLockAt(
  earliestMs: number,
  nowMs: number,
  momentMs: number = HOUR_MS,
  leadMs: number = DAY_MS,
): number {
  const latest = earliestMs - momentMs; // the moment must be able to finish before the event
  const ideal = earliestMs - leadMs; // "the day before"
  if (ideal > nowMs && ideal <= latest) return Math.round(ideal);
  const midpoint = nowMs + (earliestMs - nowMs) / 2;
  const t = latest > nowMs ? Math.min(midpoint, latest) : midpoint;
  return Math.round(t);
}
