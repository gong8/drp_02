import { type ResponseInput, resolveIn } from "./resolve.js";

// The "going" crowd is hidden until the respond-by timer ends (or the event is locked), so a
// pending event shows its countdown instead of biasing people with who is already in. Returns
// the IN userIds once revealed, or null while still pending.
export function revealGoing(
  responses: ResponseInput[],
  opts: { respondByAtMs: number; status: string; nowMs: number },
): string[] | null {
  const resolved = opts.nowMs > opts.respondByAtMs || opts.status === "resolved";
  if (!resolved) return null;
  return [...resolveIn(responses)];
}
