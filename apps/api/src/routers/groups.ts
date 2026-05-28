import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { groupMembers, groups, suggestions, users } from "../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

export const groupsRouter = router({
  // The groups the current user belongs to, with a member count and the current
  // collecting suggestion (if any) so Home can show a calm "add your availability" hint.
  mine: publicProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));

    return Promise.all(
      memberships.map(async (m) => {
        const [group] = await db.select().from(groups).where(eq(groups.id, m.groupId));
        const members = await db
          .select()
          .from(groupMembers)
          .where(eq(groupMembers.groupId, m.groupId));
        const [active] = await db
          .select()
          .from(suggestions)
          .where(and(eq(suggestions.groupId, m.groupId), eq(suggestions.status, "collecting")));
        let byName = "Someone";
        if (active) {
          const [by] = await db.select().from(users).where(eq(users.id, active.byUserId));
          byName = by?.name ?? "Someone";
        }
        const activeSuggestion = active
          ? { id: active.id, activity: active.activity, byName }
          : null;
        return {
          id: m.groupId,
          name: group?.name ?? "Group",
          memberCount: members.length,
          activeSuggestion,
        };
      }),
    );
  }),
});
