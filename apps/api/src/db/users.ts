import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { users } from "./schema.js";

// Deterministic avatar colour so a user looks the same across sessions/devices.
const PALETTE = ["#5F9472", "#C77D54", "#5B7DB1", "#7E6BB0", "#B0654F", "#3F7BA8"];
function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Shown for a member id with no users row (a deleted / never-seeded user) so the client still
// renders a named, coloured avatar instead of a blank.
export const FALLBACK_USER_NAME = "Someone";
export const FALLBACK_AVATAR_COLOR = "#8B948B";

// Read a user's avatar card, falling back to the sentinels above when the row is missing.
export async function getUserCard(
  id: string,
): Promise<{ id: string; name: string; color: string }> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return {
    id,
    name: u?.name ?? FALLBACK_USER_NAME,
    color: u?.avatarColor ?? FALLBACK_AVATAR_COLOR,
  };
}

// Project an existing users row to the avatar card shape. No fallback - these rows always exist
// (callers pass rows they just read from the users table); getUserCard handles the missing-row case.
export function userCardFromRow(u: { id: string; name: string; avatarColor: string }): {
  id: string;
  name: string;
  color: string;
} {
  return { id: u.id, name: u.name, color: u.avatarColor };
}

// Insert a first-seen Clerk user; leave existing rows untouched. Name refresh on profile
// change is out of scope for M2 (onConflictDoNothing keeps this a no-op for known users).
export async function upsertUser(u: { id: string; name?: string; email?: string }): Promise<void> {
  await db
    .insert(users)
    .values({
      id: u.id,
      name: u.name ?? "Member",
      email: u.email ?? null,
      avatarColor: colorFor(u.id),
    })
    .onConflictDoNothing({ target: users.id });
}
