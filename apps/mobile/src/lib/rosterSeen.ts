// Device-local "last seen roster" markers for the Who's-in surface (DRP-63): which +1s are NEW
// since the user last looked at a plan's roster. Client-side by design - candidate reactions and
// moment responses carry no timestamps server-side, and "since you last looked" is at least as
// informative as "since you responded" (you look when you respond). Web persists in localStorage
// (the conversion-funnel hero); native falls back to an in-memory map, so badges there reset per
// launch - an accepted limitation until a native storage dep exists.

import { webStore } from "./invite";

const KEY_PREFIX = "bethere.rosterSeen.";
const nativeSeen = new Map<string, number>();

// The marker: the ms instant up to which this device has seen the roster, or null if never looked.
export function getRosterSeen(eventId: string): number | null {
  const store = webStore();
  if (store) {
    const raw = store.getItem(KEY_PREFIX + eventId);
    const ms = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return nativeSeen.get(eventId) ?? null;
}

export function setRosterSeen(eventId: string, atMs: number): void {
  const store = webStore();
  if (store) store.setItem(KEY_PREFIX + eventId, String(atMs));
  else nativeSeen.set(eventId, atMs);
}

// The newest join instant among a roster's +1s, or null with none. ISO strings come straight off
// events.roster's participants[].joinedAt.
export function latestJoinMs(joinedAtIsos: string[]): number | null {
  let max: number | null = null;
  for (const iso of joinedAtIsos) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && (max === null || ms > max)) max = ms;
  }
  return max;
}

// Whether one +1 row badges as NEW. A null marker means the user has never looked: everything
// reads as seen (seedRosterSeen sets the baseline on the first read so later joins badge).
export function isNewJoin(joinedAtIso: string, seenMs: number | null): boolean {
  if (seenMs === null) return false;
  const ms = Date.parse(joinedAtIso);
  return Number.isFinite(ms) && ms > seenMs;
}

// How many of a roster's +1s badge as NEW - the count on the Who's-in row.
export function newJoinerCount(joinedAtIsos: string[], seenMs: number | null): number {
  return joinedAtIsos.filter((iso) => isNewJoin(iso, seenMs)).length;
}

// Advance the marker past everything currently visible: the newest join AND the local now, so the
// rows just shown never re-badge (joinedAt is server-stamped; taking the max tolerates clock skew
// in both directions). Called when the Who's-in sheet opens.
export function markRosterSeen(eventId: string, joinedAtIsos: string[]): void {
  setRosterSeen(eventId, Math.max(latestJoinMs(joinedAtIsos) ?? 0, Date.now()));
}

// First-read baseline: viewing a plan's roster state for the first time counts as having seen it
// (no all-new noise on a roster that predates this device), and anything joining AFTER this view
// starts badging. No-op once a marker exists.
export function seedRosterSeen(eventId: string, joinedAtIsos: string[]): void {
  if (getRosterSeen(eventId) === null) markRosterSeen(eventId, joinedAtIsos);
}
