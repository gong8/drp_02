import { eq } from "drizzle-orm";
import { db } from "./client.js";
import {
  availability,
  groupMembers,
  groups,
  moments,
  plans,
  responses,
  suggestions,
  users,
} from "./schema.js";

const GROUP_ID = "g_flat";
export const SEED_SUGGESTION_ID = "s_seed";

const DEMO_USERS = [
  { id: "u_dev", name: "You", avatarColor: "#5F9472" },
  { id: "u_maya", name: "Maya", avatarColor: "#C77D54" },
  { id: "u_sam", name: "Sam", avatarColor: "#5B7DB1" },
];

/** Today as a YYYY-MM-DD string (local), matching the slot `day` format. */
function todayISO(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Demo seeding for the full suggest -> availability -> moment loop. Resets the
// transactional tables, then sets up: Maya suggested 🍜 Food for the next week, and
// she + Sam have already dropped that they're free THIS evening. So when the dev user
// drops the same (today, evening) slot, that slot reaches three free people = quorum
// for food (3) and a moment fires immediately. Runs on every `pnpm dev:api` boot so
// the loop is clean and replayable. The pre-seeded availability lives server-side and
// is never sent to a client (privacy §8.1).
async function insertDemoData(): Promise<void> {
  // 1. Upsert the demo users.
  for (const u of DEMO_USERS) {
    await db
      .insert(users)
      .values(u)
      .onConflictDoUpdate({
        target: users.id,
        set: { name: u.name, avatarColor: u.avatarColor },
      });
  }

  // 2. The group + its members.
  await db.insert(groups).values({ id: GROUP_ID, name: "Flatmates" }).onConflictDoNothing();
  for (const u of DEMO_USERS) {
    await db.insert(groupMembers).values({ groupId: GROUP_ID, userId: u.id }).onConflictDoNothing();
  }

  // 3. The collecting suggestion (Maya, food, this week).
  const windowStart = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 6);
  await db.insert(suggestions).values({
    id: SEED_SUGGESTION_ID,
    groupId: GROUP_ID,
    byUserId: "u_maya",
    activity: "food",
    text: null,
    windowStart,
    windowEnd,
    status: "collecting",
  });

  // 4. Maya & Sam are already free this evening (so the dev user's drop tips quorum).
  const slots = [{ day: todayISO(), partOfDay: "evening" as const }];
  await db.insert(availability).values([
    { id: "a_maya", suggestionId: SEED_SUGGESTION_ID, userId: "u_maya", slots },
    { id: "a_sam", suggestionId: SEED_SUGGESTION_ID, userId: "u_sam", slots },
  ]);
}

// Wipe transactional tables then re-insert the clean demo loop. Used in local dev
// (SEED_ON_BOOT defaults to "reset") so every boot is a clean, replayable demo.
export async function reseedDemo(): Promise<void> {
  await db.delete(plans);
  await db.delete(responses);
  await db.delete(moments);
  await db.delete(availability);
  await db.delete(suggestions);
  await insertDemoData();
}

// Seed the demo loop only when the suggestions table is empty — i.e. a fresh DB.
// Used on the live backend so redeploys / instance recycles never wipe real data.
export async function seedDemoIfEmpty(): Promise<void> {
  const existing = await db.select({ id: suggestions.id }).from(suggestions).limit(1);
  if (existing.length > 0) return;
  await insertDemoData();
}

// DEMO ONLY: when a moment fires, auto-answer "yes" for every other matched participant
// (skipping the tester and anyone who already answered) so a single tester can drive the
// moment to a real clear/fizzle by themselves. Removed when real multi-user lands.
export async function seedDemoPeerYeses(momentId: string, excludeUserId: string): Promise<void> {
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
  if (!m) return;

  const existing = await db.select().from(responses).where(eq(responses.momentId, momentId));
  const answered = new Set(existing.map((r) => r.userId));
  const peers = m.participantIds.filter((id) => id !== excludeUserId && !answered.has(id));
  if (peers.length === 0) return;

  await db.insert(responses).values(
    peers.map((userId) => ({
      id: `r_${momentId}_${userId}`,
      momentId,
      userId,
      kind: "yes" as const,
      cond: null,
    })),
  );
}
