// Cross-cutting safety net for the events router's access boundary. requireMember + loadEvent guard
// nearly every procedure. The spec (ARCHITECTURE.md "Auth", CLAUDE.md, and the lane brief):
//   - protectedProcedure rejects an unauthenticated caller with UNAUTHORIZED.
//   - requireMember rejects a non-member of the plan's group with FORBIDDEN.
//   - a missing/unknown eventId yields NOT_FOUND, and that NOT_FOUND is returned BEFORE the
//     membership check (existence is not leaked differently): a non-member asking about a
//     non-existent event gets NOT_FOUND, not FORBIDDEN.
// Every expectation here is derived from the spec, not from the current code's behavior.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  caller,
  dropTestDb,
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

const MISSING_EVENT_ID = "e_does_not_exist";
const MISSING_GROUP_ID = "g_does_not_exist";

function isCode(code: TRPCError["code"]) {
  return (e: unknown): e is TRPCError => e instanceof TRPCError && e.code === code;
}

// Build a real collecting plan owned by `creator` in a group `creator` belongs to, with one time
// and one activity candidate, so member-scoped procedures have well-formed targets to act on.
async function seedCollectingPlan(): Promise<{
  groupId: string;
  eventId: string;
  creator: string;
  timeCandidateId: string;
  activityCandidateId: string;
}> {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  const eventId = await insertEvent({
    groupId,
    createdByUserId: creator,
    phase: "collecting",
  });
  const timeCandidateId = await insertTimeCandidate(eventId, new Date(Date.now() + 86_400_000));
  const activityCandidateId = await insertActivityCandidate(eventId, "Dinner");
  return { groupId, eventId, creator, timeCandidateId, activityCandidateId };
}

// Each entry exercises one member-scoped procedure against a given eventId/groupId, called as the
// given user. The input is shaped to be valid so that the call reaches the auth boundary rather than
// failing at Zod parsing - the boundary (UNAUTHORIZED/FORBIDDEN/NOT_FOUND) is what we assert.
type EventCall = (ctx: {
  eventId: string;
  timeCandidateId: string;
  activityCandidateId: string;
}) => (userId: string | null) => Promise<unknown>;

// Procedures guarded by loadEvent (fetch-by-id -> 404 if missing -> requireMember) or the
// equivalent preamble (events.get, events.update). For these, both the FORBIDDEN-for-non-member and
// the NOT_FOUND-for-missing-event (and NOT_FOUND-before-membership) rules apply.
const EVENT_SCOPED: { name: string; call: EventCall }[] = [
  {
    name: "get",
    call:
      ({ eventId }) =>
      (uid) =>
        caller(uid).events.get({ id: eventId }),
  },
  {
    name: "toggleReaction",
    call:
      ({ eventId, timeCandidateId }) =>
      (uid) =>
        caller(uid).events.toggleReaction({ eventId, candidateId: timeCandidateId }),
  },
  {
    name: "addCandidate",
    call:
      ({ eventId }) =>
      (uid) =>
        caller(uid).events.addCandidate({
          eventId,
          kind: "activity",
          text: "Bowling",
        }),
  },
  {
    name: "setOptOut",
    call:
      ({ eventId }) =>
      (uid) =>
        caller(uid).events.setOptOut({ eventId, out: true }),
  },
  {
    name: "respond",
    call:
      ({ eventId }) =>
      (uid) =>
        caller(uid).events.respond({ eventId, kind: "yes" }),
  },
  {
    name: "update",
    call:
      ({ eventId }) =>
      (uid) =>
        caller(uid).events.update({ eventId, location: { from: "", to: "Park" } }),
  },
  {
    name: "lock",
    call:
      ({ eventId }) =>
      (uid) =>
        caller(uid).events.lock({ eventId }),
  },
];

// ---- UNAUTHORIZED: caller(null) is rejected by protectedProcedure on every procedure ----

for (const { name, call } of EVENT_SCOPED) {
  test(`events.${name}: unauthenticated caller is UNAUTHORIZED`, async () => {
    const { eventId, timeCandidateId, activityCandidateId } = await seedCollectingPlan();
    await assert.rejects(
      () => call({ eventId, timeCandidateId, activityCandidateId })(null),
      isCode("UNAUTHORIZED"),
    );
  });
}

test("events.pastForGroup: unauthenticated caller is UNAUTHORIZED", async () => {
  const { groupId } = await seedCollectingPlan();
  await assert.rejects(() => caller(null).events.pastForGroup({ groupId }), isCode("UNAUTHORIZED"));
});

test("events.mine: unauthenticated caller is UNAUTHORIZED", async () => {
  await seedCollectingPlan();
  await assert.rejects(() => caller(null).events.mine(), isCode("UNAUTHORIZED"));
});

// ---- FORBIDDEN: a non-member of the plan's group is rejected by requireMember ----

for (const { name, call } of EVENT_SCOPED) {
  test(`events.${name}: a non-member of the group is FORBIDDEN`, async () => {
    const { eventId, timeCandidateId, activityCandidateId } = await seedCollectingPlan();
    // An authenticated user who exists but is NOT in the plan's group.
    const outsider = await makeUser();
    await assert.rejects(
      () => call({ eventId, timeCandidateId, activityCandidateId })(outsider),
      isCode("FORBIDDEN"),
    );
  });
}

test("events.pastForGroup: a non-member of the group is FORBIDDEN", async () => {
  const { groupId } = await seedCollectingPlan();
  const outsider = await makeUser();
  await assert.rejects(
    () => caller(outsider).events.pastForGroup({ groupId }),
    isCode("FORBIDDEN"),
  );
});

// A control: an actual member is NOT rejected by the boundary (so FORBIDDEN above is the membership
// gate, not a blanket rejection). lock is creator-only, so use a member-allowed read (get).
test("events.get: a member of the group is allowed past the boundary", async () => {
  const { groupId, eventId } = await seedCollectingPlan();
  const member = await makeUser();
  await addMember(groupId, member);
  const result = await caller(member).events.get({ id: eventId });
  assert.ok(result, "a member should receive the plan, not an auth error");
});

// ---- NOT_FOUND: an unknown eventId yields NOT_FOUND for event-scoped mutations ----
// events.get is the deliberate exception: a missing event returns null (not a throw), per its source
// preamble ("the null-returning read keeps its own preamble"). So assert null for get, NOT_FOUND for
// the rest.

test("events.get: a missing event returns null for a member (no throw)", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);
  await insertEvent({ groupId, createdByUserId: creator });
  const result = await caller(creator).events.get({ id: MISSING_EVENT_ID });
  assert.equal(result, null);
});

for (const { name, call } of EVENT_SCOPED) {
  if (name === "get") continue; // get returns null rather than throwing - covered above
  test(`events.${name}: a missing event is NOT_FOUND (for a member)`, async () => {
    // A user who is a member of some group, so the failure must be the missing event, not membership.
    const member = await makeUser();
    await makeGroup([member]);
    await assert.rejects(
      () =>
        call({
          eventId: MISSING_EVENT_ID,
          timeCandidateId: "c_missing",
          activityCandidateId: "c_missing",
        })(member),
      isCode("NOT_FOUND"),
    );
  });
}

// ---- ORDERING: NOT_FOUND is returned BEFORE the membership check ----
// Spec/lane brief: existence is not leaked differently, so a non-member asking about a non-existent
// event must get NOT_FOUND, not FORBIDDEN. loadEvent fetches by id and 404s before requireMember.
// events.get returns null (it never reaches requireMember for a missing event), which equally does
// not leak existence via a FORBIDDEN, so assert null there.

test("events.get: a non-member asking about a missing event gets null (existence not leaked)", async () => {
  const outsider = await makeUser();
  const result = await caller(outsider).events.get({ id: MISSING_EVENT_ID });
  assert.equal(result, null);
});

for (const { name, call } of EVENT_SCOPED) {
  if (name === "get") continue;
  test(`events.${name}: a non-member asking about a missing event gets NOT_FOUND, not FORBIDDEN`, async () => {
    // outsider belongs to no group at all - a membership-first ordering would surface FORBIDDEN.
    const outsider = await makeUser();
    await assert.rejects(
      () =>
        call({
          eventId: MISSING_EVENT_ID,
          timeCandidateId: "c_missing",
          activityCandidateId: "c_missing",
        })(outsider),
      isCode("NOT_FOUND"),
    );
  });
}

// pastForGroup is group-scoped (no event), so a missing group has no event-existence notion: the
// only boundary is requireMember, which 403s a caller who is not a member of the (absent) group.
// This confirms group-scoped reads do not leak group existence as a distinct NOT_FOUND.
test("events.pastForGroup: a missing group is FORBIDDEN (no membership row), not NOT_FOUND", async () => {
  const outsider = await makeUser();
  await assert.rejects(
    () => caller(outsider).events.pastForGroup({ groupId: MISSING_GROUP_ID }),
    isCode("FORBIDDEN"),
  );
});
