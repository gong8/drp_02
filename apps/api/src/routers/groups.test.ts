// Integration tests for the groups router (apps/api/src/routers/groups.ts).
//
// Every assertion is derived from the SPEC (ARCHITECTURE.md + CLAUDE.md + the Zod schemas
// + the lane brief), not from what the implementation happens to do:
//   - create makes the creator the first and only member; mine lists it with the right count.
//   - addMember is idempotent (no duplicate row); removeMember removes them.
//   - get returns the full roster for a member; non-member -> FORBIDDEN; unknown id -> null.
//   - addableUsers returns seeded users NOT already in the group; requires membership.
//   - rename changes the name; requires membership.
//   - every member-gated mutation/query rejects a non-member with FORBIDDEN.
//
// Run with (and nothing else):
//   cd /Users/gong/Programming/drp_02/apps/api && \
//     node --import tsx --import ./src/test/env.ts --test src/routers/groups.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  addMember,
  caller,
  candidateReactions,
  db,
  dropTestDb,
  eventOptOuts,
  groupMembers,
  groups,
  insertActivityCandidate,
  insertEvent,
  insertOptOut,
  insertReaction,
  insertResponse,
  insertTimeCandidate,
  makeGroup,
  makeUser,
  makeUsers,
  resetTables,
  responses,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const isForbidden = (e: unknown): boolean => e instanceof TRPCError && e.code === "FORBIDDEN";

// Count the persisted membership rows for a (groupId, userId) pair - used to prove there is no
// duplicate row after a repeated addMember.
async function membershipRowCount(groupId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  return rows.length;
}

// How many vote rows a user still has on a given event - used to prove removeMember clears them.
async function reactionRowCount(eventId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(candidateReactions)
    .where(and(eq(candidateReactions.eventId, eventId), eq(candidateReactions.userId, userId)));
  return rows.length;
}
async function responseRowCount(eventId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(responses)
    .where(and(eq(responses.eventId, eventId), eq(responses.userId, userId)));
  return rows.length;
}
async function optOutRowCount(eventId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, eventId), eq(eventOptOuts.userId, userId)));
  return rows.length;
}

// ----- create -----

test("create adds the creator as the first and only member", async () => {
  const creator = await makeUser();
  const { id } = await caller(creator).groups.create({ name: "Trip crew" });

  const memberRows = await db.select().from(groupMembers).where(eq(groupMembers.groupId, id));

  // Spec: "Create a group and add the creator as its first member." The creator is the ONLY
  // member at creation - nobody else has been added.
  assert.equal(memberRows.length, 1);
  assert.equal(memberRows[0].userId, creator);
});

test("create persists the group with the requested name", async () => {
  const creator = await makeUser();
  const { id } = await caller(creator).groups.create({ name: "Book club" });

  const [group] = await db.select().from(groups).where(eq(groups.id, id));
  assert.ok(group);
  assert.equal(group.name, "Book club");
});

test("create rejects an empty name (GroupName requires min length 1)", async () => {
  const creator = await makeUser();
  // Spec: GroupName = z.string().min(1).max(60); an empty name must not create a group.
  await assert.rejects(() => caller(creator).groups.create({ name: "" }));
});

test("create requires authentication (unauthenticated -> UNAUTHORIZED)", async () => {
  await assert.rejects(
    () => caller(null).groups.create({ name: "Anon group" }),
    (e: unknown) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
  );
});

// ----- mine -----

test("mine lists a freshly created group with memberCount 1 for the creator", async () => {
  const creator = await makeUser();
  const { id } = await caller(creator).groups.create({ name: "Solo so far" });

  const mine = await caller(creator).groups.mine();
  const row = mine.find((g) => g.id === id);
  assert.ok(row, "the created group should appear in the creator's mine list");
  assert.equal(row.name, "Solo so far");
  assert.equal(row.memberCount, 1);
});

test("mine reports the full memberCount including everyone in the group", async () => {
  const [a, b, c] = await makeUsers(3);
  const id = await makeGroup([a, b, c], "Three friends");

  const mine = await caller(a).groups.mine();
  const row = mine.find((g) => g.id === id);
  assert.ok(row);
  assert.equal(row.memberCount, 3);
});

test("mine returns only groups the caller belongs to, not other groups", async () => {
  const me = await makeUser();
  const other = await makeUser();
  const mineGroup = await makeGroup([me], "Mine");
  const theirGroup = await makeGroup([other], "Theirs");

  const mine = await caller(me).groups.mine();
  const ids = mine.map((g) => g.id);
  assert.ok(ids.includes(mineGroup));
  assert.ok(!ids.includes(theirGroup), "a group I do not belong to must not appear in mine");
});

test("mine is empty for a user in no groups", async () => {
  const loner = await makeUser();
  const mine = await caller(loner).groups.mine();
  assert.deepEqual(mine, []);
});

// ----- addMember (idempotent) -----

test("addMember adds a new member to the group", async () => {
  const owner = await makeUser();
  const newcomer = await makeUser();
  const id = await makeGroup([owner], "Crew");

  await caller(owner).groups.addMember({ groupId: id, userId: newcomer });

  assert.equal(await membershipRowCount(id, newcomer), 1);
});

test("addMember is idempotent: adding an existing member is a no-op with no duplicate row", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner, friend], "Crew");

  // friend is already a member; adding again must not create a second row.
  await caller(owner).groups.addMember({ groupId: id, userId: friend });
  await caller(owner).groups.addMember({ groupId: id, userId: friend });

  assert.equal(await membershipRowCount(id, friend), 1);
});

test("addMember rejects an unknown userId with NOT_FOUND and adds no row", async () => {
  const owner = await makeUser();
  const id = await makeGroup([owner], "Crew");

  // Spec / lane brief: a userId with no users row would otherwise be a raw FK 500; it must surface
  // as NOT_FOUND and add nothing.
  await assert.rejects(
    () => caller(owner).groups.addMember({ groupId: id, userId: "u_ghost" }),
    (e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND",
  );
  assert.equal(await membershipRowCount(id, "u_ghost"), 0);
});

test("addMember repeated does not inflate memberCount", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner], "Crew");

  await caller(owner).groups.addMember({ groupId: id, userId: friend });
  await caller(owner).groups.addMember({ groupId: id, userId: friend });

  const mine = await caller(owner).groups.mine();
  const row = mine.find((g) => g.id === id);
  assert.ok(row);
  // owner + friend = 2, regardless of how many times friend was added.
  assert.equal(row.memberCount, 2);
});

// ----- removeMember -----

test("removeMember removes the member from the group", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner, friend], "Crew");

  await caller(owner).groups.removeMember({ groupId: id, userId: friend });

  assert.equal(await membershipRowCount(id, friend), 0);
});

test("removeMember leaves other members intact", async () => {
  const owner = await makeUser();
  const a = await makeUser();
  const b = await makeUser();
  const id = await makeGroup([owner, a, b], "Crew");

  await caller(owner).groups.removeMember({ groupId: id, userId: a });

  assert.equal(await membershipRowCount(id, a), 0);
  assert.equal(await membershipRowCount(id, b), 1);
  assert.equal(await membershipRowCount(id, owner), 1);
});

test("removeMember rejects removing the last member (a group must keep at least one)", async () => {
  const owner = await makeUser();
  const id = await makeGroup([owner], "Solo");

  // Removing the only member would orphan the group forever (every read/write is member-gated).
  await assert.rejects(
    () => caller(owner).groups.removeMember({ groupId: id, userId: owner }),
    (e: unknown) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );

  // The lone member must still be there.
  assert.equal(await membershipRowCount(id, owner), 1);
});

test("removeMember allows removing down to one member, then blocks the last", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner, friend], "Pair");

  // Two members -> removing one is fine.
  await caller(owner).groups.removeMember({ groupId: id, userId: friend });
  assert.equal(await membershipRowCount(id, friend), 0);

  // Now owner is the last member -> removing them is rejected.
  await assert.rejects(
    () => caller(owner).groups.removeMember({ groupId: id, userId: owner }),
    (e: unknown) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  assert.equal(await membershipRowCount(id, owner), 1);
});

test("removeMember also clears the removed user's reactions, responses and opt-outs", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner, friend], "Crew");

  // friend has cast votes on a plan in this group: a candidate reaction, a moment RSVP, an opt-out.
  const eventId = await insertEvent({ groupId: id, createdByUserId: owner });
  const timeCandidate = await insertTimeCandidate(eventId, new Date());
  await insertActivityCandidate(eventId, "Pizza");
  await insertReaction(eventId, timeCandidate, friend);
  await insertResponse(eventId, friend, "yes");
  await insertOptOut(eventId, friend);

  // Sanity: the votes exist before removal.
  assert.equal(await reactionRowCount(eventId, friend), 1);
  assert.equal(await responseRowCount(eventId, friend), 1);
  assert.equal(await optOutRowCount(eventId, friend), 1);

  await caller(owner).groups.removeMember({ groupId: id, userId: friend });

  // Removal clears every vote so the departed user stops counting toward tallies/quorum/reveal.
  assert.equal(await membershipRowCount(id, friend), 0);
  assert.equal(await reactionRowCount(eventId, friend), 0);
  assert.equal(await responseRowCount(eventId, friend), 0);
  assert.equal(await optOutRowCount(eventId, friend), 0);
});

test("removeMember leaves other members' votes untouched", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner, friend], "Crew");

  const eventId = await insertEvent({ groupId: id, createdByUserId: owner });
  const timeCandidate = await insertTimeCandidate(eventId, new Date());
  // owner stays; their reaction must survive friend's removal.
  await insertReaction(eventId, timeCandidate, owner);
  await insertReaction(eventId, timeCandidate, friend);

  await caller(owner).groups.removeMember({ groupId: id, userId: friend });

  assert.equal(await reactionRowCount(eventId, friend), 0);
  assert.equal(await reactionRowCount(eventId, owner), 1);
});

// ----- get -----

test("get returns the group with its full member roster for a member", async () => {
  const a = await makeUser({ name: "Ada", avatarColor: "#111111" });
  const b = await makeUser({ name: "Bo", avatarColor: "#222222" });
  const id = await makeGroup([a, b], "Roster group");

  const view = await caller(a).groups.get({ id });
  assert.ok(view);
  assert.equal(view.id, id);
  assert.equal(view.name, "Roster group");

  const memberIds = view.members.map((m) => m.id).sort();
  assert.deepEqual(memberIds, [a, b].sort());

  // Each roster entry carries id, name, colour (an avatar card) - not a bare id.
  const ada = view.members.find((m) => m.id === a);
  assert.ok(ada);
  assert.equal(ada.name, "Ada");
  assert.equal(ada.color, "#111111");
});

test("get returns null for an unknown group id", async () => {
  const u = await makeUser();
  // Spec / lane brief: unknown id -> null (the missing-group check precedes membership).
  const view = await caller(u).groups.get({ id: "g_does_not_exist" });
  assert.equal(view, null);
});

test("get rejects a non-member of an existing group with FORBIDDEN", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const id = await makeGroup([member], "Members only");

  await assert.rejects(() => caller(outsider).groups.get({ id }), isForbidden);
});

// ----- addableUsers -----

test("addableUsers returns seeded users not already in the group", async () => {
  const member = await makeUser({ name: "Insider" });
  const candidate1 = await makeUser({ name: "Outsider 1" });
  const candidate2 = await makeUser({ name: "Outsider 2" });
  const id = await makeGroup([member], "Group");

  const addable = await caller(member).groups.addableUsers({ groupId: id });
  const ids = addable.map((u) => u.id);

  // Both non-members are addable; the existing member is excluded.
  assert.ok(ids.includes(candidate1));
  assert.ok(ids.includes(candidate2));
  assert.ok(!ids.includes(member), "an existing member must not be addable");
});

test("addableUsers excludes every current member", async () => {
  const m1 = await makeUser();
  const m2 = await makeUser();
  const outsider = await makeUser();
  const id = await makeGroup([m1, m2], "Group");

  const addable = await caller(m1).groups.addableUsers({ groupId: id });
  const ids = addable.map((u) => u.id);

  assert.ok(!ids.includes(m1));
  assert.ok(!ids.includes(m2));
  assert.ok(ids.includes(outsider));
});

test("addableUsers carries each user's name and colour", async () => {
  const member = await makeUser();
  const candidate = await makeUser({ name: "Zed", avatarColor: "#abcdef" });
  const id = await makeGroup([member], "Group");

  const addable = await caller(member).groups.addableUsers({ groupId: id });
  const zed = addable.find((u) => u.id === candidate);
  assert.ok(zed);
  assert.equal(zed.name, "Zed");
  assert.equal(zed.color, "#abcdef");
});

test("addableUsers reflects a member just added (now excluded)", async () => {
  const owner = await makeUser();
  const newcomer = await makeUser();
  const id = await makeGroup([owner], "Group");

  // Newcomer is addable before joining...
  const before = await caller(owner).groups.addableUsers({ groupId: id });
  assert.ok(before.map((u) => u.id).includes(newcomer));

  await caller(owner).groups.addMember({ groupId: id, userId: newcomer });

  // ...and excluded after joining.
  const after = await caller(owner).groups.addableUsers({ groupId: id });
  assert.ok(!after.map((u) => u.id).includes(newcomer));
});

test("addableUsers rejects a non-member with FORBIDDEN", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const id = await makeGroup([member], "Group");

  await assert.rejects(() => caller(outsider).groups.addableUsers({ groupId: id }), isForbidden);
});

// ----- rename -----

test("rename changes the group name", async () => {
  const owner = await makeUser();
  const id = await makeGroup([owner], "Old name");

  await caller(owner).groups.rename({ id, name: "New name" });

  const [group] = await db.select().from(groups).where(eq(groups.id, id));
  assert.ok(group);
  assert.equal(group.name, "New name");
});

test("rename is reflected by mine", async () => {
  const owner = await makeUser();
  const id = await makeGroup([owner], "Before");

  await caller(owner).groups.rename({ id, name: "After" });

  const mine = await caller(owner).groups.mine();
  const row = mine.find((g) => g.id === id);
  assert.ok(row);
  assert.equal(row.name, "After");
});

test("rename rejects an empty name (GroupName min length 1)", async () => {
  const owner = await makeUser();
  const id = await makeGroup([owner], "Keep me");

  await assert.rejects(() => caller(owner).groups.rename({ id, name: "" }));

  // The stored name is unchanged.
  const [group] = await db.select().from(groups).where(eq(groups.id, id));
  assert.ok(group);
  assert.equal(group.name, "Keep me");
});

test("rename rejects a non-member with FORBIDDEN", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const id = await makeGroup([owner], "Owner's group");

  await assert.rejects(() => caller(outsider).groups.rename({ id, name: "Hijacked" }), isForbidden);

  // The name must be untouched by the rejected rename.
  const [group] = await db.select().from(groups).where(eq(groups.id, id));
  assert.ok(group);
  assert.equal(group.name, "Owner's group");
});

// ----- member-gating of the mutations -----

test("addMember rejects a non-member with FORBIDDEN and adds no row", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const target = await makeUser();
  const id = await makeGroup([owner], "Members only");

  await assert.rejects(
    () => caller(outsider).groups.addMember({ groupId: id, userId: target }),
    isForbidden,
  );

  // The forbidden call must not have added the target.
  assert.equal(await membershipRowCount(id, target), 0);
});

test("removeMember rejects a non-member with FORBIDDEN and removes no row", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const outsider = await makeUser();
  const id = await makeGroup([owner, friend], "Members only");

  await assert.rejects(
    () => caller(outsider).groups.removeMember({ groupId: id, userId: friend }),
    isForbidden,
  );

  // The forbidden call must not have removed the friend.
  assert.equal(await membershipRowCount(id, friend), 1);
});

test("a removed member loses access (subsequent get -> FORBIDDEN)", async () => {
  const owner = await makeUser();
  const friend = await makeUser();
  const id = await makeGroup([owner, friend], "Crew");

  // friend has access while a member.
  const before = await caller(friend).groups.get({ id });
  assert.ok(before);

  await addMember(id, friend); // no-op safety; friend already in
  await caller(owner).groups.removeMember({ groupId: id, userId: friend });

  // After removal, friend is a non-member and is forbidden.
  await assert.rejects(() => caller(friend).groups.get({ id }), isForbidden);
});
