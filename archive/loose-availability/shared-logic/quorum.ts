import type { Activity } from "../schemas.js";

// Auto-quorum = smallest viable group for the activity. Tune later.
export const AUTO_QUORUM: Record<Activity, number> = {
  coffee: 2,
  study: 2,
  gym: 2,
  food: 3,
  drinks: 3,
  anything: 2,
};

export function quorumFor(activity: Activity): number {
  return AUTO_QUORUM[activity];
}
