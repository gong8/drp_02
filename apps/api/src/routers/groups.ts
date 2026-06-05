import { randomUUID } from "node:crypto";
import {
  ByGroupInput,
  ByIdInput,
  CreateGroupInput,
  GroupMemberRef,
  RenameGroupInput,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { FALLBACK_GROUP_NAME } from "../db/groups.js";
import {
  candidateReactions,
  eventOptOuts,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "../db/schema.js";
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
    // Guard the FK: an unknown userId would otherwise surface as a 500. .onConflictDoNothing()
    // still covers the already-a-member case below.
    const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    await db
      .insert(groupMembers)
      .values({ groupId: input.groupId, userId: input.userId })
      .onConflictDoNothing();
    return { ok: true as const };
  }),

  removeMember: protectedProcedure.input(GroupMemberRef).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    return db.transaction(async (tx) => {
      // Count members inside the transaction so a concurrent removal cannot empty the group:
      // every read/write is gated by requireMember, so the last member would orphan it forever.
      const members = await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.groupId));
      const isMember = members.some((m) => m.userId === input.userId);
      if (isMember && members.length <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "a group must keep at least one member",
        });
      }

      // The removed user's votes (reactions, RSVPs, opt-outs) on this group's plans must go too,
      // otherwise they keep counting toward tallies/quorum/reveal after the user has left.
      const eventRows = await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.groupId, input.groupId));
      const eventIds = eventRows.map((e) => e.id);
      if (eventIds.length > 0) {
        await tx
          .delete(candidateReactions)
          .where(
            and(
              eq(candidateReactions.userId, input.userId),
              inArray(candidateReactions.eventId, eventIds),
            ),
          );
        await tx
          .delete(responses)
          .where(and(eq(responses.userId, input.userId), inArray(responses.eventId, eventIds)));
        await tx
          .delete(eventOptOuts)
          .where(
            and(eq(eventOptOuts.userId, input.userId), inArray(eventOptOuts.eventId, eventIds)),
          );
      }

      await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.userId)));
      return { ok: true as const };
    });
  }),
});
