import { randomInt } from "node:crypto";
import { INVITE_ALPHABET, INVITE_CODE_LENGTH } from "@bethere/shared";
import { eq, inArray } from "drizzle-orm";
import { db } from "./client.js";
import { groupMembers, groups } from "./schema.js";

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

// Read a group's display name, falling back to the sentinel above when the row is missing.
export async function getGroupName(id: string): Promise<string> {
  const [g] = await db.select().from(groups).where(eq(groups.id, id));
  return g?.name ?? FALLBACK_GROUP_NAME;
}

// Bulk version of getGroupName: resolve many group names in ONE inArray query, returning a
// Map<groupId, name>. Callers read names via the map (with FALLBACK_GROUP_NAME for missing rows),
// avoiding a per-row SELECT. An empty id list issues no query and returns an empty map.
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
