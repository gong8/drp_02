import { type CandidateReaction, pickWinnerOrBestId } from "@bethere/shared";

// The concrete shortcut: a plan opens straight into the blind moment (it always happens, contingent
// false) ONLY when BOTH axes are pinned - nothing left to converge on. The time axis is pinned when
// it is locked to exactly one candidate; the activity axis is pinned when it is locked to at most one
// (zero or one). Any open axis (members can still add) or any contested axis (2+ candidates, even if
// locked) starts a collecting round so the group can add and/or vote on what is not yet settled.
export function planOpensMoment(
  timeCandidateCount: number,
  lockTimes: boolean,
  activityCandidateCount: number,
  lockActivity: boolean,
): boolean {
  const timePinned = timeCandidateCount === 1 && lockTimes;
  const activityPinned = activityCandidateCount <= 1 && lockActivity;
  return timePinned && activityPinned;
}

// When a plan locks with no explicit activity, the winning ACTIVITY candidate (most public +1s, ties
// broken by pickWinnerOrBestId's stable order) becomes the plan's name. A non-empty activity is kept
// as-is; with no activity candidates it stays empty.
export function resolveActivity(
  activity: string,
  activityCandidates: { id: string; label: string | null }[],
  reactions: CandidateReaction[],
): string {
  if (activity.trim() !== "") return activity;
  if (activityCandidates.length === 0) return "";
  const winnerId = pickWinnerOrBestId(
    activityCandidates.map((c) => c.id),
    reactions,
    1,
  );
  return activityCandidates.find((c) => c.id === winnerId)?.label ?? "";
}

export function displayActivity(
  activity: string,
  activityCandidates: { id: string; label: string | null }[],
  reactions: CandidateReaction[],
): string {
  return resolveActivity(activity, activityCandidates, reactions).trim();
}
