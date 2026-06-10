import { randomInt } from "node:crypto";
import { INVITE_ALPHABET, INVITE_CODE_LENGTH } from "@bethere/shared";
import { eq, inArray } from "drizzle-orm";
import { db } from "./client.js";
import { eventGroups, eventParticipants, groupMembers, groups } from "./schema.js";

// Shown for a plan/roster whose group row is missing, so reads never surface a blank name.
export const FALLBACK_GROUP_NAME = "Group";

// One random code from the no-confusable alphabet. crypto.randomInt is unbiased over the range, so
// no character is favoured (a plain `% length` of a byte would skew toward the low alphabet).
function randomInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

// Mint an invite code not already taken by another group. The space (30^8) makes a collision
// vanishingly unlikely, but we still re-roll on the off chance and give up loudly after a few tries
// rather than risk inserting a duplicate against the unique constraint.
export async function freshInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomInviteCode();
    const [taken] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.inviteCode, code))
      .limit(1);
    if (!taken) return code;
  }
  throw new Error("could not mint a unique invite code");
}

// The full shareable invite URL for a code, or null when no public web origin is configured (local
// dev without PUBLIC_WEB_URL). The path mirrors the mobile linking config (`join/:code`), so the
// same URL deep-links into a native build later. The client falls back to its own origin / the bare
// code when this is null.
export function inviteUrlFor(code: string): string | null {
  const base = process.env.PUBLIC_WEB_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/join/${code}`;
}

// The full shareable URL for a single meetup, or null when no public web origin is configured. The
// path (`m/:token`, the event id doubles as the unguessable token) mirrors the mobile linking config
// so the same link previews on web and deep-links a native build later. The client falls back to its
// own origin when this is null.
export function meetupUrlFor(eventId: string): string | null {
  const base = process.env.PUBLIC_WEB_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/m/${eventId}`;
}

// Resolve many group names in ONE inArray query, returning a Map<groupId, name>. Callers read names
// via the map (with FALLBACK_GROUP_NAME for missing rows), avoiding a per-row SELECT. An empty id
// list issues no query and returns an empty map.
export async function getGroupNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(groups).where(inArray(groups.id, ids));
  for (const g of rows) out.set(g.id, g.name);
  return out;
}

// The user ids of a group's members, in row order. The single source for this membership-id query,
// shared by groupsRouter (get / addableUsers) and events.get.
export async function memberIdsOf(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => r.userId);
}

// The deduped, LIVE roster of a meetup: members of its origin group, members of every additional
// attached group (event_groups), and ad-hoc individuals who joined by link (event_participants).
// The single source for "who is in this meetup" - replaces memberIdsOf(groupId) on the event paths.
// First-occurrence order, origin members first.
export async function rosterUserIds(eventId: string, originGroupId: string): Promise<string[]> {
  const attached = await db
    .select({ groupId: eventGroups.groupId })
    .from(eventGroups)
    .where(eq(eventGroups.eventId, eventId));
  const groupIds = [originGroupId, ...attached.map((r) => r.groupId)];
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds));
  const participantRows = await db
    .select({ userId: eventParticipants.userId })
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { userId } of [...memberRows, ...participantRows]) {
    if (!seen.has(userId)) {
      seen.add(userId);
      out.push(userId);
    }
  }
  return out;
}

// Whether a user is in a meetup's roster (origin group, any attached group, or an ad-hoc participant).
export async function isInRoster(
  eventId: string,
  originGroupId: string,
  userId: string,
): Promise<boolean> {
  const ids = await rosterUserIds(eventId, originGroupId);
  return ids.includes(userId);
}
