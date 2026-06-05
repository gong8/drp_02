// Integration tests for events.lock - the creator-only transition that closes a collecting round
// and opens the blind moment on a winning TIME slot, optionally naming the plan from the winning
// ACTIVITY candidate. Expectations are derived from ARCHITECTURE.md + CLAUDE.md + the unified-suggest
// spec, NOT from the current implementation's output.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { MOMENT_MS } from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  caller,
  db,
  dropTestDb,
  events,
  insertActivityCandidate,
  insertEvent,
  insertReaction,
  insertTimeCandidate,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isTrpc(code: string) {
  return (e: unknown) => e instanceof TRPCError && e.code === code;
}

async function eventRow(id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row;
}

// A collecting plan owned by `creator`, with one or more future TIME candidates so lock has
// something to settle. Returns the event id and the time-candidate ids in insertion order.
async function collectingPlan(opts: {
  creator: string;
  groupId: string;
  times: Date[];
  activity?: string;
}): Promise<{ eventId: string; timeIds: string[] }> {
  const eventId = await insertEvent({
    groupId: opts.groupId,
    createdByUserId: opts.creator,
    phase: "collecting",
    contingent: true,
    quorum: 2,
    activity: opts.activity ?? "",
  });
  const timeIds: string[] = [];
  for (const t of opts.times) timeIds.push(await insertTimeCandidate(eventId, t));
  return { eventId, timeIds };
}

// ----- access boundary -----

test("a non-member is FORBIDDEN from locking", async () => {
  const creator = await makeUser();
  const outsider = await makeUser();
  const groupId = await makeGroup([creator]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
  });
  await assert.rejects(() => caller(outsider).events.lock({ eventId }), isTrpc("FORBIDDEN"));
});

test("a missing event is NOT_FOUND, even for a non-member (checked before membership)", async () => {
  const outsider = await makeUser();
  await assert.rejects(
    () => caller(outsider).events.lock({ eventId: "e_does_not_exist" }),
    isTrpc("NOT_FOUND"),
  );
});

test("an unauthenticated caller is UNAUTHORIZED", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
  });
  await assert.rejects(() => caller(null).events.lock({ eventId }), isTrpc("UNAUTHORIZED"));
});

test("a non-creator member is FORBIDDEN from locking (only the creator may lock)", async () => {
  const creator = await makeUser();
  const member = await makeUser();
  const groupId = await makeGroup([creator, member]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
  });
  await assert.rejects(() => caller(member).events.lock({ eventId }), isTrpc("FORBIDDEN"));
  // The plan must be untouched after a rejected lock.
  const row = await eventRow(eventId);
  assert.equal(row.phase, "collecting");
});

// ----- phase + precondition guards -----

test("locking a non-collecting plan (moment) is BAD_REQUEST", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    momentEndsAt: new Date(Date.now() + HOUR),
  });
  await assert.rejects(() => caller(creator).events.lock({ eventId }), isTrpc("BAD_REQUEST"));
});

test("locking a cleared plan is BAD_REQUEST", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "cleared",
  });
  await assert.rejects(() => caller(creator).events.lock({ eventId }), isTrpc("BAD_REQUEST"));
});

test("locking a collecting plan with no time candidates is BAD_REQUEST", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  // Activity candidates only, no time candidate to settle a moment window on.
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
  });
  await insertActivityCandidate(eventId, "Bowling");
  await assert.rejects(() => caller(creator).events.lock({ eventId }), isTrpc("BAD_REQUEST"));
  const row = await eventRow(eventId);
  assert.equal(row.phase, "collecting");
});

// ----- the basic happy path: moment opens on the chosen slot -----

test("locking moves the plan to the moment phase", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
  });
  const res = await caller(creator).events.lock({ eventId });
  assert.equal(res.ok, true);
  const row = await eventRow(eventId);
  assert.equal(row.phase, "moment");
});

// ----- winning TIME candidate: most +1s wins -----

test("the most-+1'd TIME candidate becomes the chosen slot", async () => {
  const [creator, a, b, c] = [
    await makeUser(),
    await makeUser(),
    await makeUser(),
    await makeUser(),
  ];
  const groupId = await makeGroup([creator, a, b, c]);
  const t1 = new Date(Date.now() + 1 * DAY);
  const t2 = new Date(Date.now() + 2 * DAY);
  const { eventId, timeIds } = await collectingPlan({ creator, groupId, times: [t1, t2] });
  const [id1, id2] = timeIds;
  // t2 gets more support than t1.
  await insertReaction(eventId, id1, a);
  await insertReaction(eventId, id2, a);
  await insertReaction(eventId, id2, b);
  await insertReaction(eventId, id2, c);

  const res = await caller(creator).events.lock({ eventId });
  assert.equal(res.chosenCandidateId, id2);
  const row = await eventRow(eventId);
  assert.equal(row.chosenCandidateId, id2);
  assert.equal(row.startsAt.getTime(), t2.getTime());
});

test("a tie on TIME +1s breaks to the EARLIEST time", async () => {
  const [creator, a, b] = [await makeUser(), await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a, b]);
  const earlier = new Date(Date.now() + 1 * DAY);
  const later = new Date(Date.now() + 3 * DAY);
  // Insert the LATER candidate first so the win cannot be an artifact of insertion order.
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    quorum: 2,
  });
  const laterId = await insertTimeCandidate(eventId, later);
  const earlierId = await insertTimeCandidate(eventId, earlier);
  // Both get exactly one +1: a tie.
  await insertReaction(eventId, laterId, a);
  await insertReaction(eventId, earlierId, b);

  const res = await caller(creator).events.lock({ eventId });
  assert.equal(res.chosenCandidateId, earlierId);
  const row = await eventRow(eventId);
  assert.equal(row.startsAt.getTime(), earlier.getTime());
});

// ----- explicit candidateId handling -----

test("an explicit valid TIME candidateId is honored over the most-voted", async () => {
  const [creator, a, b] = [await makeUser(), await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a, b]);
  const t1 = new Date(Date.now() + 1 * DAY);
  const t2 = new Date(Date.now() + 2 * DAY);
  const { eventId, timeIds } = await collectingPlan({ creator, groupId, times: [t1, t2] });
  const [id1, id2] = timeIds;
  // The crowd prefers id2, but the creator explicitly picks id1.
  await insertReaction(eventId, id2, a);
  await insertReaction(eventId, id2, b);

  const res = await caller(creator).events.lock({ eventId, candidateId: id1 });
  assert.equal(res.chosenCandidateId, id1);
  const row = await eventRow(eventId);
  assert.equal(row.startsAt.getTime(), t1.getTime());
});

test("an explicit candidateId that is not a TIME candidate of this event falls back to most-voted", async () => {
  const [creator, a, b] = [await makeUser(), await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a, b]);
  const t1 = new Date(Date.now() + 1 * DAY);
  const t2 = new Date(Date.now() + 2 * DAY);
  const { eventId, timeIds } = await collectingPlan({ creator, groupId, times: [t1, t2] });
  const [_id1, id2] = timeIds;
  await insertReaction(eventId, id2, a);
  await insertReaction(eventId, id2, b);

  // A bogus id that is not a candidate of this event -> fall back to the most-voted (id2).
  const res = await caller(creator).events.lock({ eventId, candidateId: "c_not_here" });
  assert.equal(res.chosenCandidateId, id2);
});

test("an explicit ACTIVITY candidateId is not a valid TIME slot, so lock falls back to most-voted TIME", async () => {
  const [creator, a] = [await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a]);
  const t1 = new Date(Date.now() + 1 * DAY);
  const t2 = new Date(Date.now() + 2 * DAY);
  const { eventId, timeIds } = await collectingPlan({ creator, groupId, times: [t1, t2] });
  const [, id2] = timeIds;
  const activityId = await insertActivityCandidate(eventId, "Dinner");
  await insertReaction(eventId, id2, a); // id2 is the most-voted TIME

  // Passing an ACTIVITY candidate's id must NOT be accepted as the time slot.
  const res = await caller(creator).events.lock({ eventId, candidateId: activityId });
  assert.equal(res.chosenCandidateId, id2);
  const row = await eventRow(eventId);
  assert.notEqual(row.chosenCandidateId, activityId);
  assert.equal(row.startsAt.getTime(), t2.getTime());
});

// ----- winning ACTIVITY -> the plan's name, only when none is set -----

test("the most-+1'd ACTIVITY candidate becomes the plan's activity when none is set", async () => {
  const [creator, a, b] = [await makeUser(), await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a, b]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
    activity: "", // unnamed plan
  });
  const bowling = await insertActivityCandidate(eventId, "Bowling");
  const dinner = await insertActivityCandidate(eventId, "Dinner");
  // Dinner wins the activity vote.
  await insertReaction(eventId, bowling, a);
  await insertReaction(eventId, dinner, a);
  await insertReaction(eventId, dinner, b);

  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.equal(row.activity, "Dinner");
});

test("lock does NOT overwrite an activity that is already set (e.g. a member edited it)", async () => {
  const [creator, a, b] = [await makeUser(), await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a, b]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
    activity: "Karaoke night", // already named
  });
  const dinner = await insertActivityCandidate(eventId, "Dinner");
  await insertReaction(eventId, dinner, a);
  await insertReaction(eventId, dinner, b);

  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.equal(row.activity, "Karaoke night");
});

test("with no activity candidates and no activity set, the activity stays empty after lock", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + DAY)],
    activity: "",
  });
  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.equal(row.activity, "");
});

// ----- moment window: momentEndsAt / startsAt set from the chosen time + reply-by -----

test("momentStartsAt is set to now and momentEndsAt sits after it", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const before = Date.now();
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + 4 * DAY)],
  });
  await caller(creator).events.lock({ eventId });
  const after = Date.now();
  const row = await eventRow(eventId);

  assert.ok(row.momentStartsAt, "momentStartsAt must be set");
  assert.ok(
    row.momentStartsAt.getTime() >= before && row.momentStartsAt.getTime() <= after,
    "momentStartsAt should be the lock instant (now)",
  );
  assert.ok(row.momentEndsAt, "momentEndsAt must be set");
  assert.ok(
    row.momentEndsAt.getTime() > row.momentStartsAt.getTime(),
    "the moment must have a real open window",
  );
});

test("momentEndsAt never runs past the chosen event time", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventTime = new Date(Date.now() + 3 * DAY);
  const { eventId } = await collectingPlan({ creator, groupId, times: [eventTime] });
  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.ok(
    (row.momentEndsAt as Date).getTime() <= eventTime.getTime(),
    "the RSVP window must close no later than the event itself",
  );
});

test("respondByAt is aligned to the moment window end", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + 5 * DAY)],
  });
  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.equal(
    row.respondByAt.getTime(),
    (row.momentEndsAt as Date).getTime(),
    "respondByAt should equal momentEndsAt after lock",
  );
});

test("a creator-set replyBy is honored as the moment's close when it is in range", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventTime = new Date(Date.now() + 5 * DAY);
  // A reply-by comfortably inside (now, event) and at least one moment past the open.
  const replyBy = new Date(Date.now() + 3 * DAY);
  const { eventId } = await collectingPlan({ creator, groupId, times: [eventTime] });
  await db.update(events).set({ replyBy }).where(eq(events.id, eventId));

  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.equal(
    (row.momentEndsAt as Date).getTime(),
    replyBy.getTime(),
    "an in-range creator reply-by should be the moment close",
  );
});

test("the chosen TIME slot, not the earliest candidate, anchors startsAt and the moment window", async () => {
  const [creator, a, b] = [await makeUser(), await makeUser(), await makeUser()];
  const groupId = await makeGroup([creator, a, b]);
  const t1 = new Date(Date.now() + 2 * DAY);
  const t2 = new Date(Date.now() + 6 * DAY);
  const { eventId, timeIds } = await collectingPlan({ creator, groupId, times: [t1, t2] });
  const [, id2] = timeIds;
  // t2 wins on votes even though t1 is earlier.
  await insertReaction(eventId, id2, a);
  await insertReaction(eventId, id2, b);

  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  assert.equal(row.startsAt.getTime(), t2.getTime());
  // The moment window is built from the chosen (t2), so it can sit later than t1.
  assert.ok((row.momentEndsAt as Date).getTime() <= t2.getTime());
  assert.ok((row.momentEndsAt as Date).getTime() > t1.getTime());
});

// ----- a late lock settles first; a double lock never resets the moment window (A1 + A2) -----

test("locking after decidesBy has passed is rejected (the write path settles the stale plan)", async () => {
  // The stored phase is still `collecting` (no read has settled it), but its decides-by deadline has
  // passed. A manual lock must settle lazily like a read does: the plan has already auto-locked into
  // a moment, so a second (manual) lock is rejected with BAD_REQUEST.
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    quorum: 1,
    decidesBy: new Date(Date.now() - 60_000), // deadline passed, never read since
  });
  const t = await insertTimeCandidate(eventId, new Date(Date.now() + DAY));
  await insertReaction(eventId, t, creator); // a +1 so settle auto-locks (does not fizzle)

  await assert.rejects(() => caller(creator).events.lock({ eventId }), isTrpc("BAD_REQUEST"));
  // The auto-lock already ran on the write path, so the plan is in the moment phase.
  const row = await eventRow(eventId);
  assert.equal(row.phase, "moment");
});

test("a second concurrent lock does not reset the moment window of the first (A2)", async () => {
  // Two creators-cannot-happen, but two racing locks (or a lock racing an auto-lock) must not
  // double-transition: the phase-guarded UPDATE means only the first lock writes the moment window;
  // the loser serves the existing chosen slot instead of clobbering momentStartsAt/momentEndsAt.
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const { eventId } = await collectingPlan({
    creator,
    groupId,
    times: [new Date(Date.now() + 4 * DAY)],
  });

  const first = await caller(creator).events.lock({ eventId });
  const firstRow = await eventRow(eventId);
  const firstStart = (firstRow.momentStartsAt as Date).getTime();
  const firstEnd = (firstRow.momentEndsAt as Date).getTime();

  // A second lock attempt on the (now moment) plan is rejected outright (phase guard),
  const second = await caller(creator)
    .events.lock({ eventId })
    .then(
      () => "ok",
      (err) => (err instanceof TRPCError ? err.code : "other"),
    );
  assert.equal(second, "BAD_REQUEST", "a lock on an already-locked plan is rejected");

  // and the window the first lock set is untouched.
  const afterRow = await eventRow(eventId);
  assert.equal(first.ok, true);
  assert.equal(afterRow.chosenCandidateId, firstRow.chosenCandidateId);
  assert.equal((afterRow.momentStartsAt as Date).getTime(), firstStart);
  assert.equal((afterRow.momentEndsAt as Date).getTime(), firstEnd);
});

// ----- a degenerate near-now event still gets a real (short) moment window -----

test("an event time already in the past still opens a minimal MOMENT_MS window", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  // A collecting plan whose only time candidate is in the past (e.g. nobody locked in time).
  const pastTime = new Date(Date.now() - HOUR);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    quorum: 2,
  });
  await insertTimeCandidate(eventId, pastTime);

  const beforeLock = Date.now();
  await caller(creator).events.lock({ eventId });
  const row = await eventRow(eventId);
  // resolveMomentEnd: eventMs <= openMs -> open + MOMENT_MS, so the moment is open for a full hour.
  const start = (row.momentStartsAt as Date).getTime();
  assert.ok(start >= beforeLock);
  assert.equal((row.momentEndsAt as Date).getTime(), start + MOMENT_MS);
});
