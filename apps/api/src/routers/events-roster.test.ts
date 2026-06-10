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
