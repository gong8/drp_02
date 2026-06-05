import { randomUUID } from "node:crypto";
import {
  ByGroupInput,
  ByIdInput,
  CreateGroupInput,
  GroupMemberRef,
  RenameGroupInput,
} from "@bethere/shared";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { FALLBACK_GROUP_NAME } from "../db/groups.js";
import { groupMembers, groups, users } from "../db/schema.js";
import { getUserCard } from "../db/users.js";
import { protectedProcedure, router } from "../trpc.js";
import { requireMember } from "./events.js";

async function memberIdsOf(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => r.userId);
}

export const groupsRouter = router({
  // The groups the current user belongs to, with a member count for the list rows.
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));

    return Promise.all(
      memberships.map(async (m) => {
        const [group] = await db.select().from(groups).where(eq(groups.id, m.groupId));
        const members = await memberIdsOf(m.groupId);
        return {
          id: m.groupId,
          name: group?.name ?? FALLBACK_GROUP_NAME,
          memberCount: members.length,
        };
      }),
    );
  }),

  // One group with its full member roster (id, name, avatar colour).
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [group] = await db.select().from(groups).where(eq(groups.id, input.id));
    if (!group) return null;
    await requireMember(input.id, ctx.userId);
    const ids = await memberIdsOf(input.id);
    const members = [];
    for (const id of ids) {
      members.push(await getUserCard(id));
    }
    return { id: group.id, name: group.name, members };
  }),

  // Seeded users not already in the group - the candidates for "Add to group".
  addableUsers: protectedProcedure.input(ByGroupInput).query(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const ids = await memberIdsOf(input.groupId);
    const rows = await (ids.length
      ? db.select().from(users).where(notInArray(users.id, ids))
      : db.select().from(users));
    return rows.map((u) => ({ id: u.id, name: u.name, color: u.avatarColor }));
  }),

  // Create a group and add the creator as its first member.
  create: protectedProcedure.input(CreateGroupInput).mutation(async ({ ctx, input }) => {
    const id = `g_${randomUUID()}`;
    await db.insert(groups).values({ id, name: input.name });
    await db.insert(groupMembers).values({ groupId: id, userId: ctx.userId });
    return { id };
  }),

  rename: protectedProcedure.input(RenameGroupInput).mutation(async ({ ctx, input }) => {
    await requireMember(input.id, ctx.userId);
    await db.update(groups).set({ name: input.name }).where(eq(groups.id, input.id));
    return { ok: true as const };
  }),

  addMember: protectedProcedure.input(GroupMemberRef).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    await db
      .insert(groupMembers)
      .values({ groupId: input.groupId, userId: input.userId })
      .onConflictDoNothing();
    return { ok: true as const };
  }),

  removeMember: protectedProcedure.input(GroupMemberRef).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.userId)));
    return { ok: true as const };
  }),
});
