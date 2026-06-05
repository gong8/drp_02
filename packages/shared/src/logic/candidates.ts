// A single "this time works for me" tap during the collecting phase.
export interface CandidateReaction {
  candidateId: string;
  userId: string;
}

export interface CandidateTally {
  candidateId: string;
  userIds: string[];
}

/**
 * Count the distinct people who can make each candidate, preserving the candidate display order.
 * Candidates with no reactions still appear (empty userIds) so the creator sees the full slate,
 * and reactions to unknown candidate ids are ignored.
 */
export function tallyCandidates(
  candidateIds: string[],
  reactions: CandidateReaction[],
): CandidateTally[] {
  const byCandidate = new Map<string, Set<string>>();
  for (const id of candidateIds) byCandidate.set(id, new Set());
  for (const r of reactions) {
    byCandidate.get(r.candidateId)?.add(r.userId);
  }
  // byCandidate is seeded in candidateIds order with a Set for every id, so we can
  // emit straight from its entries - no per-id .get lookup or missing-key fallback.
  return Array.from(byCandidate, ([candidateId, userIds]) => ({
    candidateId,
    userIds: [...userIds],
  }));
}

// earliest-in-order tie-break: replace only on strictly-greater count.
function pickBest(tallies: CandidateTally[], quorum: number): CandidateTally | null {
  let best: CandidateTally | null = null;
  for (const t of tallies) {
    if (t.userIds.length < quorum) continue;
    if (!best || t.userIds.length > best.userIds.length) best = t;
  }
  return best;
}

/**
 * Pick the candidate the most distinct people can make, returned only if it meets quorum.
 * Ties break toward the earlier candidate in display order (we scan `candidateIds` in order and
 * only replace on a strictly greater count). Mirrors the archived findClearingSlot, but over an
 * explicit candidate slate rather than a freeform availability grid.
 */
export function pickWinningCandidate(
  candidateIds: string[],
  reactions: CandidateReaction[],
  quorum: number,
): CandidateTally | null {
  return pickBest(tallyCandidates(candidateIds, reactions), quorum);
}

/**
 * Pick the quorum winner, else the most-reacted candidate id ("lock the best anyway").
 * Tie-breaks toward the earlier candidate in display order (inherited from the helpers above).
 * WARNING: `[0]` is only safe when candidateIds is non-empty - callers must guard an empty slate.
 */
export function pickWinnerOrBestId(
  candidateIds: string[],
  reactions: CandidateReaction[],
  quorum: number,
): string {
  const tallies = tallyCandidates(candidateIds, reactions);
  // pickBest(tallies, 0) is the overall most-reacted tally; it is null only for an empty
  // slate, where tallies[0] is also undefined - the documented non-empty precondition.
  const best = pickBest(tallies, quorum) ?? pickBest(tallies, 0) ?? tallies[0];
  return best.candidateId;
}
