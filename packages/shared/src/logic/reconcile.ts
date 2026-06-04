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
 * Argmax over a slate by distinct-backer count, with the earliest-created chip winning a tie.
 * We sort the slate by createdAtMs ascending and replace the current pick only on a STRICTLY greater
 * count, so the earliest-created among equals stays on top. `userFilter` (when given) restricts which
 * voters count - the time axis only counts the winning idea's backers. tallyCandidates is the sole
 * gatekeeper for unknown suggestion ids (it zero-fills the supplied slate and ignores the rest), so
 * no pre-filter on candidateIds is needed. Returns null when `items` is empty.
 */
function pickByBackerCount<T extends { id: string; createdAtMs: number }>(
  items: T[],
  candidateIds: string[],
  votes: ReconcileVote[],
  userFilter?: (userId: string) => boolean,
): { item: T; backers: string[] } | null {
  const reactions: CandidateReactionInput[] = votes
    .filter((v) => (userFilter ? userFilter(v.userId) : true))
    .map((v) => ({ candidateId: v.suggestionId, userId: v.userId }));
  const backersById = new Map(
    tallyCandidates(candidateIds, reactions).map((t) => [t.candidateId, t.userIds]),
  );
  let pick: { item: T; backers: string[] } | null = null;
  for (const item of [...items].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
    const backers = backersById.get(item.id) ?? [];
    if (!pick || backers.length > pick.backers.length) pick = { item, backers };
  }
  return pick;
}

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
  const won = pickByBackerCount(
    ideas,
    ideas.map((i) => i.id),
    votes,
  );
  if (!won) return { kind: "fizzle" };

  // 2. Min-heat gate on the winning idea's distinct backers.
  if (won.backers.length < minHeat) return { kind: "fizzle" };

  // 3. Best time among the winning idea's backers only.
  const backerSet = new Set(won.backers);
  const best = pickByBackerCount(
    times,
    times.map((t) => t.id),
    votes,
    (u) => backerSet.has(u),
  );
  const bestN = best?.backers.length ?? 0;

  if (best && bestN >= TIME_CONSENSUS) {
    return {
      kind: "moment",
      ideaId: won.item.id,
      ideaText: won.item.text,
      startsAtMs: best.item.startsAtMs,
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
  return { kind: "collecting", ideaId: won.item.id, ideaText: won.item.text, candidateStartsAtMs };
}
