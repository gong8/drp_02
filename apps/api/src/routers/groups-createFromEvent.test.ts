// Integration test for groups.createFromEvent (DRP-62): a meetup's roster (origin members + attached
// groups + ad-hoc participants) is crystallized into a new permanent group.
//
// Run with:
//   cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/groups-createFromEvent.test.ts

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

test("createFromEvent seeds a new group with the meetup's full roster", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([climber], "Climbers");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });
  await db.insert(eventGroups).values({ eventId, groupId: climbers });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const { id } = await caller(creator).groups.createFromEvent({ eventId, name: "Bowling Crew" });

  const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, id));
  const ids = members.map((m) => m.userId).sort();
  assert.deepEqual(ids, [creator, climber, guest].sort());
});

test("createFromEvent rejects a caller not in the roster", async () => {
  const creator = await makeUser();
  const stranger = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({
    groupId: origin,
    createdByUserId: creator,
    activity: "Bowling",
  });

  await assert.rejects(() => caller(stranger).groups.createFromEvent({ eventId, name: "Nope" }));
});
