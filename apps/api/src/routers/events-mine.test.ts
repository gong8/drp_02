// Dashboard query tests for events.mine. Every assertion is derived from the spec
// (ARCHITECTURE.md / CLAUDE.md), NOT from the implementation's current output:
//
//   - mine returns EVERY non-fizzled plan across the caller's groups; a fizzled plan (including
//     one that fizzles lazily on this very read) is omitted entirely - a fizzle leaves no trace.
//   - Each plan carries the caller's status bucket (reacting / awaiting / going / declined)
//     consistent with the spec for its phase and the caller's reaction/response:
//       * collecting          -> reacting        (opted-out -> declined)
//       * blind moment, no RSVP-> awaiting
//       * blind moment, yes    -> going
//       * blind moment, no     -> declined
//       * blind moment, cond   -> awaiting (a conditional cannot resolve blind)
//       * cleared/revealed     -> resolveIn membership: going else awaiting; an explicit no -> declined
//   - Privacy: isCreator is a boolean only and the createdByUserId is NEVER serialized; while the
//     moment is still blind, goingCount stays null and the going preview stays empty (no IN crowd).
//   - Scoping: a user in no groups gets []; plans from groups the caller is not in never appear.
//
// We drive the lazy state machine by planting PAST momentEndsAt/decidesBy on inserted rows.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import {
  caller,
  dropTestDb,
  insertEvent,
  insertOptOut,
  insertReaction,
  insertResponse,
  insertTimeCandidate,
  makeGroup,
  makeUser,
  makeUsers,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const PAST = () => new Date(Date.now() - 60_000);
const FUTURE = () => new Date(Date.now() + 60 * 60_000);

// A live blind moment: momentEndsAt in the future means revealGoing returns null (still blind).
function liveMoment(groupId: string, createdByUserId: string) {
  return {
    groupId,
    createdByUserId,
    phase: "moment" as const,
    contingent: true,
    quorum: 2,
    startsAt: FUTURE(),
    momentStartsAt: new Date(),
    momentEndsAt: FUTURE(),
    respondByAt: FUTURE(),
  };
}

type MineRow = Awaited<ReturnType<ReturnType<typeof caller>["events"]["mine"]>>[number];

async function mineById(userId: string, eventId: string): Promise<MineRow | undefined> {
  const out = await caller(userId).events.mine();
  return out.find((p) => p.id === eventId);
}

// ---------------------------------------------------------------------------
// Auth boundary
// ---------------------------------------------------------------------------

test("mine rejects an unauthenticated caller", async () => {
  await assert.rejects(
    () => caller(null).events.mine(),
    (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
  );
});

// ---------------------------------------------------------------------------
// Scoping: which plans appear
// ---------------------------------------------------------------------------

test("a user in no groups gets an empty dashboard", async () => {
  const loner = await makeUser();
  const out = await caller(loner).events.mine();
  assert.deepEqual(out, []);
});

test("plans from a group the caller is not in never appear", async () => {
  const [me, other] = await makeUsers(2);
  const mineGroup = await makeGroup([me]);
  const theirGroup = await makeGroup([other]);

  const myEvent = await insertEvent({ groupId: mineGroup, createdByUserId: me });
  const theirEvent = await insertEvent({ groupId: theirGroup, createdByUserId: other });

  const out = await caller(me).events.mine();
  const ids = out.map((p) => p.id);
  assert.ok(ids.includes(myEvent), "my own group's plan should appear");
  assert.ok(!ids.includes(theirEvent), "another group's plan must never appear");
});

test("plans across all of the caller's groups appear together", async () => {
  const me = await makeUser();
  const g1 = await makeGroup([me]);
  const g2 = await makeGroup([me]);
  const e1 = await insertEvent({ groupId: g1, createdByUserId: me });
  const e2 = await insertEvent({ groupId: g2, createdByUserId: me });

  const ids = (await caller(me).events.mine()).map((p) => p.id).sort();
  assert.deepEqual(ids, [e1, e2].sort());
});

// ---------------------------------------------------------------------------
// Non-fizzled returned; fizzled omitted
// ---------------------------------------------------------------------------

test("a collecting plan is returned", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({ groupId: g, createdByUserId: me, phase: "collecting" });
  const row = await mineById(me, e);
  assert.ok(row, "a collecting plan should be on the dashboard");
  assert.equal(row.phase, "collecting");
});

test("a cleared plan is returned (it does not fizzle)", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "cleared",
    status: "resolved",
    momentEndsAt: PAST(),
  });
  const row = await mineById(me, e);
  assert.ok(row, "a cleared plan should be on the dashboard");
  assert.equal(row.phase, "cleared");
});

test("an already-fizzled plan is omitted entirely (a fizzle leaves no trace)", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "fizzled",
    status: "resolved",
  });
  const row = await mineById(me, e);
  assert.equal(row, undefined, "a fizzled plan must not appear on the dashboard");
});

test("a contingent moment that fizzles lazily on read (past deadline, under quorum) is omitted", async () => {
  // quorum 2, but only one yes -> resolveIn size 1 < 2 and contingent -> settlePhase fizzles it.
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: PAST(),
    momentEndsAt: PAST(),
    respondByAt: PAST(),
  });
  await insertResponse(e, me, "yes");

  const row = await mineById(me, e);
  assert.equal(row, undefined, "a fizzled-on-read plan must vanish from the dashboard");
});

test("a collecting plan that fizzles lazily on read (decidesBy passed, no reactions) is omitted", async () => {
  // A collecting plan whose decidesBy has passed with NO reactions of any kind fizzles silently.
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "collecting",
    decidesBy: PAST(),
  });
  await insertTimeCandidate(e, FUTURE());

  const row = await mineById(me, e);
  assert.equal(row, undefined, "a collecting plan with no support fizzles and is hidden");
});

// ---------------------------------------------------------------------------
// Status buckets: collecting
// ---------------------------------------------------------------------------

test("a member of a collecting plan is bucketed as reacting", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({ groupId: g, createdByUserId: me, phase: "collecting" });
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "reacting");
});

test("a member who opted out of a collecting plan is bucketed as declined", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({ groupId: g, createdByUserId: me, phase: "collecting" });
  await insertOptOut(e, me);
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "declined");
});

// ---------------------------------------------------------------------------
// Status buckets: blind moment (revealGoing returns null while live)
// ---------------------------------------------------------------------------

test("blind moment with no RSVP yet -> awaiting", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent(liveMoment(g, me));
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "awaiting");
});

test("blind moment with my yes -> going", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent(liveMoment(g, me));
  await insertResponse(e, me, "yes");
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "going");
});

test("blind moment with my no -> declined", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent(liveMoment(g, me));
  await insertResponse(e, me, "no");
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "declined");
});

test("blind moment with my conditional -> awaiting (a conditional cannot resolve while blind)", async () => {
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent(liveMoment(g, me));
  // Even though friend said yes (which would satisfy the conditional), the moment is BLIND so we
  // cannot leak that the condition is met - the caller's own conditional reads as awaiting.
  await insertResponse(e, friend, "yes");
  await insertResponse(e, me, "conditional", { mode: "any", targetIds: [friend] });
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "awaiting");
});

// ---------------------------------------------------------------------------
// Status buckets: cleared / revealed
// ---------------------------------------------------------------------------

test("cleared plan: a plain yes is bucketed as going", async () => {
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "cleared",
    status: "resolved",
    quorum: 1,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, me, "yes");
  await insertResponse(e, friend, "yes");
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "going");
});

test("cleared plan: an explicit no is bucketed as declined", async () => {
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "cleared",
    status: "resolved",
    quorum: 1,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, me, "no");
  await insertResponse(e, friend, "yes");
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "declined");
});

test("cleared plan: a never-answering member is bucketed as awaiting (not in the IN set)", async () => {
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "cleared",
    status: "resolved",
    quorum: 1,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, friend, "yes"); // me never answered
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "awaiting");
});

test("cleared plan: a conditional satisfied once revealed is bucketed as going", async () => {
  // Once revealed, resolveIn runs to a fixpoint: friend's yes satisfies my "any" conditional, so
  // I am IN -> going. (This is exactly the difference from the blind case above.)
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "cleared",
    status: "resolved",
    quorum: 1,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, friend, "yes");
  await insertResponse(e, me, "conditional", { mode: "any", targetIds: [friend] });
  const row = await mineById(me, e);
  assert.equal(row?.myStatus, "going");
});

// ---------------------------------------------------------------------------
// Privacy: isCreator boolean only, no createdByUserId leak
// ---------------------------------------------------------------------------

test("isCreator is true for the creator and the createdByUserId is never serialized", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({ groupId: g, createdByUserId: me, phase: "collecting" });
  const row = await mineById(me, e);
  assert.ok(row);
  assert.equal(row.isCreator, true);
  assert.ok(!("createdByUserId" in row), "the creator id must never be serialized");
});

test("isCreator is false for a non-creator member and still no createdByUserId leaks", async () => {
  const [creator, member] = await makeUsers(2);
  const g = await makeGroup([creator, member]);
  const e = await insertEvent({ groupId: g, createdByUserId: creator, phase: "collecting" });
  const row = await mineById(member, e);
  assert.ok(row);
  assert.equal(row.isCreator, false);
  assert.ok(!("createdByUserId" in row), "the creator id must never be serialized to a member");
});

// ---------------------------------------------------------------------------
// Privacy: the IN crowd stays hidden while the moment is blind
// ---------------------------------------------------------------------------

test("a live blind moment hides the going count and preview from everyone", async () => {
  const [me, a, b] = await makeUsers(3);
  const g = await makeGroup([me, a, b]);
  const e = await insertEvent(liveMoment(g, me));
  // Two yeses exist, but the moment is still live (blind) so neither the count nor the preview
  // may be exposed - that would bias people with who is already in.
  await insertResponse(e, a, "yes");
  await insertResponse(e, b, "yes");
  const row = await mineById(me, e);
  assert.ok(row);
  assert.equal(row.goingCount, null, "goingCount must be null while the moment is blind");
  assert.deepEqual(row.goingPreview, [], "no IN crowd may leak while blind");
});

test("a collecting plan exposes no going count or preview", async () => {
  const me = await makeUser();
  const g = await makeGroup([me]);
  const e = await insertEvent({ groupId: g, createdByUserId: me, phase: "collecting" });
  const row = await mineById(me, e);
  assert.ok(row);
  assert.equal(row.goingCount, null);
  assert.deepEqual(row.goingPreview, []);
});

test("a cleared plan reveals the going count and a non-empty preview", async () => {
  const [me, a, b] = await makeUsers(3);
  const g = await makeGroup([me, a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: me,
    phase: "cleared",
    status: "resolved",
    quorum: 1,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, me, "yes");
  await insertResponse(e, a, "yes");
  const row = await mineById(me, e);
  assert.ok(row);
  assert.equal(row.goingCount, 2, "the revealed IN crowd is two");
  assert.equal(row.goingPreview.length, 2);
});

// ---------------------------------------------------------------------------
// iReacted / iResponded reflect the caller's own activity
// ---------------------------------------------------------------------------

test("iReacted is true when the caller has a +1 on a collecting plan, false otherwise", async () => {
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent({ groupId: g, createdByUserId: me, phase: "collecting" });
  const c = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, c, friend); // friend reacted, not me

  const mineRow = await mineById(me, e);
  assert.equal(mineRow?.iReacted, false, "the caller did not react");

  await insertReaction(e, c, me);
  const after = await mineById(me, e);
  assert.equal(after?.iReacted, true, "the caller has reacted now");
});

test("iResponded reflects only the caller's own moment answer", async () => {
  const [me, friend] = await makeUsers(2);
  const g = await makeGroup([me, friend]);
  const e = await insertEvent(liveMoment(g, me));
  await insertResponse(e, friend, "yes"); // friend answered, not me
  const before = await mineById(me, e);
  assert.equal(before?.iResponded, false);

  await insertResponse(e, me, "yes");
  const after = await mineById(me, e);
  assert.equal(after?.iResponded, true);
});
