// events.respond / events.unrespond - the blind moment RSVP.
//
// Spec (ARCHITECTURE.md + CLAUDE.md + the Zod schemas): during a blind `moment` a member RSVPs
// yes / no / "I'll go if [people]" (a conditional carrying { mode, targetIds }). respond records
// the caller's single answer and REPLACES any prior one (exactly one response row per user, never
// two). A conditional's cond round-trips through the jsonb column intact. respond is the escape
// hatch back in: it supersedes any earlier opt-out. unrespond clears the caller's answer (back to
// unanswered). Both are moment-only (BAD_REQUEST otherwise). requireMember is the access boundary:
// a non-member gets FORBIDDEN, a missing event NOT_FOUND, an unauthenticated caller UNAUTHORIZED.
//
// Every assertion is derived from the spec, not from the current implementation's output.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  addMember,
  caller,
  db,
  dropTestDb,
  eventOptOuts,
  insertEvent,
  insertOptOut,
  insertResponse,
  makeGroup,
  makeUser,
  resetTables,
  responses,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const FUTURE_MS = 60 * 60 * 1000; // one hour out: a live moment that will not lazily settle.

// A live blind moment: phase=moment with momentEndsAt in the future, so reads never lazily settle
// it. Returns { groupId, eventId, creator } with the creator already a member.
async function liveMoment(extraMemberIds: string[] = []): Promise<{
  groupId: string;
  eventId: string;
  creator: string;
}> {
  const creator = await makeUser();
  const groupId = await makeGroup([creator, ...extraMemberIds]);
  const now = new Date();
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: now,
    momentEndsAt: new Date(Date.now() + FUTURE_MS),
    startsAt: new Date(Date.now() + FUTURE_MS),
    respondByAt: new Date(Date.now() + FUTURE_MS),
  });
  return { groupId, eventId, creator };
}

async function responseRows(eventId: string, userId: string) {
  return db
    .select()
    .from(responses)
    .where(and(eq(responses.eventId, eventId), eq(responses.userId, userId)));
}

// ----- respond records the caller's answer during the moment -----

test("respond records a plain yes during the moment", async () => {
  const { eventId, creator } = await liveMoment();

  const res = await caller(creator).events.respond({ eventId, kind: "yes" });
  assert.equal(res.recorded, true);

  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "yes");
  assert.equal(rows[0].cond, null);
});

test("respond records a plain no during the moment", async () => {
  const { eventId, creator } = await liveMoment();

  await caller(creator).events.respond({ eventId, kind: "no" });

  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "no");
});

test("respond records a conditional with its cond payload", async () => {
  const other = await makeUser();
  const { eventId, creator, groupId } = await liveMoment();
  await addMember(groupId, other);

  await caller(creator).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [other] },
  });

  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "conditional");
  assert.deepEqual(rows[0].cond, { mode: "all", targetIds: [other] });
});

// ----- responding again REPLACES (one row per user, never two) -----

test("responding again replaces the prior answer (yes -> no, single row)", async () => {
  const { eventId, creator } = await liveMoment();

  await caller(creator).events.respond({ eventId, kind: "yes" });
  await caller(creator).events.respond({ eventId, kind: "no" });

  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1, "exactly one response row per user");
  assert.equal(rows[0].kind, "no", "the latest answer wins");
});

test("re-responding from a conditional back to yes clears the stale cond", async () => {
  const other = await makeUser();
  const { eventId, creator, groupId } = await liveMoment();
  await addMember(groupId, other);

  await caller(creator).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "any", targetIds: [other] },
  });
  await caller(creator).events.respond({ eventId, kind: "yes" });

  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "yes");
  assert.equal(rows[0].cond, null, "a plain yes carries no leftover conditional payload");
});

// ----- a conditional round-trips through the jsonb column via events.get's myResponse -----

test("a conditional cond survives the jsonb round-trip through events.get (mode all)", async () => {
  const t1 = await makeUser();
  const t2 = await makeUser();
  const { eventId, creator, groupId } = await liveMoment();
  await addMember(groupId, t1);
  await addMember(groupId, t2);

  await caller(creator).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [t1, t2] },
  });

  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view, "the moment is readable");
  assert.ok(view.myResponse, "the caller's own answer is reflected");
  assert.equal(view.myResponse.kind, "conditional");
  assert.deepEqual(
    view.myResponse.cond,
    { mode: "all", targetIds: [t1, t2] },
    "mode + targetIds survive the jsonb round-trip (guards against null/undefined serialization)",
  );
});

test("a conditional cond survives the jsonb round-trip through events.get (mode any)", async () => {
  const t1 = await makeUser();
  const { eventId, creator, groupId } = await liveMoment();
  await addMember(groupId, t1);

  await caller(creator).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "any", targetIds: [t1] },
  });

  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view?.myResponse);
  assert.equal(view.myResponse.cond?.mode, "any");
  assert.deepEqual(view.myResponse.cond?.targetIds, [t1]);
});

// ----- respond is the escape hatch back in: it clears any prior opt-out -----

test("respond clears the caller's prior opt-out", async () => {
  const member = await makeUser();
  const { eventId } = await liveMoment([member]);
  await insertOptOut(eventId, member);

  await caller(member).events.respond({ eventId, kind: "yes" });

  const opts = await db
    .select()
    .from(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, eventId), eq(eventOptOuts.userId, member)));
  assert.equal(opts.length, 0, "an explicit moment answer supersedes the opt-out");
});

// ----- respond is moment-only -----

test("respond rejects with BAD_REQUEST while still collecting", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
  });

  await assert.rejects(
    () => caller(creator).events.respond({ eventId, kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 0, "no response is recorded outside the moment");
});

test("respond rejects with BAD_REQUEST once the plan is cleared", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "cleared",
    status: "resolved",
  });

  await assert.rejects(
    () => caller(creator).events.respond({ eventId, kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
});

test("respond rejects with BAD_REQUEST once the plan has fizzled", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "fizzled",
    status: "resolved",
  });

  await assert.rejects(
    () => caller(creator).events.respond({ eventId, kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
});

// ----- a late write settles first: the moment is gone once momentEndsAt has passed (A1) -----

test("respond after momentEndsAt has passed is rejected (the write path settles the stale moment)", async () => {
  // The stored phase is still `moment` (no read has settled it yet), but the countdown has ended.
  // A write must settle lazily like a read does, so this late RSVP is rejected, not silently kept.
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: new Date(Date.now() - 2 * FUTURE_MS),
    momentEndsAt: new Date(Date.now() - 60_000), // ended a minute ago, never read since
  });

  await assert.rejects(
    () => caller(creator).events.respond({ eventId, kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 0, "no answer is recorded after the moment has closed");
});

test("unrespond after momentEndsAt has passed is rejected (the write path settles the stale moment)", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: new Date(Date.now() - 2 * FUTURE_MS),
    momentEndsAt: new Date(Date.now() - 60_000),
  });
  // An answer recorded while the moment was live must NOT be clearable after it has closed.
  await insertResponse(eventId, creator, "yes");

  await assert.rejects(
    () => caller(creator).events.unrespond({ eventId }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1, "the final answer is left intact after the moment closes");
});

// ----- unrespond deletes the caller's response (back to unanswered) -----

test("unrespond deletes the caller's response during the moment", async () => {
  const { eventId, creator } = await liveMoment();
  await caller(creator).events.respond({ eventId, kind: "yes" });

  const res = await caller(creator).events.unrespond({ eventId });
  assert.equal(res.ok, true);

  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 0, "the caller is back to unanswered");
});

test("unrespond deletes only the caller's own response, not others'", async () => {
  const member = await makeUser();
  const { eventId, creator, groupId } = await liveMoment([member]);
  await addMember(groupId, member);
  await caller(creator).events.respond({ eventId, kind: "yes" });
  await caller(member).events.respond({ eventId, kind: "no" });

  await caller(creator).events.unrespond({ eventId });

  const mine = await responseRows(eventId, creator);
  assert.equal(mine.length, 0, "the caller's answer is cleared");
  const theirs = await responseRows(eventId, member);
  assert.equal(theirs.length, 1, "another member's answer is untouched");
  assert.equal(theirs[0].kind, "no");
});

test("unrespond rejects with BAD_REQUEST while still collecting", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
  });
  // A stray response row should NOT be deletable outside the moment.
  await insertResponse(eventId, creator, "yes");

  await assert.rejects(
    () => caller(creator).events.unrespond({ eventId }),
    (e) => e instanceof TRPCError && e.code === "BAD_REQUEST",
  );
  const rows = await responseRows(eventId, creator);
  assert.equal(rows.length, 1, "the response is left intact when not in a moment");
});

// ----- the access boundary: requireMember (FORBIDDEN), missing (NOT_FOUND), unauth (UNAUTHORIZED) -----

test("respond by a non-member is FORBIDDEN", async () => {
  const { eventId } = await liveMoment();
  const stranger = await makeUser();

  await assert.rejects(
    () => caller(stranger).events.respond({ eventId, kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "FORBIDDEN",
  );
  const rows = await responseRows(eventId, stranger);
  assert.equal(rows.length, 0, "a non-member never records an answer");
});

test("unrespond by a non-member is FORBIDDEN", async () => {
  const member = await makeUser();
  const { eventId, groupId } = await liveMoment([member]);
  await addMember(groupId, member);
  await caller(member).events.respond({ eventId, kind: "yes" });
  const stranger = await makeUser();

  await assert.rejects(
    () => caller(stranger).events.unrespond({ eventId }),
    (e) => e instanceof TRPCError && e.code === "FORBIDDEN",
  );
  const rows = await responseRows(eventId, member);
  assert.equal(rows.length, 1, "a non-member cannot clear someone else's answer");
});

test("respond on a missing event is NOT_FOUND (checked before membership)", async () => {
  const user = await makeUser();

  await assert.rejects(
    () => caller(user).events.respond({ eventId: "e_does_not_exist", kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "NOT_FOUND",
  );
});

test("respond by an unauthenticated caller is UNAUTHORIZED", async () => {
  const { eventId } = await liveMoment();

  await assert.rejects(
    () => caller(null).events.respond({ eventId, kind: "yes" }),
    (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
  );
});
