// events.pastForGroup - the redo picker. Spec (ARCHITECTURE.md L98-101, events.ts L790-811,
// past-meetups.ts): returns a group's CLEARED plans only, scoped to the caller's membership, each
// reduced to a clonable shell (activity / location / notes + lockTimes) - newest first, capped at
// 20, carrying NO time-as-new-chosen and NO RSVP data. Expectations come from the spec, not the code.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  caller,
  dropTestDb,
  insertEvent,
  insertResponse,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const HOUR = 60 * 60 * 1000;

// Helper: a cleared plan needs status=resolved too (the real lifecycle sets both), but pastForGroup
// filters on phase only - we set phase explicitly per case.

test("returns a cleared plan in the group as a clonable shell", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "Bowling night",
    location: "Hollywood Bowl",
    description: "bring cash",
    lockTimes: false,
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "Bowling night");
  assert.equal(out[0].location, "Hollywood Bowl");
  assert.equal(out[0].description, "bring cash");
  assert.equal(out[0].lockTimes, false);
});

test("excludes a collecting plan (only cleared plans appear)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    activity: "Still voting",
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 0);
});

test("excludes a moment plan (only cleared plans appear)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "moment",
    activity: "Live right now",
    momentEndsAt: new Date(Date.now() + HOUR),
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 0);
});

test("excludes a fizzled plan (a fizzle leaves no trace)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "fizzled",
    status: "resolved",
    activity: "Never happened",
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 0);
});

test("returns only cleared plans when the group mixes every phase", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting", activity: "voting" });
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "moment",
    activity: "live",
    momentEndsAt: new Date(Date.now() + HOUR),
  });
  await insertEvent({ groupId: g, createdByUserId: u, phase: "fizzled", activity: "dead" });
  await insertEvent({ groupId: g, createdByUserId: u, phase: "cleared", activity: "Done deal" });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "Done deal");
});

test("a non-member of the group is FORBIDDEN", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const g = await makeGroup([member]);
  await insertEvent({
    groupId: g,
    createdByUserId: member,
    phase: "cleared",
    activity: "Members only",
  });

  await assert.rejects(
    () => caller(outsider).events.pastForGroup({ groupId: g }),
    (e) => e instanceof TRPCError && e.code === "FORBIDDEN",
  );
});

test("an unauthenticated caller is UNAUTHORIZED", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({ groupId: g, createdByUserId: u, phase: "cleared", activity: "x" });

  await assert.rejects(
    () => caller(null).events.pastForGroup({ groupId: g }),
    (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
  );
});

test("cleared plans from other groups never appear", async () => {
  const u = await makeUser();
  const mine = await makeGroup([u]);
  const other = await makeGroup([u]); // caller is a member of both; query is scoped to one group
  await insertEvent({ groupId: mine, createdByUserId: u, phase: "cleared", activity: "Mine" });
  await insertEvent({
    groupId: other,
    createdByUserId: u,
    phase: "cleared",
    activity: "Other group",
  });

  const out = await caller(u).events.pastForGroup({ groupId: mine });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "Mine");
});

test("does not leak a cleared plan from a group the caller does not belong to (when querying their own group)", async () => {
  const u = await makeUser();
  const stranger = await makeUser();
  const mine = await makeGroup([u]);
  const foreign = await makeGroup([stranger]);
  await insertEvent({
    groupId: foreign,
    createdByUserId: stranger,
    phase: "cleared",
    activity: "Secret",
  });
  await insertEvent({ groupId: mine, createdByUserId: u, phase: "cleared", activity: "Visible" });

  const out = await caller(u).events.pastForGroup({ groupId: mine });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "Visible");
});

test("a missing event in another group is irrelevant - the picker returns only this group's history", async () => {
  // Two groups each with one cleared plan; the picker scoped to one must not see the other's.
  const u = await makeUser();
  const a = await makeGroup([u]);
  const b = await makeGroup([u]);
  await insertEvent({ groupId: a, createdByUserId: u, phase: "cleared", activity: "A1" });
  await insertEvent({ groupId: a, createdByUserId: u, phase: "cleared", activity: "A2" });
  await insertEvent({ groupId: b, createdByUserId: u, phase: "cleared", activity: "B1" });

  const out = await caller(u).events.pastForGroup({ groupId: b });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "B1");
});

test("carries NO RSVP data and the old time is not presented as a new chosen time", async () => {
  const u = await makeUser();
  const other = await makeUser();
  const g = await makeGroup([u, other]);
  const oldTime = new Date(Date.now() - 5 * HOUR);
  const eid = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "Past dinner",
    location: "Cafe",
    startsAt: oldTime,
    chosenCandidateId: "c_old_winner",
  });
  // Real RSVPs existed on the cleared plan; none of them may carry over into the redo shell.
  await insertResponse(eid, u, "yes");
  await insertResponse(eid, other, "no");

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  const shell = out[0];
  // The shell exposes only the clonable text + lockTimes; no RSVP / going / response field.
  assert.deepEqual(Object.keys(shell).sort(), [
    "activity",
    "description",
    "id",
    "lastStartsAt",
    "location",
    "lockTimes",
  ]);
  // The old time is exposed only as the historical "lastStartsAt", never as a new chosen time field
  // the wizard would carry over (no startsAt / chosenStartsAt / chosenCandidateId on the shell).
  assert.equal("startsAt" in shell, false);
  assert.equal("chosenStartsAt" in shell, false);
  assert.equal("chosenCandidateId" in shell, false);
  assert.equal(shell.lastStartsAt, oldTime.toISOString());
});

test("preserves lockTimes=true so the wizard can reproduce a pinned-time history entry's flag", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "Locked-time redo",
    lockTimes: true,
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].lockTimes, true);
});

test("a time-only cleared plan that never named an activity yields an empty activity (client falls back)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({ groupId: g, createdByUserId: u, phase: "cleared", activity: "" });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "");
});

test("empty notes (description) come back as null", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "No notes",
    description: null,
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].description, null);
});

test("orders cleared plans most-recent-first", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const base = Date.now();
  // Insert out of chronological order to prove the ordering is computed, not insertion order.
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "middle",
    startsAt: new Date(base - 2 * HOUR),
  });
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "newest",
    startsAt: new Date(base - 1 * HOUR),
  });
  await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    activity: "oldest",
    startsAt: new Date(base - 3 * HOUR),
  });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.deepEqual(
    out.map((r) => r.activity),
    ["newest", "middle", "oldest"],
  );
});

test("caps the redo list at 20 most-recent cleared plans", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const base = Date.now();
  // 25 cleared plans, each an hour apart; the cap is 20 and must keep the newest 20.
  for (let i = 0; i < 25; i++) {
    await insertEvent({
      groupId: g,
      createdByUserId: u,
      phase: "cleared",
      activity: `plan ${i}`,
      // i=24 is the most recent (closest to base).
      startsAt: new Date(base - (25 - i) * HOUR),
    });
  }

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 20);
  // Newest first, and the 5 oldest (plan 0..4) are dropped by the cap.
  assert.equal(out[0].activity, "plan 24");
  assert.equal(out[19].activity, "plan 5");
  assert.equal(
    out.some((r) => r.activity === "plan 0"),
    false,
  );
});

test("a group with no cleared plans returns an empty list", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.deepEqual(out, []);
});

test("a member added after creation still sees the group's cleared history", async () => {
  const creator = await makeUser();
  const joiner = await makeUser();
  const g = await makeGroup([creator]);
  await insertEvent({
    groupId: g,
    createdByUserId: creator,
    phase: "cleared",
    activity: "Shared past",
  });
  await addMember(g, joiner);

  const out = await caller(joiner).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "Shared past");
});

test("trims surrounding whitespace from the carried activity name", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await insertEvent({ groupId: g, createdByUserId: u, phase: "cleared", activity: "  Padded  " });

  const out = await caller(u).events.pastForGroup({ groupId: g });

  assert.equal(out.length, 1);
  assert.equal(out[0].activity, "Padded");
});
