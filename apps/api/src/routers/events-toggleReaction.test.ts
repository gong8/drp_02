// events.toggleReaction - the public +1 toggle during collecting.
//
// Spec (ARCHITECTURE.md "Privacy boundary"; CLAUDE.md unified suggest flow; lane brief):
//   - A member toggles their single public +1 on ONE candidate (either TIME or ACTIVITY kind)
//     while the plan is `collecting`. First call adds the caller's reaction row; a second call on
//     the same candidate removes it (idempotent on/off).
//   - Per-candidate +1 COUNTS are public (momentum) and surfaced via events.get for both lists,
//     but voter NAMES are never exposed (only the count and the caller's own `mine` flag).
//   - The candidate must belong to the event -> NOT_FOUND otherwise.
//   - Reactions are only collected during `collecting`; any other phase -> BAD_REQUEST.
//   - A +1 rejoins a member who had opted out: their event_opt_outs row is deleted (a reaction and
//     an opt-out are mutually exclusive).
//   - requireMember is the access boundary: a non-member -> FORBIDDEN, a missing event -> NOT_FOUND
//     (the event is fetched, and 404s, BEFORE membership is checked).
//   - An unauthenticated caller -> UNAUTHORIZED.
//
// Every expected outcome here is derived from that spec, not from the implementation's output.

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
  insertOptOut,
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

function isCode(code: string) {
  return (e: unknown): e is TRPCError => e instanceof TRPCError && e.code === code;
}

// Count the caller's own reaction rows on a candidate (a +1 is one row per (candidate, user)).
async function reactionRows(candidateId: string, userId: string) {
  return db
    .select()
    .from(candidateReactions)
    .where(
      and(eq(candidateReactions.candidateId, candidateId), eq(candidateReactions.userId, userId)),
    );
}

// The public +1 count of a time candidate, as exposed to ANY member through events.get.
async function publicTimeCount(viewerId: string, eventId: string, candidateId: string) {
  const view = await caller(viewerId).events.get({ id: eventId });
  assert.ok(view, "events.get should return the plan");
  const c = view.timeCandidates.find((t) => t.id === candidateId);
  assert.ok(c, "the time candidate should be present in the view");
  return c.count;
}

test("first toggle adds the caller's +1 row on a time candidate during collecting", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  const res = await caller(u).events.toggleReaction({ eventId: e, candidateId: c });

  assert.equal(res.reacted, true, "adding a +1 reports reacted: true");
  const rows = await reactionRows(c, u);
  assert.equal(rows.length, 1, "exactly one reaction row should exist after the first toggle");
});

test("a second toggle on the same candidate removes the +1 (idempotent on/off)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  const first = await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  const second = await caller(u).events.toggleReaction({ eventId: e, candidateId: c });

  assert.equal(first.reacted, true, "first toggle adds");
  assert.equal(second.reacted, false, "second toggle removes");
  const rows = await reactionRows(c, u);
  assert.equal(rows.length, 0, "no reaction row should remain after toggling off");
});

test("a third toggle re-adds the +1 (toggle is symmetric)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  const third = await caller(u).events.toggleReaction({ eventId: e, candidateId: c });

  assert.equal(third.reacted, true, "toggling a removed +1 re-adds it");
  assert.equal((await reactionRows(c, u)).length, 1, "one reaction row again");
});

test("the public count seen via events.get tracks the toggle on/off", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  assert.equal(await publicTimeCount(u, e, c), 0, "no +1s before toggling");
  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  assert.equal(await publicTimeCount(u, e, c), 1, "count is 1 after a +1");
  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  assert.equal(await publicTimeCount(u, e, c), 0, "count is back to 0 after toggling off");
});

test("a member can toggle a +1 on an ACTIVITY candidate too (both lists are react-able)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertActivityCandidate(e, "Bowling");

  const res = await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  assert.equal(res.reacted, true);

  const view = await caller(u).events.get({ id: e });
  assert.ok(view);
  const ac = view.activityCandidates.find((a) => a.id === c);
  assert.ok(ac, "the activity candidate should appear in the view");
  assert.equal(ac.count, 1, "the activity candidate's public +1 count is 1");
});

test("counts are public to other members but the candidate exposes no voter identity", async () => {
  // The momentum count is public, but a candidate must surface only the aggregate count and the
  // CALLER's own `mine` flag - never per-voter ids/names. (The separate `members` roster, used for
  // the conditional RSVP picker, is intentionally present and is not a reaction leak.)
  const voter = await makeUser({ name: "Voter Vera" });
  const onlooker = await makeUser({ name: "Onlooker Olu" });
  const g = await makeGroup([voter, onlooker]);
  const e = await insertEvent({ groupId: g, createdByUserId: voter, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await caller(voter).events.toggleReaction({ eventId: e, candidateId: c });

  // The onlooker (a different member) sees the momentum count but NOT who voted.
  const view = await caller(onlooker).events.get({ id: e });
  assert.ok(view);
  const cand = view.timeCandidates.find((t) => t.id === c);
  assert.ok(cand);
  assert.equal(cand.count, 1, "the +1 count is public to other members");
  assert.equal(cand.mine, false, "the onlooker did not react, so mine is false");

  // The candidate object carries only aggregate/own-reaction info - no list of who reacted.
  assert.deepEqual(
    Object.keys(cand).sort(),
    ["count", "id", "mine", "partOfDay", "startsAt"],
    "a candidate must expose only its id/time/count/own-mine flag, never voter identities",
  );
});

test("the reacting member's own +1 is reflected back to them as `mine` (and only to them)", async () => {
  const voter = await makeUser();
  const other = await makeUser();
  const g = await makeGroup([voter, other]);
  const e = await insertEvent({ groupId: g, createdByUserId: voter, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await caller(voter).events.toggleReaction({ eventId: e, candidateId: c });

  const voterView = await caller(voter).events.get({ id: e });
  const otherView = await caller(other).events.get({ id: e });
  assert.ok(voterView && otherView);
  const voterCand = voterView.timeCandidates.find((t) => t.id === c);
  const otherCand = otherView.timeCandidates.find((t) => t.id === c);
  assert.ok(voterCand && otherCand);
  // Same public count for both, but `mine` is the caller's own reaction state, not anyone else's.
  assert.equal(voterCand.count, 1);
  assert.equal(otherCand.count, 1);
  assert.equal(voterCand.mine, true, "the reactor sees their own +1 as mine: true");
  assert.equal(otherCand.mine, false, "another member never sees the reactor's +1 as mine");
});

test("toggling a +1 deletes the caller's opt-out (reaction and opt-out are mutually exclusive)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));
  await insertOptOut(e, u);

  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });

  const outs = await db
    .select()
    .from(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, e), eq(eventOptOuts.userId, u)));
  assert.equal(outs.length, 0, "the +1 should have removed the opt-out row, rejoining the member");
  assert.equal((await reactionRows(c, u)).length, 1, "and the +1 itself is recorded");
});

test("removing a +1 (toggling off) does NOT re-create an opt-out", async () => {
  // A toggle-off only removes the reaction; it must not silently opt the member out.
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });
  await caller(u).events.toggleReaction({ eventId: e, candidateId: c });

  const outs = await db
    .select()
    .from(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, e), eq(eventOptOuts.userId, u)));
  assert.equal(outs.length, 0, "toggling a +1 off must not create an opt-out");
});

test("a candidate that belongs to a DIFFERENT event -> NOT_FOUND", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e1 = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const e2 = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const cOfE2 = await insertTimeCandidate(e2, new Date(Date.now() + 86_400_000));

  await assert.rejects(
    () => caller(u).events.toggleReaction({ eventId: e1, candidateId: cOfE2 }),
    isCode("NOT_FOUND"),
  );
});

test("a candidate id that does not exist at all -> NOT_FOUND", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });

  await assert.rejects(
    () => caller(u).events.toggleReaction({ eventId: e, candidateId: "c_does_not_exist" }),
    isCode("NOT_FOUND"),
  );
});

test("reacting on a plan in the moment phase -> BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "moment" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await assert.rejects(
    () => caller(u).events.toggleReaction({ eventId: e, candidateId: c }),
    isCode("BAD_REQUEST"),
  );
  // and nothing was persisted
  assert.equal((await reactionRows(c, u)).length, 0, "no +1 should be recorded outside collecting");
});

test("reacting on a cleared plan -> BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "cleared" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await assert.rejects(
    () => caller(u).events.toggleReaction({ eventId: e, candidateId: c }),
    isCode("BAD_REQUEST"),
  );
});

test("reacting on a fizzled plan -> BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "fizzled" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await assert.rejects(
    () => caller(u).events.toggleReaction({ eventId: e, candidateId: c }),
    isCode("BAD_REQUEST"),
  );
});

test("a non-member of the group -> FORBIDDEN", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const g = await makeGroup([member]);
  const e = await insertEvent({ groupId: g, createdByUserId: member, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await assert.rejects(
    () => caller(outsider).events.toggleReaction({ eventId: e, candidateId: c }),
    isCode("FORBIDDEN"),
  );
  assert.equal(
    (await reactionRows(c, outsider)).length,
    0,
    "a non-member's +1 must never be recorded",
  );
});

test("a missing event -> NOT_FOUND (checked before membership)", async () => {
  // requireMember is the access boundary, but a missing event 404s first: an outsider probing a
  // non-existent event must get NOT_FOUND, never FORBIDDEN (which would leak that it does not exist
  // vs. that they lack access). The brief: missing event -> NOT_FOUND, checked before membership.
  const outsider = await makeUser();

  await assert.rejects(
    () => caller(outsider).events.toggleReaction({ eventId: "e_missing", candidateId: "c_x" }),
    isCode("NOT_FOUND"),
  );
});

test("an unauthenticated caller -> UNAUTHORIZED", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({ groupId: g, createdByUserId: u, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));

  await assert.rejects(
    () => caller(null).events.toggleReaction({ eventId: e, candidateId: c }),
    isCode("UNAUTHORIZED"),
  );
});

test("each member's +1 is independent: one toggling off leaves the other's +1 (count stays)", async () => {
  const a = await makeUser();
  const b = await makeUser();
  const g = await makeGroup([a, b]);
  const e = await insertEvent({ groupId: g, createdByUserId: a, phase: "collecting" });
  const c = await insertTimeCandidate(e, new Date(Date.now() + 86_400_000));
  // b already has a standing +1 (seeded directly).
  await insertReaction(e, c, b);

  // a adds then removes their own +1; b's must be untouched.
  await caller(a).events.toggleReaction({ eventId: e, candidateId: c });
  await caller(a).events.toggleReaction({ eventId: e, candidateId: c });

  assert.equal((await reactionRows(c, a)).length, 0, "a's +1 is gone");
  assert.equal((await reactionRows(c, b)).length, 1, "b's +1 is untouched");
  assert.equal(
    await publicTimeCount(a, e, c),
    1,
    "the public count reflects b's lone remaining +1",
  );
});
