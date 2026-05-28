import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { moments, responses } from "./schema.js";

export const SEED_MOMENT_ID = "m_seed";

// Demo seeding (no real suggestion/availability flow yet). Resets the single
// proposal to a fresh "open" state with two participants already IN, so the dev
// user's answer is decisive: Yes -> clears (3/3), No -> fizzles (2/3). Runs on
// startup so every `pnpm dev:api` gives a clean, replayable moment. The
// pre-seeded responses live server-side and are never sent to a client.
export async function reseedDemo(): Promise<void> {
  await db.delete(responses).where(eq(responses.momentId, SEED_MOMENT_ID));
  await db
    .insert(moments)
    .values({
      id: SEED_MOMENT_ID,
      activity: "food",
      title: "Dinner tonight?",
      place: "Pho House",
      detail: "Thu 7pm",
      participantIds: ["u_dev", "u_maya", "u_sam"],
      quorum: 3,
      status: "open",
    })
    .onConflictDoUpdate({ target: moments.id, set: { status: "open" } });
  await db.insert(responses).values([
    { id: "r_maya", momentId: SEED_MOMENT_ID, userId: "u_maya", kind: "yes" },
    { id: "r_sam", momentId: SEED_MOMENT_ID, userId: "u_sam", kind: "yes" },
  ]);
}
