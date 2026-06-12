// Integration tests for the meetup share-link procedures (apps/api/src/routers/events.ts):
// previewByToken, joinByToken, shareLink. These power the web-first conversion funnel - a meetup
// link dropped in a chat that a non-member opens, previews BEFORE sign-in, then joins + responds.
//
// Assertions are derived from the SPEC (the DRP-56 plan + CLAUDE.md anonymity rules), not the
// implementation:
//   - previewByToken is PUBLIC (callable unauthenticated) and reveals only the shell - no voter or
//     creator identity, no IN crowd. A collecting plan still gets a meaningful (derived) activity.
//   - joinByToken makes a non-member a NORMAL member of the event's group; idempotent.
//   - shareLink is member-gated (NOT_FOUND before FORBIDDEN) and builds an /m/<token> link.
//
// Run with (and nothing else):
//   cd /Users/gong/Programming/drp_02/apps/api && \
//     node --import tsx --import ./src/test/env.ts --test src/routers/events-share.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { eventParticipants, events } from "../db/schema.js";
import {
  caller,
  db,
  dropTestDb,
  groupMembers,
  insertActivityCandidate,
  insertEvent,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const isCode = (code: string) => (e: unknown) => e instanceof TRPCError && e.code === code;

async function membershipRowCount(groupId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  return rows.length;
}

// ----- previewByToken -----

test("previewByToken returns the meetup shell without authentication", async () => {
  const member = await makeUser();
  const groupId = await makeGroup([member], "The Boys");
  const eventId = await insertEvent({
    groupId,
    createdByUserId: member,
    activity: "Bowling",
    phase: "moment",
  });

  // Callable signed-out: the link is the invitation (contrast every protected procedure).
  const preview = await caller(null).events.previewByToken({ eventId });
  assert.equal(preview.eventId, eventId);
  assert.equal(preview.activity, "Bowling");
  assert.equal(preview.groupName, "The Boys");
  assert.equal(preview.phase, "moment");
  assert.equal(typeof preview.startsAt, "string");
});

test("previewByToken reveals no voter, creator, or crowd identity", async () => {
  const member = await makeUser();
  const groupId = await makeGroup([member], "The Boys");
  const eventId = await insertEvent({ groupId, createdByUserId: member, activity: "Bowling" });

  const preview = await caller(null).events.previewByToken({ eventId });
  // The shell is strictly the safe fields - no roster, no going crowd, no creator id. joinsOpen is
  // a bare boolean (the +1 door, DRP-63) and leaks no identity.
  assert.deepEqual(
    Object.keys(preview).sort(),
    ["activity", "candidateCount", "eventId", "groupName", "joinsOpen", "phase", "startsAt"].sort(),
  );
});

test("previewByToken exposes the +1 door state so the landing can show closed pre-sign-in", async () => {
  const member = await makeUser();
  const groupId = await makeGroup([member]);
  const openId = await insertEvent({ groupId, createdByUserId: member });
  const closedId = await insertEvent({ groupId, createdByUserId: member, joinsOpen: false });

  assert.equal((await caller(null).events.previewByToken({ eventId: openId })).joinsOpen, true);
  assert.equal((await caller(null).events.previewByToken({ eventId: closedId })).joinsOpen, false);
});

test("previewByToken derives the leading activity for a collecting plan (no blank card)", async () => {
  const member = await makeUser();
  const groupId = await makeGroup([member]);
  // A collecting plan has activity="" in the row; the preview must surface the candidate label.
  const eventId = await insertEvent({ groupId, createdByUserId: member, phase: "collecting" });
  await insertActivityCandidate(eventId, "Pizza night");

  const preview = await caller(null).events.previewByToken({ eventId });
  assert.equal(preview.activity, "Pizza night");
  assert.equal(preview.candidateCount, 1);
});

test("previewByToken rejects an unknown token with NOT_FOUND", async () => {
  await assert.rejects(
    () => caller(null).events.previewByToken({ eventId: "e_does_not_exist" }),
    isCode("NOT_FOUND"),
  );
});

// ----- joinByToken -----

test("joinByToken adds a non-member as an ad-hoc participant, NOT a group member", async () => {
  const owner = await makeUser();
  const joiner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  const res = await caller(joiner).events.joinByToken({ eventId });
  assert.equal(res.eventId, eventId);
  assert.equal(res.groupId, groupId);
  assert.equal(res.alreadyMember, false);

  // The joiner is added to event_participants (this meetup only), NOT to group_members.
  const parts = await db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  assert.ok(
    parts.some((p) => p.userId === joiner),
    "joiner has an eventParticipants row",
  );
  assert.equal(await membershipRowCount(groupId, joiner), 0, "joiner must NOT be in the group");
});

test("joinByToken is idempotent and reports alreadyMember for an existing member", async () => {
  const owner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  const res = await caller(owner).events.joinByToken({ eventId });
  assert.equal(res.alreadyMember, true);
  // An existing group member is not duplicated as a participant row.
  const parts = await db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  assert.equal(parts.length, 0, "existing member must not get a participant row");
  assert.equal(await membershipRowCount(groupId, owner), 1, "group membership is unchanged");
});

test("joinByToken rejects an unknown token with NOT_FOUND and adds nobody", async () => {
  const joiner = await makeUser();
  await assert.rejects(
    () => caller(joiner).events.joinByToken({ eventId: "e_does_not_exist" }),
    isCode("NOT_FOUND"),
  );
});

test("joinByToken requires authentication", async () => {
  await assert.rejects(
    () => caller(null).events.joinByToken({ eventId: "e_anything" }),
    isCode("UNAUTHORIZED"),
  );
});

// ----- shareLink -----

test("shareLink returns the token, and url only when a web origin is configured", async () => {
  const member = await makeUser();
  const groupId = await makeGroup([member]);
  const eventId = await insertEvent({ groupId, createdByUserId: member });

  const prev = process.env.PUBLIC_WEB_URL;
  try {
    process.env.PUBLIC_WEB_URL = "";
    const noBase = await caller(member).events.shareLink({ eventId });
    assert.equal(noBase.token, eventId);
    assert.equal(noBase.url, null);

    process.env.PUBLIC_WEB_URL = "https://bethere.example.com/";
    const withBase = await caller(member).events.shareLink({ eventId });
    // Trailing slash collapsed; path mirrors the mobile linking config (/m/:token). The minted URL
    // carries ?via=<caller> for brought-by attribution (DRP-63), and `via` is returned bare for the
    // client's own-origin fallback.
    assert.equal(withBase.url, `https://bethere.example.com/m/${eventId}?via=${member}`);
    assert.equal(withBase.via, member);
  } finally {
    if (prev === undefined) delete process.env.PUBLIC_WEB_URL;
    else process.env.PUBLIC_WEB_URL = prev;
  }
});

test("shareLink rejects a non-member with FORBIDDEN", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const groupId = await makeGroup([member]);
  const eventId = await insertEvent({ groupId, createdByUserId: member });

  await assert.rejects(() => caller(outsider).events.shareLink({ eventId }), isCode("FORBIDDEN"));
});

test("shareLink rejects an unknown token with NOT_FOUND", async () => {
  const member = await makeUser();
  await assert.rejects(
    () => caller(member).events.shareLink({ eventId: "e_does_not_exist" }),
    isCode("NOT_FOUND"),
  );
});

test("shareLink requires authentication", async () => {
  await assert.rejects(
    () => caller(null).events.shareLink({ eventId: "e_anything" }),
    isCode("UNAUTHORIZED"),
  );
});

// ----- the +1 door (joinsOpen) and brought-by attribution (DRP-63) -----

async function participantRow(eventId: string, userId: string) {
  const rows = await db
    .select()
    .from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId)));
  return rows[0];
}

test("joinByToken records invitedBy from a via that is in the roster, plus a joinedAt", async () => {
  const owner = await makeUser();
  const joiner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await caller(joiner).events.joinByToken({ eventId, via: owner });
  const row = await participantRow(eventId, joiner);
  assert.equal(row.invitedBy, owner, "the sharer is recorded");
  assert.ok(row.joinedAt instanceof Date, "joinedAt is stamped");
});

test("joinByToken degrades a non-roster or self via to an unattributed join, never an error", async () => {
  const owner = await makeUser();
  const stranger = await makeUser();
  const joinerA = await makeUser();
  const joinerB = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  // A via that is not in the roster (hand-edited / stale link) still joins, unattributed.
  await caller(joinerA).events.joinByToken({ eventId, via: stranger });
  assert.equal((await participantRow(eventId, joinerA)).invitedBy, null);

  // A self via (crafted) is meaningless and degrades the same way.
  await caller(joinerB).events.joinByToken({ eventId, via: joinerB });
  assert.equal((await participantRow(eventId, joinerB)).invitedBy, null);
});

test("a +1's re-shared link attributes the next joiner to the +1 (the visible chain)", async () => {
  const owner = await makeUser();
  const firstPlusOne = await makeUser();
  const secondPlusOne = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  await caller(firstPlusOne).events.joinByToken({ eventId, via: owner });
  // The +1 is now in the roster, so a link they mint is a valid via for the next joiner.
  await caller(secondPlusOne).events.joinByToken({ eventId, via: firstPlusOne });
  assert.equal((await participantRow(eventId, secondPlusOne)).invitedBy, firstPlusOne);
});

test("a closed door rejects a NEW joiner with FORBIDDEN and adds nobody", async () => {
  const owner = await makeUser();
  const joiner = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner, joinsOpen: false });

  await assert.rejects(
    () => caller(joiner).events.joinByToken({ eventId, via: owner }),
    isCode("FORBIDDEN"),
  );
  assert.equal(await participantRow(eventId, joiner), undefined, "no participant row");
});

test("a closed door still no-ops for people already in the roster (blocks NEW people only)", async () => {
  const owner = await makeUser();
  const plusOne = await makeUser();
  const groupId = await makeGroup([owner]);
  const eventId = await insertEvent({ groupId, createdByUserId: owner });

  // Join while open, then the door closes.
  await caller(plusOne).events.joinByToken({ eventId });
  await caller(owner).events.setJoinsOpen({ eventId, open: false });

  // Both an existing group member and an existing participant reopen their link fine.
  assert.equal((await caller(owner).events.joinByToken({ eventId })).alreadyMember, true);
  assert.equal((await caller(plusOne).events.joinByToken({ eventId })).alreadyMember, true);
});

test("create persists the +1 door pair; defaults are open + unlocked", async () => {
  const creator = await makeUser();
  const groupId = await makeGroup([creator]);

  const open = await caller(creator).events.create({ groupId });
  const closed = await caller(creator).events.create({
    groupId,
    joinsOpen: false,
    lockJoins: true,
  });

  const rowOf = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const openRow = await rowOf(open.id);
  assert.equal(openRow.joinsOpen, true);
  assert.equal(openRow.lockJoins, false);
  const closedRow = await rowOf(closed.id);
  assert.equal(closedRow.joinsOpen, false);
  assert.equal(closedRow.lockJoins, true);
});
