// events.setOptOut - a member bows out of a collecting plan ("I can't make it") or rejoins.
// Spec (ARCHITECTURE.md + CLAUDE.md + events.ts): opting out (out:true) clears the caller's
// reactions so they drop from the tally/quorum and inserts a private opt-out row; out:false
// reverses it. Only while collecting; non-member -> FORBIDDEN, missing event -> NOT_FOUND.
// The opt-out is private: no one else, not even the creator, ever sees who opted out.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  caller,
  candidateReactions,
  db,
  dropTestDb,
  eventOptOuts,
  insertActivityCandidate,
  insertEvent,
  insertReaction,
  insertTimeCandidate,
  makeGroup,
  makeUsers,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const FUTURE = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

async function reactionRowsFor(eventId: string, userId: string) {
  return db
    .select()
    .from(candidateReactions)
    .where(and(eq(candidateReactions.eventId, eventId), eq(candidateReactions.userId, userId)));
}

async function optOutRowsFor(eventId: string, userId: string) {
  return db
    .select()
    .from(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, eventId), eq(eventOptOuts.userId, userId)));
}

test("opting out inserts a private opt-out row for the caller", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  const res = await caller(member).events.setOptOut({ eventId, out: true });
  assert.deepEqual(res, { ok: true });

  const rows = await optOutRowsFor(eventId, member);
  assert.equal(rows.length, 1, "an opt-out row must exist for the caller");
});

test("opting out clears the caller's reactions so they drop from the tally", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });
  const timeCand = await insertTimeCandidate(eventId, FUTURE());
  const activityCand = await insertActivityCandidate(eventId, "Bowling");
  // The member has +1'd both a time and an activity candidate.
  await insertReaction(eventId, timeCand, member);
  await insertReaction(eventId, activityCand, member);

  await caller(member).events.setOptOut({ eventId, out: true });

  const remaining = await reactionRowsFor(eventId, member);
  assert.equal(remaining.length, 0, "all of the caller's reactions must be cleared on opt-out");
});

test("opting out drops the caller's +1 from the public candidate count", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });
  const timeCand = await insertTimeCandidate(eventId, FUTURE());
  // Both members +1 the same time candidate -> public count is 2.
  await insertReaction(eventId, timeCand, creator);
  await insertReaction(eventId, timeCand, member);

  const before = await caller(creator).events.get({ id: eventId });
  const beforeCount = before?.timeCandidates.find((c) => c.id === timeCand)?.count;
  assert.equal(beforeCount, 2, "both +1s should be counted before opt-out");

  await caller(member).events.setOptOut({ eventId, out: true });

  const afterView = await caller(creator).events.get({ id: eventId });
  const afterCount = afterView?.timeCandidates.find((c) => c.id === timeCand)?.count;
  assert.equal(afterCount, 1, "the opted-out member's +1 must drop from the public tally");
});

test("opting out only clears the caller's reactions, not other members'", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });
  const timeCand = await insertTimeCandidate(eventId, FUTURE());
  await insertReaction(eventId, timeCand, creator);
  await insertReaction(eventId, timeCand, member);

  await caller(member).events.setOptOut({ eventId, out: true });

  const creatorReactions = await reactionRowsFor(eventId, creator);
  assert.equal(creatorReactions.length, 1, "the creator's own +1 must be untouched");
});

test("out:false removes the opt-out row (rejoin)", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });
  await caller(member).events.setOptOut({ eventId, out: true });
  assert.equal((await optOutRowsFor(eventId, member)).length, 1);

  const res = await caller(member).events.setOptOut({ eventId, out: false });
  assert.deepEqual(res, { ok: true });

  const rows = await optOutRowsFor(eventId, member);
  assert.equal(rows.length, 0, "rejoining must delete the opt-out row");
});

test("opting out twice is idempotent (no duplicate row, no error)", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await caller(member).events.setOptOut({ eventId, out: true });
  const res = await caller(member).events.setOptOut({ eventId, out: true });
  assert.deepEqual(res, { ok: true }, "a second opt-out must succeed");

  const rows = await optOutRowsFor(eventId, member);
  assert.equal(rows.length, 1, "opting out twice must not create a duplicate opt-out row");
});

test("out:false when not opted out is a harmless no-op", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  const res = await caller(member).events.setOptOut({ eventId, out: false });
  assert.deepEqual(res, { ok: true });
  assert.equal((await optOutRowsFor(eventId, member)).length, 0);
});

test("a non-member is FORBIDDEN from opting out", async () => {
  const [creator, outsider] = await makeUsers(2);
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await assert.rejects(
    () => caller(outsider).events.setOptOut({ eventId, out: true }),
    (e) => e instanceof TRPCError && e.code === "FORBIDDEN",
  );
  // and nothing was written for the outsider
  assert.equal((await optOutRowsFor(eventId, outsider)).length, 0);
});

test("a missing event is NOT_FOUND (checked before membership)", async () => {
  const [member] = await makeUsers(1);
  await assert.rejects(
    () => caller(member).events.setOptOut({ eventId: "e_does_not_exist", out: true }),
    (e) => e instanceof TRPCError && e.code === "NOT_FOUND",
  );
});

test("opting out is rejected once the plan is past collecting (moment)", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    momentEndsAt: FUTURE(),
  });

  await assert.rejects(
    () => caller(member).events.setOptOut({ eventId, out: true }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  assert.equal((await optOutRowsFor(eventId, member)).length, 0);
});

test("opting out is rejected once the plan is cleared", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "cleared",
    status: "resolved",
  });

  await assert.rejects(
    () => caller(member).events.setOptOut({ eventId, out: true }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
});

test("an unauthenticated caller is UNAUTHORIZED", async () => {
  const [creator] = await makeUsers(1);
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await assert.rejects(
    () => caller(null).events.setOptOut({ eventId, out: true }),
    (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
  );
});

test("the opt-out is private: another member's events.get never reveals who opted out", async () => {
  const [creator, optedOutMember, observer] = await makeUsers(3);
  const groupId = await makeGroup([creator, optedOutMember, observer]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await caller(optedOutMember).events.setOptOut({ eventId, out: true });

  // The observer (a different member) fetches the plan. Nothing in the returned view should
  // expose another member's opt-out: their own iOptedOut is false, and the opted-out member must
  // not appear as declined or be otherwise singled out in any returned collection.
  const view = await caller(observer).events.get({ id: eventId });
  assert.ok(view, "the plan should be visible to a member");
  assert.equal(view.iOptedOut, false, "iOptedOut reflects only the caller, not another member");

  const serialized = JSON.stringify(view);
  // No field should carry an "optedOut" list, and the opted-out member's id must not be tagged
  // anywhere as declined/out. The only place ids legitimately appear is the members roster (for
  // conditional RSVP targeting), so check there is no status leak by scanning the members entries.
  const memberEntry = view.members.find((m) => m.id === optedOutMember);
  if (memberEntry) {
    assert.deepEqual(
      Object.keys(memberEntry).sort(),
      ["id", "name"],
      "a member roster entry must not carry any opt-out/status flag",
    );
  }
  // Defensive: the serialized view must not contain an explicit opt-out marker key.
  assert.ok(
    !/"optedOut"|"optOuts"|"whoOptedOut"|"declinedBy"/.test(serialized),
    "the view must not serialize any who-opted-out marker",
  );
});

test("the opt-out is private: the creator's events.get does not reveal the member opted out", async () => {
  const [creator, optedOutMember] = await makeUsers(2);
  const groupId = await makeGroup([creator, optedOutMember]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await caller(optedOutMember).events.setOptOut({ eventId, out: true });

  const creatorView = await caller(creator).events.get({ id: eventId });
  assert.ok(creatorView);
  assert.equal(
    creatorView.iOptedOut,
    false,
    "the creator did not opt out, so their own iOptedOut is false",
  );
  const entry = creatorView.members.find((m) => m.id === optedOutMember);
  if (entry) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["id", "name"],
      "even the creator must not learn a member opted out from the member roster",
    );
  }
});

test("the opt-out is private: another member's events.mine does not surface the opt-out", async () => {
  const [creator, optedOutMember, observer] = await makeUsers(3);
  const groupId = await makeGroup([creator, optedOutMember, observer]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await caller(optedOutMember).events.setOptOut({ eventId, out: true });

  // The observer's dashboard for the plan reflects only the observer (still "reacting"), never the
  // opted-out member's declined status.
  const observerMine = await caller(observer).events.mine();
  const card = observerMine.find((c) => c.id === eventId);
  assert.ok(card, "the collecting plan should appear on a member's dashboard");
  assert.equal(card.myStatus, "reacting", "the observer has not opted out, so they are reacting");

  const serialized = JSON.stringify(card);
  assert.ok(
    !/"optedOut"|"optOuts"|"whoOptedOut"|"declinedBy"/.test(serialized),
    "a dashboard card must not serialize any who-opted-out marker",
  );
});

test("the opted-out member sees their own status reflected as declined (their own view only)", async () => {
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    decidesBy: FUTURE(),
  });

  await caller(member).events.setOptOut({ eventId, out: true });

  // The member's OWN view reflects their opt-out (this is private to them, not leaked to others).
  const own = await caller(member).events.get({ id: eventId });
  assert.ok(own);
  assert.equal(own.iOptedOut, true, "the opted-out member sees their own iOptedOut as true");
  assert.equal(own.myStatus, "declined", "an opted-out member reads as declined in their own view");
});

// ----- a late opt-out settles first: collecting is over once decidesBy has passed (A1) -----

test("opting out after decidesBy has passed is rejected (the write path settles the stale plan)", async () => {
  // The stored phase is still `collecting`, but its decides-by deadline has passed and no read has
  // settled it yet. The write must settle lazily like a read does, so the late opt-out is rejected.
  const [creator, member] = await makeUsers(2);
  const groupId = await makeGroup([creator, member]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
    quorum: 1,
    decidesBy: new Date(Date.now() - 60_000), // deadline passed, never read since
  });
  const c = await insertTimeCandidate(eventId, FUTURE());
  await insertReaction(eventId, c, member); // a +1 so the plan auto-locks (not fizzle) on settle

  await assert.rejects(
    () => caller(member).events.setOptOut({ eventId, out: true }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  const rows = await optOutRowsFor(eventId, member);
  assert.equal(rows.length, 0, "no opt-out is recorded once the plan has stopped collecting");
});
