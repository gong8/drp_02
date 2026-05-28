import type { PartOfDay } from "../schemas.js";

export interface AvailabilityInput {
  userId: string;
  slots: { day: string; partOfDay: PartOfDay }[];
}

export interface ClearingSlot {
  day: string;
  partOfDay: PartOfDay;
  userIds: string[];
}

/**
 * Find the concrete slot with the most people free, returned only if it meets quorum.
 * Selecting people who share ONE slot guarantees mutual compatibility - this is why
 * there is no intransitivity bug (we never take a "connected component" with no common time).
 */
export function findClearingSlot(
  availabilities: AvailabilityInput[],
  quorum: number,
): ClearingSlot | null {
  const buckets = new Map<string, Set<string>>(); // "day|part" -> userIds
  for (const a of availabilities) {
    for (const s of a.slots) {
      const key = `${s.day}|${s.partOfDay}`;
      const set = buckets.get(key) ?? new Set<string>();
      set.add(a.userId);
      buckets.set(key, set);
    }
  }

  let best: ClearingSlot | null = null;
  for (const [key, set] of buckets) {
    if (set.size < quorum) continue;
    const [day, partOfDay] = key.split("|") as [string, PartOfDay];
    const better =
      !best ||
      set.size > best.userIds.length ||
      (set.size === best.userIds.length && day < best.day); // tie-break: earliest day
    if (better) best = { day, partOfDay, userIds: [...set] };
  }
  return best;
}
