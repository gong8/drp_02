import { pickWinnerOrBestId } from "@bethere/shared";

// The concrete shortcut: a plan opens straight into the blind moment (it always happens, contingent
// false) ONLY when BOTH axes are pinned - nothing left to converge on. The time axis is pinned when
// it is locked to exactly one candidate; the activity axis is pinned when it is locked to at most one
// (zero or one). Any open axis (members can still add) or any contested axis (2+ candidates, even if
// locked) starts a collecting round so the group can add and/or vote on what is not yet settled.
export function planOpensMoment(
  timeCandidateCount: number,
  lockTimes: boolean,
  activityCandidateCount: number,
  lockThings: boolean,
): boolean {
  const timePinned = timeCandidateCount === 1 && lockTimes;
  const activityPinned = activityCandidateCount <= 1 && lockThings;
  return timePinned && activityPinned;
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
// resolveTitle). Prefer the leading ACTIVITY candidate so a suggested activity names the plan live;
// otherwise a friendly placeholder so a nameless plan never renders blank on a card or header.
export const FALLBACK_TITLE = "An activity";

export function displayTitle(
  title: string,
  activityCandidates: { id: string; label: string | null }[],
  reactions: { candidateId: string; userId: string }[],
): string {
  const resolved = resolveTitle(title, activityCandidates, reactions).trim();
  return resolved || FALLBACK_TITLE;
}
