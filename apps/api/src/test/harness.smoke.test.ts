// Harness self-test: proves the DB-backed tRPC integration setup works end to end (create +
// migrate the per-process DB, call real procedures, enforce the auth boundary, truncate between
// tests). If this fails, no other integration test can be trusted - start here. Run the DB first
// with `pnpm db:up`.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import {
  caller,
  dropTestDb,
  insertEvent,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "./harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

test("a user can create a group and see it in groups.mine", async () => {
  const alice = await makeUser();
  const { id } = await caller(alice).groups.create({ name: "Climbing crew" });

  const mine = await caller(alice).groups.mine();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, id);
  assert.equal(mine[0].name, "Climbing crew");
  assert.equal(mine[0].memberCount, 1);
});

test("resetTables isolates tests: the previous group is gone", async () => {
  const bob = await makeUser();
  const mine = await caller(bob).groups.mine();
  assert.deepEqual(mine, []);
});

test("a member reads a collecting plan via events.get with the creator hidden", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({ groupId, createdByUserId: creator });

  const got = await caller(creator).events.get({ id: eventId });
  assert.ok(got, "expected the plan to load");
  assert.equal(got.phase, "collecting");
  // isCreator is returned as a boolean only; the creator id itself is never serialized.
  assert.equal(typeof got.isCreator, "boolean");
  assert.ok(!("createdByUserId" in got), "creator id must never leave the server");
});

test("a non-member is refused by the events.get auth boundary", async () => {
  const creator = await makeUser();
  const outsider = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({ groupId, createdByUserId: creator });

  await assert.rejects(
    () => caller(outsider).events.get({ id: eventId }),
    (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
  );
});
