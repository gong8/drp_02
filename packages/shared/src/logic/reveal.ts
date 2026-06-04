import { type MomentResponse, resolveIn } from "./resolve.js";

// The "going" crowd is hidden until the blind moment ends, or the plan is cleared/fizzled, so a
// live moment shows its countdown instead of biasing people with who is already in. Returns the
// IN userIds once revealed, or null while still blind.
export function revealGoing(
  responses: MomentResponse[],
  opts: { momentEndsAtMs: number; resolved: boolean; nowMs: number },
): string[] | null {
  const isResolved = opts.nowMs > opts.momentEndsAtMs || opts.resolved;
  if (!isResolved) return null;
  return [...resolveIn(responses)];
}
