import { eq, inArray } from "drizzle-orm";
import { db } from "./client.js";
import { groups } from "./schema.js";

// Shown for a plan/roster whose group row is missing, so reads never surface a blank name.
export const FALLBACK_GROUP_NAME = "Group";

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
