// events.update - the per-field optimistic compare-and-set (CAS) edit.
//
// Spec (ARCHITECTURE.md + CLAUDE.md): ANY group member (not just the creator) may edit a plan's
// text - its activity (once locked), location, and notes (description) - until the plan clears or
// fizzles. Each field carries a {from, to}; the server applies `to` only if the stored value still
// equals `from`, else it reports the field in `conflicts` with the now-current value and leaves it
// untouched (no clobber). A SELECT ... FOR UPDATE serializes concurrent edits: same-field, first
// wins / second conflicts; different-field, both apply. Empty activity reverts to auto-derive
// (stored ""); empty location stays "" (notNull); empty notes clear to null. While collecting the
// activity is vote-decided, so an activity edit is rejected; location/notes are still editable. A
// cleared or fizzled plan is final (every edit rejected). requireMember is the access boundary:
// non-member -> FORBIDDEN; a missing event -> NOT_FOUND.
//
// Run with:
//   node --import tsx --import ./src/test/env.ts --test src/routers/events-update-cas.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  addMember,
  caller,
  db,
  dropTestDb,
  events,
  insertEvent,
  makeGroup,
  makeUser,
  makeUsers,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

async function storedEvent(eventId: string) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row;
}

// ---- access boundary ------------------------------------------------------------------------

test("an unauthenticated caller is rejected with UNAUTHORIZED", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
  });

  await assert.rejects(
    () => caller(null).events.update({ eventId, location: { from: "", to: "The Pub" } }),
    (err: unknown) => err instanceof TRPCError && err.code === "UNAUTHORIZED",
  );
});

test("a non-member editor is refused with FORBIDDEN", async () => {
  const creator = await makeUser();
  const outsider = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
  });

  await assert.rejects(
    () => caller(outsider).events.update({ eventId, location: { from: "", to: "The Pub" } }),
    (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
  );
  // The clobber must not have happened.
  assert.equal((await storedEvent(eventId)).location, "");
});

test("a missing event is NOT_FOUND (resolved before membership)", async () => {
  const creator = await makeUser();
  await makeGroup([creator]);

  await assert.rejects(
    () =>
      caller(creator).events.update({
        eventId: "e_does_not_exist",
        location: { from: "", to: "X" },
      }),
    (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
  );
});

test("a NON-creator member may edit a locked plan's text", async () => {
  const creator = await makeUser();
  const member = await makeUser();
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    location: "",
  });

  const res = await caller(member).events.update({
    eventId,
    location: { from: "", to: "Luigi's" },
  });
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(res.applied, ["location"]);
  assert.equal((await storedEvent(eventId)).location, "Luigi's");
});

// ---- per-field compare-and-set --------------------------------------------------------------

test("a fresh `from` applies the edit and reports the field in `applied`", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    location: "Old place",
  });

  const res = await caller(creator).events.update({
    eventId,
    location: { from: "Old place", to: "New place" },
  });
  assert.deepEqual(res.applied, ["location"]);
  assert.deepEqual(res.conflicts, []);
  assert.equal((await storedEvent(eventId)).location, "New place");
});

test("a stale `from` is reported as a conflict carrying the current value and does NOT clobber", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    location: "Current place",
  });

  // The editor loaded a stale value ("What I saw") that no longer matches the stored "Current place".
  const res = await caller(creator).events.update({
    eventId,
    location: { from: "What I saw", to: "My new place" },
  });
  assert.deepEqual(res.applied, []);
  assert.deepEqual(res.conflicts, [{ field: "location", current: "Current place" }]);
  // The stored value is untouched - no clobber.
  assert.equal((await storedEvent(eventId)).location, "Current place");
});

test("multiple fields in one call apply or conflict independently", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    location: "Pub",
    description: "bring cash",
  });

  // location `from` is fresh -> applies; description `from` is stale -> conflicts.
  const res = await caller(creator).events.update({
    eventId,
    location: { from: "Pub", to: "Bar" },
    description: { from: "stale notes", to: "bring cards" },
  });
  assert.deepEqual(res.applied, ["location"]);
  assert.deepEqual(res.conflicts, [{ field: "description", current: "bring cash" }]);

  const row = await storedEvent(eventId);
  assert.equal(row.location, "Bar");
  // The conflicting field is left untouched.
  assert.equal(row.description, "bring cash");
});

test("the activity is editable on a locked (moment) plan", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
  });

  const res = await caller(creator).events.update({
    eventId,
    activity: { from: "Dinner", to: "Brunch" },
  });
  assert.deepEqual(res.applied, ["activity"]);
  assert.deepEqual(res.conflicts, []);
  assert.equal((await storedEvent(eventId)).activity, "Brunch");
});

// ---- empty-value semantics ------------------------------------------------------------------

test('an empty activity reverts to auto-derive (stored "")', async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
  });

  const res = await caller(creator).events.update({
    eventId,
    activity: { from: "Dinner", to: "" },
  });
  assert.deepEqual(res.applied, ["activity"]);
  // Stored "" means the name re-derives from the winning candidate rather than locking in a value.
  assert.equal((await storedEvent(eventId)).activity, "");
});

test('an empty location stays "" (the column is notNull, never null)', async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    location: "Somewhere",
  });

  const res = await caller(creator).events.update({
    eventId,
    location: { from: "Somewhere", to: "" },
  });
  assert.deepEqual(res.applied, ["location"]);
  const row = await storedEvent(eventId);
  assert.equal(row.location, "");
  assert.notEqual(row.location, null);
});

test("an empty notes (description) clears to null", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    description: "bring snacks",
  });

  const res = await caller(creator).events.update({
    eventId,
    description: { from: "bring snacks", to: "" },
  });
  assert.deepEqual(res.applied, ["description"]);
  assert.equal((await storedEvent(eventId)).description, null);
});

test('a null-stored description matches a `from` of "" (treated as empty)', async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    description: null,
  });

  // The client that loaded an absent notes field sends from:"" - that must match the stored null.
  const res = await caller(creator).events.update({
    eventId,
    description: { from: "", to: "new notes" },
  });
  assert.deepEqual(res.applied, ["description"]);
  assert.deepEqual(res.conflicts, []);
  assert.equal((await storedEvent(eventId)).description, "new notes");
});

// ---- phase gating ---------------------------------------------------------------------------

test("an activity edit is rejected while collecting (it is vote-decided)", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    activity: "",
  });

  await assert.rejects(
    () => caller(creator).events.update({ eventId, activity: { from: "", to: "Bowling" } }),
    (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
  );
  // Nothing was written.
  assert.equal((await storedEvent(eventId)).activity, "");
});

test("location and notes are editable while collecting", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    activity: "",
    location: "",
    description: null,
  });

  const res = await caller(creator).events.update({
    eventId,
    location: { from: "", to: "Downtown" },
    description: { from: "", to: "carpool from mine" },
  });
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(res.applied.sort(), ["description", "location"]);
  const row = await storedEvent(eventId);
  assert.equal(row.location, "Downtown");
  assert.equal(row.description, "carpool from mine");
});

test("a cleared plan is final - every edit is rejected", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "cleared",
    activity: "Dinner",
    location: "Pub",
  });

  await assert.rejects(
    () => caller(creator).events.update({ eventId, location: { from: "Pub", to: "Bar" } }),
    (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
  );
  assert.equal((await storedEvent(eventId)).location, "Pub");
});

test("a fizzled plan is final - every edit is rejected", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "fizzled",
    activity: "Dinner",
    location: "Pub",
  });

  await assert.rejects(
    () => caller(creator).events.update({ eventId, location: { from: "Pub", to: "Bar" } }),
    (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
  );
  assert.equal((await storedEvent(eventId)).location, "Pub");
});

// ---- concurrency: the core FOR UPDATE guarantee ---------------------------------------------

test("two members editing the SAME field concurrently: exactly one wins, the other conflicts, no lost update", async () => {
  const [creator, a, b] = await makeUsers(3);
  const groupId = await makeGroup([creator]);
  await addMember(groupId, a);
  await addMember(groupId, b);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
  });

  // Both loaded the same activity "Dinner" and try to overwrite it with different values.
  const [resA, resB] = await Promise.all([
    caller(a).events.update({ eventId, activity: { from: "Dinner", to: "Brunch" } }),
    caller(b).events.update({ eventId, activity: { from: "Dinner", to: "Lunch" } }),
  ]);

  const results = [resA, resB];
  const winners = results.filter((r) => r.applied.includes("activity"));
  const losers = results.filter((r) => r.conflicts.some((c) => c.field === "activity"));

  // Exactly one applied, exactly one conflicted.
  assert.equal(winners.length, 1, "exactly one edit must win");
  assert.equal(losers.length, 1, "exactly one edit must conflict");

  const stored = (await storedEvent(eventId)).activity;
  // The stored value is one of the two attempted writes (never the original "Dinner", never lost).
  assert.ok(stored === "Brunch" || stored === "Lunch", `stored should be a winner, got ${stored}`);
  // The loser's conflict carries the WINNER's now-current value, not the stale original.
  const loserConflict = losers[0].conflicts.find((c) => c.field === "activity");
  assert.ok(loserConflict, "loser must report an activity conflict");
  assert.equal(
    loserConflict?.current,
    stored,
    "the conflict must carry the winner's value, not the stale original",
  );
});

test("two members editing DIFFERENT fields concurrently both apply", async () => {
  const [creator, a, b] = await makeUsers(3);
  const groupId = await makeGroup([creator]);
  await addMember(groupId, a);
  await addMember(groupId, b);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner",
    location: "Pub",
    description: "bring cash",
  });

  const [resA, resB] = await Promise.all([
    caller(a).events.update({ eventId, location: { from: "Pub", to: "Bar" } }),
    caller(b).events.update({ eventId, description: { from: "bring cash", to: "bring cards" } }),
  ]);

  assert.deepEqual(resA.applied, ["location"]);
  assert.deepEqual(resA.conflicts, []);
  assert.deepEqual(resB.applied, ["description"]);
  assert.deepEqual(resB.conflicts, []);

  const row = await storedEvent(eventId);
  assert.equal(row.location, "Bar");
  assert.equal(row.description, "bring cards");
  // The untouched activity is unchanged.
  assert.equal(row.activity, "Dinner");
});
