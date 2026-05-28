import { randomUUID } from "node:crypto";
import { CreateGroupInput } from "@bethere/shared";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { groupMembers, groups, users } from "../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

async function memberIdsOf(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => r.userId);
}

export const groupsRouter = router({
  // The groups the current user belongs to, with a member count for the list rows.
  mine: publicProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));

    return Promise.all(
      memberships.map(async (m) => {
        const [group] = await db.select().from(groups).where(eq(groups.id, m.groupId));
        const members = await memberIdsOf(m.groupId);
        return { id: m.groupId, name: group?.name ?? "Group", memberCount: members.length };
      }),
    );
  }),

  // One group with its full member roster (id, name, avatar colour).
  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [group] = await db.select().from(groups).where(eq(groups.id, input.id));
    if (!group) return null;
    const ids = await memberIdsOf(input.id);
    const members = [];
    for (const id of ids) {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      members.push({ id, name: u?.name ?? "Someone", color: u?.avatarColor ?? "#8B948B" });
    }
    return { id: group.id, name: group.name, members };
  }),

  // Seeded users not already in the group - the candidates for "Add to group".
  addableUsers: publicProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ input }) => {
      const ids = await memberIdsOf(input.groupId);
      const rows = await (ids.length
        ? db.select().from(users).where(notInArray(users.id, ids))
        : db.select().from(users));
      return rows.map((u) => ({ id: u.id, name: u.name, color: u.avatarColor }));
    }),

  // Create a group and add the creator as its first member.
  create: publicProcedure.input(CreateGroupInput).mutation(async ({ ctx, input }) => {
    const id = `g_${randomUUID()}`;
    await db.insert(groups).values({ id, name: input.name });
    await db.insert(groupMembers).values({ groupId: id, userId: ctx.userId });
    return { id };
  }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(60) }))
    .mutation(async ({ input }) => {
      await db.update(groups).set({ name: input.name }).where(eq(groups.id, input.id));
      return { ok: true as const };
    }),

  addMember: publicProcedure
    .input(z.object({ groupId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .insert(groupMembers)
        .values({ groupId: input.groupId, userId: input.userId })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  removeMember: publicProcedure
    .input(z.object({ groupId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.userId)));
      return { ok: true as const };
    }),
});
