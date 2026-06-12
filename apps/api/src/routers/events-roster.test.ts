// Integration tests for the freely-composed meetup roster (DRP-62): events.get returns the live
// union of origin-group members, attached-group members (event_groups), and ad-hoc participants
// (event_participants); the membership gate admits anyone in that union.
//
// Run with:
//   cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { eventGroups, eventParticipants, events } from "../db/schema.js";
import {
  addMember,
  caller,
  db,
  dropTestDb,
  groupMembers,
  insertEvent,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

test("events.get members is the union of origin group, attached group, and participants", async () => {
  const creator = await makeUser();
  const groupB = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const other = await makeGroup([groupB], "Climbers");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  await db.insert(eventGroups).values({ eventId, groupId: other });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view);
  const memberIds = view.members.map((m) => m.id).sort();
  // members excludes the caller (creator); union = {groupB, guest}
  assert.deepEqual(memberIds, [groupB, guest].sort());
});

test("a member of an attached group, added AFTER attach, appears in the roster (live)", async () => {
  const creator = await makeUser();
  const other = await makeGroup([], "Climbers");
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });
  await db.insert(eventGroups).values({ eventId, groupId: other });

  const lateJoiner = await makeUser();
  await db.insert(groupMembers).values({ groupId: other, userId: lateJoiner });

  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view);
  assert.ok(view.members.some((m) => m.id === lateJoiner));
});

test("an ad-hoc participant (not in any group) can read the plan - the gate admits the roster", async () => {
  const creator = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const view = await caller(guest).events.get({ id: eventId });
  assert.ok(view, "guest should be able to read a plan they participate in");
});

test("a stranger (not in the roster) is FORBIDDEN from reading the plan", async () => {
  const creator = await makeUser();
  const stranger = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  await assert.rejects(() => caller(stranger).events.get({ id: eventId }));
  // sanity: the row exists and the gate is what rejects
  const [row] = await db.select().from(eventGroups).where(eq(eventGroups.eventId, eventId));
  assert.equal(row, undefined);
});

test("events.mine includes plans where I am only an ad-hoc participant", async () => {
  const creator = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const mine = await caller(guest).events.mine();
  assert.ok(
    mine.some((p) => p.id === eventId),
    "guest should see the plan on their dashboard",
  );
});

test("events.mine includes plans where I am only via a non-origin attached group", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([climber], "Climbers");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });
  await db.insert(eventGroups).values({ eventId, groupId: climbers });

  const mine = await caller(climber).events.mine();
  assert.ok(
    mine.some((p) => p.id === eventId),
    "attached-group member should see the plan",
  );
});

test("joinByToken inserts an event_participants row, NOT a group_members row", async () => {
  const creator = await makeUser();
  const outsider = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  const res = await caller(outsider).events.joinByToken({ eventId });
  assert.equal(res.alreadyMember, false);

  const parts = await db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  assert.ok(
    parts.some((p) => p.userId === outsider),
    "outsider is a participant",
  );

  const gm = await db.select().from(groupMembers).where(eq(groupMembers.groupId, origin));
  assert.equal(
    gm.some((m) => m.userId === outsider),
    false,
    "outsider must NOT join the group",
  );
});

test("joinByToken is idempotent and a no-op for someone already in the roster", async () => {
  const creator = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  const res = await caller(creator).events.joinByToken({ eventId });
  assert.equal(res.alreadyMember, true);
  const parts = await db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  assert.equal(parts.length, 0, "an existing member is not duplicated as a participant");
});

test("events.addGroup attaches a group the caller belongs to and grows the roster", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([creator, climber], "Climbers");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  await caller(creator).events.addGroup({ eventId, groupId: climbers });

  const rows = await db.select().from(eventGroups).where(eq(eventGroups.eventId, eventId));
  assert.ok(rows.some((r) => r.groupId === climbers));
  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view?.members.some((m) => m.id === climber));
});

test("events.addGroup rejects a group the caller does NOT belong to", async () => {
  const creator = await makeUser();
  const other = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([other], "Climbers"); // creator not in it
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  await assert.rejects(() => caller(creator).events.addGroup({ eventId, groupId: climbers }));
});

test("events.addGroup is idempotent and a no-op for the origin group", async () => {
  const creator = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([creator], "Climbers");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  await caller(creator).events.addGroup({ eventId, groupId: origin }); // origin -> no row
  await caller(creator).events.addGroup({ eventId, groupId: climbers });
  await caller(creator).events.addGroup({ eventId, groupId: climbers }); // dup -> no error
  const rows = await db.select().from(eventGroups).where(eq(eventGroups.eventId, eventId));
  assert.equal(rows.length, 1);
});

test("a roster member via an attached group can edit the plan (events.update is roster-gated)", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([climber], "Climbers");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
    location: "Old place",
    // collecting phase: location is editable, activity is vote-decided (not editable)
  });
  await db.insert(eventGroups).values({ eventId, groupId: climbers });

  // climber is in the roster only via the attached group; they must be allowed to edit location
  const res = await caller(climber).events.update({
    eventId,
    location: { from: "Old place", to: "New place" },
  });
  assert.ok(res.applied.includes("location"), "location should be applied");
  assert.deepEqual(res.conflicts, [], "no conflicts expected");
});

test("events.create folds additional groups into the meetup (compose at creation)", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([creator, climber], "Climbers");

  const created = await caller(creator).events.create({
    groupId: origin,
    additionalGroupIds: [climbers],
  });

  const rows = await db.select().from(eventGroups).where(eq(eventGroups.eventId, created.id));
  assert.ok(
    rows.some((r) => r.groupId === climbers),
    "the additional group is attached",
  );
  const view = await caller(creator).events.get({ id: created.id });
  assert.ok(
    view?.members.some((m) => m.id === climber),
    "its members are in the roster",
  );
});

test("events.create rejects an additional group the creator is not in (no orphan event)", async () => {
  const creator = await makeUser();
  const other = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([other], "Climbers"); // creator not in it

  await assert.rejects(() =>
    caller(creator).events.create({ groupId: origin, additionalGroupIds: [climbers] }),
  );
  // The membership check runs before the event insert, so no event row was created.
  const all = await caller(creator).events.mine();
  assert.equal(all.length, 0, "a rejected create leaves no event");
});

// ----- events.roster: the Who's-in payload (DRP-63) -----
// Assertions derive from the spec (docs/superpowers/specs/2026-06-11-plus-one-trust-controls-
// design.md + CLAUDE.md anonymity rules): the roster groups people by where they come from -
// origin group, attached groups, then ad-hoc +1s with brought-by attribution and join times.
// Presence is not a vote: the payload never exposes votes or the creator.

const isCode = (code: string) => (e: unknown) => e instanceof TRPCError && e.code === code;

test("roster sections the live audience: origin group, attached group, then +1s", async () => {
  const owner = await makeUser({ name: "Leo" });
  const flatmate = await makeUser({ name: "Sam" });
  const plusOne = await makeUser({ name: "Nathan" });
  const originId = await makeGroup([owner], "The Boys");
  const attachedId = await makeGroup([owner, flatmate], "The Flat");
  const eventId = await insertEvent({ groupId: originId, createdByUserId: owner });

  await caller(owner).events.addGroup({ eventId, groupId: attachedId });
  await caller(plusOne).events.joinByToken({ eventId, via: owner });

  const roster = await caller(owner).events.roster({ eventId });
  assert.deepEqual(
    roster.groups.map((g) => g.name),
    ["The Boys", "The Flat"],
    "origin group first, then attached",
  );
  assert.deepEqual(
    roster.groups.map((g) => g.members.map((m) => m.name)),
    [["Leo"], ["Leo", "Sam"]],
  );
  assert.equal(roster.participants.length, 1);
  const nathan = roster.participants[0];
  assert.equal(nathan.name, "Nathan");
  assert.equal(nathan.invitedBy?.name, "Leo", "brought-by attribution surfaces the sharer");
  assert.ok(Date.parse(nathan.joinedAt) > 0, "joinedAt is an ISO timestamp");
});

test("roster renders an unattributed +1 (legacy/bogus via) with a null invitedBy", async () => {
  const owner = await makeUser();
  const plusOne = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await caller(plusOne).events.joinByToken({ eventId });
  const roster = await caller(owner).events.roster({ eventId });
  assert.equal(roster.participants[0].invitedBy, null);
});

test("a participant who later joins a constituent group graduates out of the +1 list", async () => {
  const owner = await makeUser({ name: "Leo" });
  const plusOne = await makeUser({ name: "Nathan" });
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await caller(plusOne).events.joinByToken({ eventId, via: owner });
  await addMember(groupId, plusOne);

  const roster = await caller(owner).events.roster({ eventId });
  assert.equal(roster.participants.length, 0, "no longer listed as a +1");
  assert.ok(
    roster.groups[0].members.some((m) => m.name === "Nathan"),
    "listed in the group section instead",
  );
});

test("roster orders +1s by join time and is readable by a +1 (roster-gated, not member-gated)", async () => {
  const owner = await makeUser();
  const first = await makeUser({ name: "First" });
  const second = await makeUser({ name: "Second" });
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await caller(first).events.joinByToken({ eventId });
  await caller(second).events.joinByToken({ eventId });

  const roster = await caller(first).events.roster({ eventId });
  assert.deepEqual(
    roster.participants.map((p) => p.name),
    ["First", "Second"],
  );
});

test("roster reports the door pair and canToggle: member yes, +1 no, frozen nobody", async () => {
  const owner = await makeUser();
  const plusOne = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });
  await caller(plusOne).events.joinByToken({ eventId });

  const memberView = await caller(owner).events.roster({ eventId });
  assert.equal(memberView.joinsOpen, true);
  assert.equal(memberView.lockJoins, false);
  assert.equal(memberView.canToggle, true, "a group member may flip an unlocked door");

  const plusOneView = await caller(plusOne).events.roster({ eventId });
  assert.equal(plusOneView.canToggle, false, "a +1 may never flip the door");

  const frozenId = await insertEvent({ groupId, createdByUserId: owner, lockJoins: true });
  const frozenView = await caller(owner).events.roster({ eventId: frozenId });
  assert.equal(frozenView.canToggle, false, "a locked door is frozen for everyone");
});

test("roster refuses an outsider (FORBIDDEN) and an unknown event (NOT_FOUND)", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await assert.rejects(() => caller(outsider).events.roster({ eventId }), isCode("FORBIDDEN"));
  await assert.rejects(
    () => caller(owner).events.roster({ eventId: "e_does_not_exist" }),
    isCode("NOT_FOUND"),
  );
});

test("roster never exposes votes or the creator (presence is not a vote)", async () => {
  const owner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  const roster = await caller(owner).events.roster({ eventId });
  assert.deepEqual(
    Object.keys(roster).sort(),
    ["canToggle", "groups", "joinsOpen", "lockJoins", "participants"].sort(),
  );
  for (const g of roster.groups) {
    for (const m of g.members) {
      assert.deepEqual(Object.keys(m).sort(), ["color", "id", "name"].sort());
    }
  }
});

// ----- events.setJoinsOpen: flipping the +1 door (DRP-63) -----

async function joinsOpenOf(eventId: string): Promise<boolean> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row.joinsOpen;
}

test("a group member flips the door; the closed door then rejects a new joiner", async () => {
  const owner = await makeUser();
  const joiner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await caller(owner).events.setJoinsOpen({ eventId, open: false });
  assert.equal(await joinsOpenOf(eventId), false);
  await assert.rejects(() => caller(joiner).events.joinByToken({ eventId }), isCode("FORBIDDEN"));

  // And back open: a member can reopen what a member closed.
  await caller(owner).events.setJoinsOpen({ eventId, open: true });
  assert.equal(await joinsOpenOf(eventId), true);
  await caller(joiner).events.joinByToken({ eventId });
});

test("an attached-group member may flip the door too (the constituency is all groups)", async () => {
  const owner = await makeUser();
  const other = await makeUser();
  const originId = await makeGroup([owner]);
  const attachedId = await makeGroup([owner, other]);
  const eventId = await insertEvent({ groupId: originId, createdByUserId: owner });
  await caller(owner).events.addGroup({ eventId, groupId: attachedId });

  await caller(other).events.setJoinsOpen({ eventId, open: false });
  assert.equal(await joinsOpenOf(eventId), false);
});

test("a +1 may not flip the door (FORBIDDEN), even though they are in the roster", async () => {
  const owner = await makeUser();
  const plusOne = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });
  await caller(plusOne).events.joinByToken({ eventId });

  await assert.rejects(
    () => caller(plusOne).events.setJoinsOpen({ eventId, open: false }),
    isCode("FORBIDDEN"),
  );
  assert.equal(await joinsOpenOf(eventId), true, "door unchanged");
});

test("a locked door (lockJoins, decided at suggestion) is frozen for everyone", async () => {
  const owner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: owner,
    joinsOpen: false,
    lockJoins: true,
  });

  await assert.rejects(
    () => caller(owner).events.setJoinsOpen({ eventId, open: true }),
    isCode("FORBIDDEN"),
  );
  assert.equal(await joinsOpenOf(eventId), false, "door unchanged");
});

test("setJoinsOpen refuses an outsider (FORBIDDEN) and an unknown event (NOT_FOUND)", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await assert.rejects(
    () => caller(outsider).events.setJoinsOpen({ eventId, open: false }),
    isCode("FORBIDDEN"),
  );
  await assert.rejects(
    () => caller(owner).events.setJoinsOpen({ eventId: "e_does_not_exist", open: false }),
    isCode("NOT_FOUND"),
  );
});
