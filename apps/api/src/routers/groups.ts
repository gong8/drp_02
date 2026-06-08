import { randomUUID } from "node:crypto";
import {
  ByGroupInput,
  ByIdInput,
  CreateGroupInput,
  GroupMemberRef,
  JoinByCodeInput,
  normalizeInviteCode,
  RenameGroupInput,
} from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { FALLBACK_GROUP_NAME, freshInviteCode, inviteUrlFor } from "../db/groups.js";
import {
  candidateReactions,
  eventOptOuts,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "../db/schema.js";
import { getUserCard, userCardFromRow } from "../db/users.js";
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

    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return [];

    const nameRows = await db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(inArray(groups.id, groupIds));
    const countRows = await db
      .select({ groupId: groupMembers.groupId, n: count() })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, groupIds))
      .groupBy(groupMembers.groupId);
    const nameMap = new Map(nameRows.map((r) => [r.id, r.name]));
    const countMap = new Map(countRows.map((r) => [r.groupId, Number(r.n)]));

    return memberships.map((m) => ({
      id: m.groupId,
      name: nameMap.get(m.groupId) ?? FALLBACK_GROUP_NAME,
      memberCount: countMap.get(m.groupId) ?? 0,
    }));
  }),

  // One group with its full member roster (id, name, avatar colour).
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [group] = await db.select().from(groups).where(eq(groups.id, input.id));
    if (!group) return null;
    await requireMember(input.id, ctx.userId);
    const ids = await memberIdsOf(input.id);
    const members = await Promise.all(ids.map(getUserCard));
    return { id: group.id, name: group.name, members };
  }),

  // Seeded users not already in the group - the candidates for "Add to group".
  addableUsers: protectedProcedure.input(ByGroupInput).query(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const ids = await memberIdsOf(input.groupId);
    const rows = await db.select().from(users).where(notInArray(users.id, ids));
    return rows.map(userCardFromRow);
  }),

  // Create a group and add the creator as its first member. Mints the group's shareable invite code.
  create: protectedProcedure.input(CreateGroupInput).mutation(async ({ ctx, input }) => {
    const id = `g_${randomUUID()}`;
    const inviteCode = await freshInviteCode();
    await db.insert(groups).values({ id, name: input.name, inviteCode });
    await db.insert(groupMembers).values({ groupId: id, userId: ctx.userId });
    return { id };
  }),

  // The shareable invite for a group: its code plus a fully-qualified link when a public web origin
  // is configured (PUBLIC_WEB_URL). Member-gated - only people already in the group can fetch, and
  // thus share, the invite. The client builds its own link from the code when `url` is null.
  inviteByGroup: protectedProcedure.input(ByGroupInput).query(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
    if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "group not found" });
    return { code: group.inviteCode, url: inviteUrlFor(group.inviteCode) };
  }),

  // Redeem a group's invite code to join it (M4 onboarding). Surface-agnostic: the same path serves
  // a tapped web link, a typed code, or (later) a native deep link. Idempotent - re-joining is a
  // no-op that still resolves the group so the client can route there, and reports `alreadyMember`
  // so the UI can say "you're already in" instead of "welcome". The caller's user row already exists
  // (Clerk users are upserted in createContext; the dev user is seeded), so the membership FK holds.
  joinByCode: protectedProcedure.input(JoinByCodeInput).mutation(async ({ ctx, input }) => {
    const code = normalizeInviteCode(input.code);
    if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an invite code" });
    const [group] = await db.select().from(groups).where(eq(groups.inviteCode, code)).limit(1);
    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That code does not match a group" });
    }
    const [existing] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, ctx.userId)))
      .limit(1);
    const alreadyMember = !!existing;
    if (!alreadyMember) {
      await db
        .insert(groupMembers)
        .values({ groupId: group.id, userId: ctx.userId })
        .onConflictDoNothing();
    }
    return { groupId: group.id, name: group.name, alreadyMember };
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
