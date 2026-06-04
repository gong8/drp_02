export const MOMENT_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * MOMENT_MS;
// The minutes knob for the default moment length. MOMENT_MS stays the ms source of truth; this is
// the same value expressed in minutes for the procedures that take a minutes argument (momentEnd).
export const DEFAULT_MOMENT_MINUTES = MOMENT_MS / 60000; // 60

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
 * Upper bound (epoch ms) for a member-added TIME candidate. Allows a small slack past the creator's
 * spread - the spread length, capped at two days - so a member can suggest a slightly later time
 * without an absurd jump. (The old fuzzy/window branch is gone: the wizard sends concrete times.)
 */
export function addCandidateHorizon(earliestMs: number, latestMs: number): number {
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}
