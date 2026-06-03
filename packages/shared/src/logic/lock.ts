export const MOMENT_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * MOMENT_MS;
export const MIN_REACT_MS = 2 * MOMENT_MS; // a real reacting window for loose plans
export const MAX_REACT_MS = 3 * DAY_MS; // cap collecting so a loose plan does not lose momentum

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

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
  momentMs: number = MOMENT_MS,
  leadMs: number = DAY_MS,
): number {
  const latest = earliestMs - momentMs; // the moment must be able to finish before the event
  const ideal = earliestMs - leadMs; // "the day before"
  if (ideal > nowMs && ideal <= latest) return Math.round(ideal);
  const midpoint = nowMs + (earliestMs - nowMs) / 2;
  const t = latest > nowMs ? Math.min(midpoint, latest) : midpoint;
  return Math.round(t);
}

/**
 * Default deadline for an options/exact-N plan, anchored to a deliberate proposed time. The notice
 * lead scales as a third of the time-to-earliest (so the active reacting phase gets the larger
 * share) and caps at one day. Returns an instant strictly in (now, earliest).
 */
export function defaultLockAtForOptions(
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
 * Default deadline for a fuzzy plan, anchored to the loose window (its last slot) rather than to the
 * always-soon earliest slot that window expansion produces. The reacting window is a third of the
 * window span, floored at MIN_REACT_MS and capped at MAX_REACT_MS. Returns an instant strictly in
 * (now, lastSlot).
 */
export function defaultLockAtForWindow(
  lastSlotMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = lastSlotMs - nowMs;
  const react = clamp(Math.round(span / 3), MIN_REACT_MS, MAX_REACT_MS);
  const latest = lastSlotMs - momentMs; // leave moment room before the last day
  const lockAt = Math.min(nowMs + react, latest);
  if (lockAt > nowMs) return Math.round(lockAt);
  return Math.round(nowMs + span / 2); // window narrower than one moment
}

/**
 * Upper bound (epoch ms) for a member-added candidate time. Fuzzy plans stay inside the expanded
 * window (its last slot). Options plans allow a small slack past the creator's spread - the spread
 * length, capped at two days - so a member can suggest a slightly later time without an absurd jump.
 */
export function addCandidateHorizon(
  earliestMs: number,
  latestMs: number,
  isFuzzy: boolean,
): number {
  if (isFuzzy) return latestMs;
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}
