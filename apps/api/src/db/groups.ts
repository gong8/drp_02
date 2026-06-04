import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { groups } from "./schema.js";

// Shown for a plan/roster whose group row is missing, so reads never surface a blank name.
export const FALLBACK_GROUP_NAME = "Group";

// Read a group's display name, falling back to the sentinel above when the row is missing.
export async function getGroupName(id: string): Promise<string> {
  const [g] = await db.select().from(groups).where(eq(groups.id, id));
  return g?.name ?? FALLBACK_GROUP_NAME;
}
