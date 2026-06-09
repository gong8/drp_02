import type { PartOfDay, TimeCandidateInput } from "@bethere/shared";
import { TRPCError } from "@trpc/server";

export const MINUTE_MS = 60_000;
// The minute bucket a time falls in. create and addCandidate collapse times to the same minute (the
// wizard's granularity), so a slot sent twice - or at HH:MM:30 vs HH:MM:00 - stays one row.
export const startMinute = (d: Date) => Math.floor(d.getTime() / MINUTE_MS);
// The case-insensitive dedupe key for an activity label. create and addCandidate must agree on it so
// the same name added either way collapses to one row (keeping the both-axes-pinned moment shortcut).
export const activityKey = (s: string) => s.trim().toLowerCase();

// A normalized create candidate row: the column set insertCandidates writes. Time rows narrow startsAt
// to a non-null Date so create's anchor math (earliest/last) needs no cast; activity rows carry a
// trimmed label and a null time.
export type NormalizedTimeCandidate = {
  id: string;
  kind: "time";
  startsAt: Date;
  partOfDay: PartOfDay | null;
  label: null;
};
export type NormalizedActivityCandidate = {
  id: string;
  kind: "activity";
  startsAt: null;
  partOfDay: null;
  label: string;
};

// Shape create's raw time + activity inputs into the deduped, validated candidate slates the row
// insert consumes. PURE: no db, no ctx, and no clock of its own (nowMs is passed in). Mirrors the
// minute/activity dedupe addCandidate applies so the same slot/name added either way collapses to one
// row. Throws BAD_REQUEST if any time candidate is in the past (a past default decides-by would make
// the collecting plan self-fizzle immediately).
export function normalizeCreateCandidates(
  eventId: string,
  timeInputs: TimeCandidateInput[],
  activityInputs: string[],
  nowMs: number,
): { timeCands: NormalizedTimeCandidate[]; activityCands: NormalizedActivityCandidate[] } {
  const sortedTimeInputs = timeInputs
    .map((t, i) => ({
      id: `${eventId}_t${i + 1}`,
      kind: "time" as const,
      startsAt: new Date(t.startsAt),
      partOfDay: t.partOfDay ?? null,
      label: null,
    }))
    // Drop genuinely invalid date strings, but a valid time in the past is a hard error: it would
    // give a collecting plan an already-expired default decides-by (an immediate silent self-fizzle).
    // Mirrors addCandidate's future check + the explicit decides-by guard.
    .filter((c) => !Number.isNaN(c.startsAt.getTime()))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (sortedTimeInputs.some((c) => c.startsAt.getTime() <= nowMs)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "a time candidate must be in the future",
    });
  }
  // Collapse candidates that land in the same minute (the wizard's granularity), keeping the
  // earliest. A single intended slot sent twice must stay one row - otherwise it splits +1
  // momentum and defeats the concrete-moment shortcut (planOpensMoment needs exactly one time).
  // This mirrors addCandidate's minute dedupe so create and add agree.
  const seenMinutes = new Set<number>();
  const timeCands = sortedTimeInputs.filter((c) => {
    const minute = startMinute(c.startsAt);
    if (seenMinutes.has(minute)) return false;
    seenMinutes.add(minute);
    return true;
  });

  // Trim each label, drop any empty-after-trim (no whitespace-only plan names), and dedupe
  // case-insensitively keeping the first occurrence - mirroring addCandidate's key. Two labels that
  // collapse to one row keep the both-axes-pinned moment shortcut intact for duplicate activities.
  const seenActivityKeys = new Set<string>();
  const activityCands = activityInputs
    .map((text) => text.trim())
    .filter((text) => {
      if (text === "") return false;
      const key = activityKey(text);
      if (seenActivityKeys.has(key)) return false;
      seenActivityKeys.add(key);
      return true;
    })
    .map((text, i) => ({
      id: `${eventId}_a${i + 1}`,
      kind: "activity" as const,
      startsAt: null,
      partOfDay: null,
      label: text,
    }));

  return { timeCands, activityCands };
}
