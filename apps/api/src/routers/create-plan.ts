import { pickWinnerOrBestId } from "@bethere/shared";

// The concrete shortcut: a plan with exactly ONE time candidate AND lockTimes set opens straight
// into the blind moment (it always happens, contingent false) - there is nothing left to converge.
// Any other shape (multiple times, no lock, or zero times) starts a collecting round.
export function planOpensMoment(timeCandidateCount: number, lockTimes: boolean): boolean {
  return timeCandidateCount === 1 && lockTimes;
}

// When a plan locks with no explicit title, the winning ACTIVITY candidate (most public +1s, ties
// broken by pickWinnerOrBestId's stable order) becomes the title. A non-empty title is kept as-is;
// with no activity candidates the title stays empty.
export function resolveTitle(
  title: string,
  activityCandidates: { id: string; label: string | null }[],
  reactions: { candidateId: string; userId: string }[],
): string {
  if (title.trim() !== "") return title;
  if (activityCandidates.length === 0) return "";
  const winnerId = pickWinnerOrBestId(
    activityCandidates.map((c) => c.id),
    reactions,
    1,
  );
  return activityCandidates.find((c) => c.id === winnerId)?.label ?? "";
}

// Shown while a collecting plan still has no real title (the title is only fixed at lock, via
// resolveTitle). Prefer the leading ACTIVITY candidate so a suggested place names the plan live;
// otherwise a friendly placeholder so a nameless plan never renders blank on a card or header.
export const FALLBACK_TITLE = "An idea";

export function displayTitle(
  title: string,
  activityCandidates: { id: string; label: string | null }[],
  reactions: { candidateId: string; userId: string }[],
): string {
  const resolved = resolveTitle(title, activityCandidates, reactions).trim();
  return resolved || FALLBACK_TITLE;
}
