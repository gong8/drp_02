// events.get - the phase-aware single-plan detail view.
//
// Spec (ARCHITECTURE.md + CLAUDE.md + the Zod schemas):
//
// ANONYMITY (always on, server-authoritative):
//   - Per-candidate +1 COUNTS are PUBLIC (momentum) for BOTH the TIME and ACTIVITY lists; the
//     response carries `count` and whether the CALLER reacted (`mine`), but NEVER any voter name or
//     id. No other user's id may appear attached to any candidate.
//   - The creator is ALWAYS anonymous: `isCreator` is returned as a boolean ONLY, and the response
//     NEVER serializes `createdByUserId`. The creator sees isCreator true; everyone else false.
//   - During a blind `moment` (phase moment, before momentEndsAt) the IN crowd is hidden: `revealed`
//     is false and `going` is empty. The crowd reveals only once the moment ends, or the plan is
//     cleared. (A fizzle never reveals.)
//
// DISPLAY:
//   - `activityRaw` exposes the stored activity (often "" while collecting); `activity` shows the
//     leading ACTIVITY candidate while collecting (or the real name once locked).
//   - `members` excludes the caller themselves.
//
// ACCESS BOUNDARY (requireMember): a non-member gets FORBIDDEN, an unknown event id returns null,
// an unauthenticated caller gets UNAUTHORIZED.
//
// Every assertion is derived from the spec, not from the current implementation's output.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import {
  caller,
  dropTestDb,
  insertActivityCandidate,
  insertEvent,
  insertReaction,
  insertResponse,
  insertTimeCandidate,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const HOUR_MS = 60 * 60 * 1000;
const PAST_MS = 60_000; // one minute ago: a moment whose countdown has ended.

// A future instant, so a `moment` row stays live (its countdown will not lazily settle on read).
function future(ms = HOUR_MS): Date {
  return new Date(Date.now() + ms);
}
function past(ms = PAST_MS): Date {
  return new Date(Date.now() - ms);
}

// Deep-walk a value collecting every string. Used to prove a forbidden id never appears ANYWHERE in
// the serialized detail (no matter how it might leak - a count key, a nested field, etc.).
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) allStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) allStrings(v, out);
  }
  return out;
}

// ----- access boundary -----

test("a non-member of the plan's group gets FORBIDDEN", async () => {
  const [creator, outsider] = [await makeUser(), await makeUser()];
  const group = await makeGroup([creator]);
  const eventId = await insertEvent({ groupId: group, createdByUserId: creator });

  await assert.rejects(
    () => caller(outsider).events.get({ id: eventId }),
    (e) => e instanceof TRPCError && e.code === "FORBIDDEN",
  );
});

test("an unknown event id returns null (not an error)", async () => {
  const member = await makeUser();
  await makeGroup([member]);

  const got = await caller(member).events.get({ id: "e_does_not_exist" });
  assert.equal(got, null);
});

test("an unauthenticated caller is rejected with UNAUTHORIZED", async () => {
  const creator = await makeUser();
  const group = await makeGroup([creator]);
  const eventId = await insertEvent({ groupId: group, createdByUserId: creator });

  await assert.rejects(
    () => caller(null).events.get({ id: eventId }),
    (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
  );
});

// ----- creator anonymity -----

test("the creator's id is NEVER serialized; isCreator is a boolean only", async () => {
  const [creator, other] = [await makeUser(), await makeUser()];
  const group = await makeGroup([creator, other]);
  const eventId = await insertEvent({ groupId: group, createdByUserId: creator });

  const detail = await caller(other).events.get({ id: eventId });
  assert.ok(detail);
  // The response object must not carry the raw creator column under any key.
  assert.ok(!("createdByUserId" in detail), "createdByUserId must not be serialized");
  assert.equal(typeof detail.isCreator, "boolean");
  // Anonymity = you cannot DISTINGUISH the creator. The members list shows every member equally
  // (just { id, name }) with no creator marker, so a viewer cannot tell which member is the creator.
  for (const m of detail.members) {
    assert.deepEqual(
      Object.keys(m).sort(),
      ["id", "name"],
      "a member entry carries only id+name - no creator flag that would out the creator",
    );
  }
});

test("the creator sees isCreator true", async () => {
  const creator = await makeUser();
  const group = await makeGroup([creator]);
  const eventId = await insertEvent({ groupId: group, createdByUserId: creator });

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.isCreator, true);
});

test("a non-creator member sees isCreator false", async () => {
  const [creator, other] = [await makeUser(), await makeUser()];
  const group = await makeGroup([creator, other]);
  const eventId = await insertEvent({ groupId: group, createdByUserId: creator });

  const detail = await caller(other).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.isCreator, false);
});

// ----- public counts, blind to names -----

test("per-candidate +1 counts are the public distinct-voter totals (both kinds)", async () => {
  const [creator, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b, c]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "collecting",
  });

  const t1 = await insertTimeCandidate(eventId, future(48 * HOUR_MS));
  const a1 = await insertActivityCandidate(eventId, "Bowling");

  // t1 reacted by creator + b + c = 3; a1 reacted by b only = 1.
  await insertReaction(eventId, t1, creator);
  await insertReaction(eventId, t1, b);
  await insertReaction(eventId, t1, c);
  await insertReaction(eventId, a1, b);

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);

  const time = detail.timeCandidates.find((x) => x.id === t1);
  const activity = detail.activityCandidates.find((x) => x.id === a1);
  assert.equal(time?.count, 3);
  assert.equal(activity?.count, 1);
});

test("a candidate with zero reactions still appears with count 0", async () => {
  const creator = await makeUser();
  const group = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "collecting",
  });
  const t1 = await insertTimeCandidate(eventId, future(48 * HOUR_MS));

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  const time = detail.timeCandidates.find((x) => x.id === t1);
  assert.equal(time?.count, 0);
});

test("`mine` reflects ONLY the caller's own reaction, never another voter's", async () => {
  const [creator, other] = [await makeUser(), await makeUser()];
  const group = await makeGroup([creator, other]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "collecting",
  });
  const t1 = await insertTimeCandidate(eventId, future(48 * HOUR_MS));

  // Only `other` reacted to t1.
  await insertReaction(eventId, t1, other);

  // The caller did NOT react: mine must be false even though the count is 1.
  const asCreator = await caller(creator).events.get({ id: eventId });
  const tCreator = asCreator?.timeCandidates.find((x) => x.id === t1);
  assert.equal(tCreator?.count, 1);
  assert.equal(tCreator?.mine, false);

  // The voter themselves sees mine true.
  const asOther = await caller(other).events.get({ id: eventId });
  const tOther = asOther?.timeCandidates.find((x) => x.id === t1);
  assert.equal(tOther?.mine, true);
});

test("no other voter's id is ever attached to any candidate in the response", async () => {
  const [creator, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b, c]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "collecting",
  });
  const t1 = await insertTimeCandidate(eventId, future(48 * HOUR_MS));
  const a1 = await insertActivityCandidate(eventId, "Picnic");
  await insertReaction(eventId, t1, b);
  await insertReaction(eventId, a1, c);

  // Caller `b` requests the detail. b and c both voted; structurally, neither b nor c (nor any
  // user) may appear as a string ATTACHED to a candidate object.
  const detail = await caller(b).events.get({ id: eventId });
  assert.ok(detail);
  const candidateStrings = [
    ...allStrings(detail.timeCandidates),
    ...allStrings(detail.activityCandidates),
  ];
  // The candidate ids themselves are fine; voter ids are not. Assert no member id is present.
  assert.ok(!candidateStrings.includes(b), "voter b's id must not be attached to any candidate");
  assert.ok(!candidateStrings.includes(c), "voter c's id must not be attached to any candidate");
});

// ----- the blind moment: crowd hidden until reveal -----

test("during a live moment the going crowd is hidden (revealed false, going empty)", async () => {
  const [creator, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b, c]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: past(),
    momentEndsAt: future(), // still counting down -> blind
  });
  // b and c are IN; the caller must not see them while blind.
  await insertResponse(eventId, b, "yes");
  await insertResponse(eventId, c, "yes");

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.phase, "moment");
  assert.equal(detail.revealed, false);
  assert.deepEqual(detail.going, []);
});

test("during a live moment the IN crowd cannot leak through the response at all", async () => {
  const [creator, b] = [await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 1,
    momentStartsAt: past(),
    momentEndsAt: future(),
  });
  await insertResponse(eventId, b, "yes");

  // The caller (who has NOT responded) must not learn that b is IN. b legitimately appears in the
  // members roster (everyone does), but must NOT surface as part of the crowd: going stays empty and
  // b's id must not appear in any crowd/count field (everything except the plain members roster).
  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.deepEqual(detail.going, [], "the IN crowd stays empty while blind");
  const { members: _roster, ...crowdFacing } = detail;
  assert.ok(
    !allStrings(crowdFacing).includes(b),
    "an IN member's id must not leak through any crowd/count field during a blind moment",
  );
});

test("after the moment ends, the IN crowd is revealed", async () => {
  const [creator, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b, c]);
  // momentEndsAt already passed: the countdown is over so the crowd reveals (and the plan settles).
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: past(2 * HOUR_MS),
    momentEndsAt: past(),
  });
  await insertResponse(eventId, b, "yes");
  await insertResponse(eventId, c, "yes");

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.revealed, true);
  const goingIds = detail.going.map((g) => g.id).sort();
  assert.deepEqual(goingIds, [b, c].sort());
});

test("a cleared plan reveals exactly the resolved IN crowd (a 'no' is excluded)", async () => {
  const [creator, yes1, yes2, no1] = await Promise.all([
    makeUser(),
    makeUser(),
    makeUser(),
    makeUser(),
  ]);
  const group = await makeGroup([creator, yes1, yes2, no1]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "cleared",
    status: "resolved",
    contingent: true,
    quorum: 2,
    momentStartsAt: past(2 * HOUR_MS),
    momentEndsAt: past(),
  });
  await insertResponse(eventId, yes1, "yes");
  await insertResponse(eventId, yes2, "yes");
  await insertResponse(eventId, no1, "no");

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.revealed, true);
  const goingIds = detail.going.map((g) => g.id).sort();
  assert.deepEqual(goingIds, [yes1, yes2].sort(), "only the resolved IN set is revealed");
});

test("a conditional resolves server-side and joins the revealed crowd on a yes anchor", async () => {
  const [creator, anchor, follower] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, anchor, follower]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "cleared",
    status: "resolved",
    contingent: true,
    quorum: 1,
    momentStartsAt: past(2 * HOUR_MS),
    momentEndsAt: past(),
  });
  await insertResponse(eventId, anchor, "yes");
  // follower is in "if anchor is in" -> resolves IN.
  await insertResponse(eventId, follower, "conditional", { mode: "all", targetIds: [anchor] });

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  const goingIds = detail.going.map((g) => g.id).sort();
  assert.deepEqual(goingIds, [anchor, follower].sort());
});

test("a pure conditional cycle with no yes anchor reveals NOBODY", async () => {
  const [creator, x, y] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, x, y]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "cleared",
    status: "resolved",
    contingent: true,
    quorum: 1,
    momentStartsAt: past(2 * HOUR_MS),
    momentEndsAt: past(),
  });
  // x in if y; y in if x: a cycle with no plain-yes anchor -> nobody is IN.
  await insertResponse(eventId, x, "conditional", { mode: "all", targetIds: [y] });
  await insertResponse(eventId, y, "conditional", { mode: "all", targetIds: [x] });

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.revealed, true);
  assert.deepEqual(detail.going, [], "a pure conditional cycle resolves to nobody");
});

// ----- activity display vs raw -----

test("while collecting, activityRaw stays '' and activity shows the leading candidate", async () => {
  const [creator, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b, c]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "collecting",
    activity: "", // no real activity yet - it is vote-decided
  });
  const losing = await insertActivityCandidate(eventId, "Mini golf");
  const leading = await insertActivityCandidate(eventId, "Karaoke");
  // Karaoke leads with 2 +1s vs Mini golf's 1.
  await insertReaction(eventId, leading, b);
  await insertReaction(eventId, leading, c);
  await insertReaction(eventId, losing, b);

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.activityRaw, "", "the stored activity is still empty while collecting");
  assert.equal(detail.activity, "Karaoke", "the displayed activity is the leading candidate");
});

test("once locked, activity is the stored name and activityRaw matches it", async () => {
  const creator = await makeUser();
  const group = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "moment",
    activity: "Dinner at Lucia's",
    contingent: false,
    quorum: 1,
    momentStartsAt: past(),
    momentEndsAt: future(),
  });

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.activity, "Dinner at Lucia's");
  assert.equal(detail.activityRaw, "Dinner at Lucia's");
});

// ----- members list -----

test("the members list excludes the caller themselves", async () => {
  const [creator, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b, c]);
  const eventId = await insertEvent({ groupId: group, createdByUserId: creator });

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  const memberIds = detail.members.map((m) => m.id).sort();
  assert.deepEqual(memberIds, [b, c].sort(), "the caller is excluded; the others are present");
  assert.ok(!memberIds.includes(creator), "the caller must not appear in their own members list");
});

// ----- caller's own response is reflected (own answer is not a leak) -----

test("the caller's own moment response is reflected back (myResponse)", async () => {
  const [creator, b] = [await makeUser(), await makeUser()];
  const group = await makeGroup([creator, b]);
  const eventId = await insertEvent({
    groupId: group,
    createdByUserId: creator,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentStartsAt: past(),
    momentEndsAt: future(),
  });
  await insertResponse(eventId, creator, "yes");
  await insertResponse(eventId, b, "yes");

  const detail = await caller(creator).events.get({ id: eventId });
  assert.ok(detail);
  assert.equal(detail.myResponse?.kind, "yes");
  // Even though the caller answered yes, the blind moment still hides the crowd.
  assert.equal(detail.revealed, false);
  assert.deepEqual(detail.going, []);
});
