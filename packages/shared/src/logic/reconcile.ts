import { type CandidateReactionInput, tallyCandidates } from "./candidates.js";

// A time band needs at least this many of the winning idea's backers to agree before a float tips
// straight into a blind moment. Below it, the float falls to a short collecting round so people can
// pin the time the normal way - we never fire a commitment clock on a time only one person wanted.
export const TIME_CONSENSUS = 2;

// The idea axis of a float: a fused what+where chip ("bowling", "the pub").
export interface ReconcileIdea {
  id: string;
  text: string;
  createdAtMs: number;
}
// The time axis of a float: a loose band already resolved to a concrete instant (band -> hour).
export interface ReconcileTime {
  id: string;
  startsAtMs: number;
  createdAtMs: number;
}
// A single +1 on a chip of either axis. Interest, not commitment.
export interface ReconcileVote {
  suggestionId: string;
  userId: string;
}

export type FloatResolution =
  | { kind: "fizzle" }
  | { kind: "moment"; ideaId: string; ideaText: string; startsAtMs: number }
  | { kind: "collecting"; ideaId: string; ideaText: string; candidateStartsAtMs: number[] };

/**
 * Reconcile a float to a single concrete outcome at its tip deadline. PURE and side-effect free, so
 * a future AWS Bedrock reconciler can replace the body behind this same signature (semantic chip
 * merge, compromise-finding) without touching the caller.
 *
 * Idea-first, sequenced - the idea is the star:
 *   1. Winning idea = the one the most distinct people +1'd; ties break to the earliest created.
 *   2. Min-heat gate: if the winner has fewer than `minHeat` backers, the float fizzles (>= 2 means
 *      a one-person float can never tip and de-anonymize itself).
 *   3. Best time = the band the most of the WINNING IDEA's backers agree on (votes from people not
 *      into the winning idea do not count). Ties break to the earliest created.
 *      - If that band clears TIME_CONSENSUS backers -> tip straight into the blind `moment` on it.
 *      - Otherwise (hot idea, unresolved time) -> open a short `collecting` round: candidates are the
 *        float's own time chips, or - if it never grew any - the window's day-candidates.
 *
 * Either non-fizzle outcome ends in a concrete event. `windowSlotsMs` is the expanded window (from
 * expandWindow) used only as the collecting fallback when the float has no time chips at all.
 */
export function reconcileFloat(
  ideas: ReconcileIdea[],
  times: ReconcileTime[],
  votes: ReconcileVote[],
  minHeat: number,
  windowSlotsMs: number[],
): FloatResolution {
  if (ideas.length === 0) return { kind: "fizzle" };

  // 1. Winning idea: most distinct backers, earliest-created on a tie.
  const ideaIds = ideas.map((i) => i.id);
  const ideaVotes: CandidateReactionInput[] = votes
    .filter((v) => ideaIds.includes(v.suggestionId))
    .map((v) => ({ candidateId: v.suggestionId, userId: v.userId }));
  const ideaBackers = new Map(
    tallyCandidates(ideaIds, ideaVotes).map((t) => [t.candidateId, t.userIds]),
  );

  const ideasByCreated = [...ideas].sort((a, b) => a.createdAtMs - b.createdAtMs);
  let winner: { id: string; text: string; backers: string[] } | null = null;
  for (const idea of ideasByCreated) {
    const backers = ideaBackers.get(idea.id) ?? [];
    if (!winner || backers.length > winner.backers.length) {
      winner = { id: idea.id, text: idea.text, backers };
    }
  }
  if (!winner) return { kind: "fizzle" };

  // 2. Min-heat gate on the winning idea's distinct backers.
  if (winner.backers.length < minHeat) return { kind: "fizzle" };

  // 3. Best time among the winning idea's backers only.
  const backerSet = new Set(winner.backers);
  const timeIds = times.map((t) => t.id);
  const backerTimeVotes: CandidateReactionInput[] = votes
    .filter((v) => backerSet.has(v.userId) && timeIds.includes(v.suggestionId))
    .map((v) => ({ candidateId: v.suggestionId, userId: v.userId }));
  const timeBackerCount = new Map(
    tallyCandidates(timeIds, backerTimeVotes).map((t) => [t.candidateId, t.userIds.length]),
  );

  const timesByCreated = [...times].sort((a, b) => a.createdAtMs - b.createdAtMs);
  let bestTime: { startsAtMs: number; n: number } | null = null;
  for (const t of timesByCreated) {
    const n = timeBackerCount.get(t.id) ?? 0;
    if (!bestTime || n > bestTime.n) bestTime = { startsAtMs: t.startsAtMs, n };
  }

  if (bestTime && bestTime.n >= TIME_CONSENSUS) {
    return {
      kind: "moment",
      ideaId: winner.id,
      ideaText: winner.text,
      startsAtMs: bestTime.startsAtMs,
    };
  }

  // 4. Hot idea, no agreed time -> collecting fallback. Prefer the float's own time chips; if it has
  // none, use the window's day-candidates. If somehow neither exists, fizzle rather than crystallize
  // an empty collecting plan.
  const candidateStartsAtMs =
    times.length > 0
      ? [...times].sort((a, b) => a.startsAtMs - b.startsAtMs).map((t) => t.startsAtMs)
      : [...windowSlotsMs].sort((a, b) => a - b);
  if (candidateStartsAtMs.length === 0) return { kind: "fizzle" };
  return { kind: "collecting", ideaId: winner.id, ideaText: winner.text, candidateStartsAtMs };
}
