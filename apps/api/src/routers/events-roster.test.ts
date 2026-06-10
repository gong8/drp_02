// Integration tests for the freely-composed meetup roster (DRP-62): events.get returns the live
// union of origin-group members, attached-group members (event_groups), and ad-hoc participants
// (event_participants); the membership gate admits anyone in that union.
//
// Run with:
//   cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { eventGroups, eventParticipants } from "../db/schema.js";
import {
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
