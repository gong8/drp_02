// A single "this time works for me" tap during the collecting phase.
export interface CandidateReactionInput {
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
  reactions: CandidateReactionInput[],
): CandidateTally[] {
  const byCandidate = new Map<string, Set<string>>();
  for (const id of candidateIds) byCandidate.set(id, new Set());
  for (const r of reactions) {
    byCandidate.get(r.candidateId)?.add(r.userId);
  }
  return candidateIds.map((id) => ({
    candidateId: id,
    userIds: [...(byCandidate.get(id) ?? new Set<string>())],
  }));
}

/**
 * Pick the candidate the most distinct people can make, returned only if it meets quorum.
 * Ties break toward the earlier candidate in display order (we scan `candidateIds` in order and
 * only replace on a strictly greater count). Mirrors the archived findClearingSlot, but over an
 * explicit candidate slate rather than a freeform availability grid.
 */
export function pickWinningCandidate(
  candidateIds: string[],
  reactions: CandidateReactionInput[],
  quorum: number,
): CandidateTally | null {
  let best: CandidateTally | null = null;
  for (const t of tallyCandidates(candidateIds, reactions)) {
    if (t.userIds.length < quorum) continue;
    if (!best || t.userIds.length > best.userIds.length) best = t;
  }
  return best;
}
