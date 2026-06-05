// Integration tests for events.addCandidate. Assertions are derived from the SPEC
// (ARCHITECTURE.md + CLAUDE.md + the lane brief), not from the implementation:
//
//  - A locked axis is vote-only: lockTimes rejects a new TIME candidate, lockActivity
//    rejects a new ACTIVITY candidate, each FORBIDDEN.
//  - Adding a duplicate +1s the existing row and returns its id (no new row): TIME dedupe
//    is minute-exact; ACTIVITY dedupe is case-insensitive + trimmed.
//  - A TIME before the plan's decidesBy is rejected; a TIME past the addCandidateHorizon is
//    rejected.
//  - A blank activity label (after trim) is rejected.
//  - Adds are allowed only while collecting; a non-member is FORBIDDEN; a missing event is
//    NOT_FOUND (checked before membership).

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { addCandidateHorizon, DAY_MS, MOMENT_MS } from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  caller,
  candidateReactions,
  db,
  dropTestDb,
  eventCandidates,
  insertActivityCandidate,
  insertEvent,
  insertTimeCandidate,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const isCode = (code: string) => (err: unknown) => err instanceof TRPCError && err.code === code;

// A collecting plan whose decidesBy is comfortably in the future, with a member and a
// creator both in the group. Returns the ids the tests need.
async function collectingPlan(
  over: Partial<Parameters<typeof insertEvent>[0]> = {},
): Promise<{ creator: string; member: string; groupId: string; eventId: string }> {
  const creator = await makeUser();
  const member = await makeUser();
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    // a near-term deadline so a candidate added days out comfortably clears it; tests that
    // probe the decidesBy bound pass their own larger value.
    decidesBy: new Date(Date.now() + MOMENT_MS),
    ...over,
  });
  return { creator, member, groupId, eventId };
}

// All candidate rows for an event, used to assert no duplicate row was inserted.
async function candidateRows(eventId: string) {
  return db.select().from(eventCandidates).where(eq(eventCandidates.eventId, eventId));
}

async function reactionCount(eventId: string, candidateId: string): Promise<number> {
  const rows = await db
    .select()
    .from(candidateReactions)
    .where(
      and(eq(candidateReactions.eventId, eventId), eq(candidateReactions.candidateId, candidateId)),
    );
  return rows.length;
}

// ----- locked-axis gating (per kind) -----

test("lockTimes rejects a new TIME candidate with FORBIDDEN", async () => {
  const { member, eventId } = await collectingPlan({ lockTimes: true });
  // a time the creator already pinned, so the locked time axis is non-empty
  await insertTimeCandidate(eventId, new Date(Date.now() + 3 * DAY_MS));

  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "time",
        startsAt: new Date(Date.now() + 4 * DAY_MS).toISOString(),
      }),
    isCode("FORBIDDEN"),
  );
});

test("lockTimes does NOT block adding an ACTIVITY candidate", async () => {
  // Locks are per-axis: a time lock leaves the (open) activity list editable.
  const { member, eventId } = await collectingPlan({ lockTimes: true });
  await insertTimeCandidate(eventId, new Date(Date.now() + 3 * DAY_MS));

  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "activity",
    text: "Bowling",
  });
  assert.ok(id, "an activity add should succeed while only times are locked");
});

test("lockActivity rejects a new ACTIVITY candidate with FORBIDDEN", async () => {
  const { member, eventId } = await collectingPlan({ lockActivity: true });
  await insertActivityCandidate(eventId, "Dinner");

  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "activity",
        text: "Bowling",
      }),
    isCode("FORBIDDEN"),
  );
});

test("lockActivity does NOT block adding a TIME candidate", async () => {
  const { member, eventId } = await collectingPlan({ lockActivity: true });
  await insertActivityCandidate(eventId, "Dinner");

  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "time",
    startsAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
  });
  assert.ok(id, "a time add should succeed while only the activity is locked");
});

// ----- TIME dedupe -----

test("adding a TIME equal to an existing candidate +1s the existing row and returns its id", async () => {
  const { member, eventId } = await collectingPlan();
  const when = new Date(Date.now() + 3 * DAY_MS);
  const existing = await insertTimeCandidate(eventId, when);

  const before = await candidateRows(eventId);
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "time",
    startsAt: when.toISOString(),
  });

  assert.equal(id, existing, "dedupe must return the existing candidate's id");
  const after = await candidateRows(eventId);
  assert.equal(after.length, before.length, "no new row should be inserted on a dup");
  assert.equal(
    await reactionCount(eventId, existing),
    1,
    "the dedupe should +1 the existing candidate for the author",
  );
});

// Regression: TIME dedupe is minute-exact (events.ts compares minute buckets, matching its own
// "dedupe by minute" contract), so a same-minute add (different second) +1s the existing slot.
test("TIME dedupe is minute-exact: a same-minute time +1s the existing row", async () => {
  // The wizard sends minute-precision times; the spec calls TIME dedupe "minute-exact",
  // so a candidate at HH:MM:00 and a new add at HH:MM:30 are the same slot. A second,
  // later candidate widens the horizon so the same-minute add is not rejected as out-of-window.
  const { member, eventId } = await collectingPlan();
  const base = Date.now() + 3 * DAY_MS;
  const onTheMinute = new Date(Math.floor(base / 60000) * 60000); // HH:MM:00.000
  const existing = await insertTimeCandidate(eventId, onTheMinute);
  await insertTimeCandidate(eventId, new Date(onTheMinute.getTime() + DAY_MS)); // widen the spread

  const before = await candidateRows(eventId);
  const sameMinute = new Date(onTheMinute.getTime() + 30_000); // +30s, same minute
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "time",
    startsAt: sameMinute.toISOString(),
  });

  assert.equal(id, existing, "a same-minute time must dedupe to the existing slot");
  const after = await candidateRows(eventId);
  assert.equal(after.length, before.length, "no new row for a same-minute time");
});

test("a TIME in a DIFFERENT minute is a new candidate (not deduped)", async () => {
  const { member, eventId } = await collectingPlan();
  const base = new Date(Math.floor((Date.now() + 3 * DAY_MS) / 60000) * 60000);
  const existing = await insertTimeCandidate(eventId, base);
  await insertTimeCandidate(eventId, new Date(base.getTime() + DAY_MS)); // widen the spread

  const before = await candidateRows(eventId);
  const nextMinute = new Date(base.getTime() + 60_000);
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "time",
    startsAt: nextMinute.toISOString(),
  });

  assert.notEqual(id, existing, "a distinct minute is a distinct candidate");
  const after = await candidateRows(eventId);
  assert.equal(after.length, before.length + 1, "a distinct time inserts a new row");
});

// ----- ACTIVITY dedupe -----

test("ACTIVITY dedupe is case-insensitive and trimmed: returns the existing row's id", async () => {
  const { member, eventId } = await collectingPlan();
  const existing = await insertActivityCandidate(eventId, "Bowling");

  const before = await candidateRows(eventId);
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "activity",
    text: "  bOwLiNg  ",
  });

  assert.equal(id, existing, "a case/space variant must dedupe to the existing activity");
  const after = await candidateRows(eventId);
  assert.equal(after.length, before.length, "no new row for a case/space variant");
  assert.equal(
    await reactionCount(eventId, existing),
    1,
    "the dedupe should +1 the existing activity for the author",
  );
});

test("a genuinely different ACTIVITY label inserts a new candidate", async () => {
  const { member, eventId } = await collectingPlan();
  const existing = await insertActivityCandidate(eventId, "Bowling");

  const before = await candidateRows(eventId);
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "activity",
    text: "Dinner",
  });

  assert.notEqual(id, existing, "a different label is a new candidate");
  const after = await candidateRows(eventId);
  assert.equal(after.length, before.length + 1, "a new label inserts a new row");
});

// ----- TIME window bounds -----

test("a TIME at or before decidesBy is rejected (BAD_REQUEST)", async () => {
  const decidesBy = new Date(Date.now() + 2 * DAY_MS);
  const { member, eventId } = await collectingPlan({ decidesBy });
  // an existing time so the plan is a sane collecting plan
  await insertTimeCandidate(eventId, new Date(decidesBy.getTime() + 3 * DAY_MS));

  // strictly before
  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "time",
        startsAt: new Date(decidesBy.getTime() - MOMENT_MS).toISOString(),
      }),
    isCode("BAD_REQUEST"),
  );
  // exactly at the deadline: still rejected (the slot must remain a live choice when we lock)
  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "time",
        startsAt: decidesBy.toISOString(),
      }),
    isCode("BAD_REQUEST"),
  );
});

test("a TIME past the addCandidateHorizon is rejected; one within it is accepted", async () => {
  const { member, eventId } = await collectingPlan();
  // a tight existing spread so the horizon is concrete and small
  const earliest = new Date(Date.now() + 3 * DAY_MS);
  const latest = new Date(earliest.getTime() + 2 * MOMENT_MS); // 2h spread -> horizon = latest + 2h
  await insertTimeCandidate(eventId, earliest);
  await insertTimeCandidate(eventId, latest);

  const horizonMs = addCandidateHorizon(earliest.getTime(), latest.getTime());

  // just past the horizon -> rejected
  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "time",
        startsAt: new Date(horizonMs + 60_000).toISOString(),
      }),
    isCode("BAD_REQUEST"),
  );

  // at the horizon -> accepted (the bound is inclusive)
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "time",
    startsAt: new Date(horizonMs).toISOString(),
  });
  assert.ok(id, "a time exactly at the horizon should be allowed");
});

// ----- blank activity -----

test("a whitespace-only activity label is rejected (BAD_REQUEST)", async () => {
  const { member, eventId } = await collectingPlan();
  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "activity",
        text: "   ",
      }),
    isCode("BAD_REQUEST"),
  );
});

// ----- phase gating + access boundary -----

test("adding a candidate is rejected unless the plan is collecting (moment)", async () => {
  const { member, eventId } = await collectingPlan({
    phase: "moment",
    momentEndsAt: new Date(Date.now() + DAY_MS),
  });

  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "activity",
        text: "Dinner",
      }),
    isCode("BAD_REQUEST"),
  );
});

test("adding a candidate is rejected on a cleared plan", async () => {
  const { member, eventId } = await collectingPlan({ phase: "cleared", status: "resolved" });

  await assert.rejects(
    () =>
      caller(member).events.addCandidate({
        eventId,
        kind: "activity",
        text: "Dinner",
      }),
    isCode("BAD_REQUEST"),
  );
});

test("a non-member cannot add a candidate (FORBIDDEN)", async () => {
  const { eventId } = await collectingPlan();
  const outsider = await makeUser();

  await assert.rejects(
    () =>
      caller(outsider).events.addCandidate({
        eventId,
        kind: "activity",
        text: "Dinner",
      }),
    isCode("FORBIDDEN"),
  );
});

test("a missing event is NOT_FOUND, checked before membership", async () => {
  // An unauthenticated-of-the-group user adding to a non-existent event should hit the
  // missing-event guard first (NOT_FOUND), not the membership guard.
  const outsider = await makeUser();
  await assert.rejects(
    () =>
      caller(outsider).events.addCandidate({
        eventId: "e_does_not_exist",
        kind: "activity",
        text: "Dinner",
      }),
    isCode("NOT_FOUND"),
  );
});

test("an added candidate becomes the author's own +1 (adding implies reacting)", async () => {
  const { member, eventId } = await collectingPlan();
  const { id } = await caller(member).events.addCandidate({
    eventId,
    kind: "activity",
    text: "Karaoke",
  });
  assert.equal(
    await reactionCount(eventId, id),
    1,
    "a newly added candidate must carry the author's +1",
  );
});
