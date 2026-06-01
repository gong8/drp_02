import { db } from "./client.js";
import { users } from "./schema.js";

// Deterministic avatar colour so a user looks the same across sessions/devices.
const PALETTE = ["#5F9472", "#C77D54", "#5B7DB1", "#7E6BB0", "#B0654F", "#3F7BA8"];
function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
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
