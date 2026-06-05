// events.create - the unified suggest-flow create procedure. Tested against the SPEC
// (ARCHITECTURE.md + CLAUDE.md + CreateEventInput), not the implementation's current output.
//
// A creator sends ONE plan to a group. A plan owns two candidate lists - TIME and ACTIVITY.
// Two flags (default false = open): lockTimes, lockActivity. The concrete shortcut - exactly
// ONE time candidate with lockTimes AND at most one activity candidate with lockActivity -
// opens the plan straight into a blind 'moment'; any open/contested axis collects. A locked
// but empty axis is illegal (BAD_REQUEST). Quorum defaults to 1 (moment) or 2 (collecting).
//
// Run with (and nothing else):
//   cd /Users/gong/Programming/drp_02/apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-create.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { MOMENT_MS } from "@bethere/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  caller,
  db,
  dropTestDb,
  eventCandidates,
  events,
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

function isCode(code: TRPCError["code"]) {
  return (e: unknown) => e instanceof TRPCError && e.code === code;
}

async function row(id: string) {
  const [e] = await db.select().from(events).where(eq(events.id, id));
  assert.ok(e, "event row should exist");
  return e;
}

async function candidatesOf(id: string) {
  return db.select().from(eventCandidates).where(eq(eventCandidates.eventId, id));
}

// A plan whose dates are far enough out that the default deadlines always have room.
function futureTime(daysOut: number): string {
  return new Date(Date.now() + daysOut * DAY).toISOString();
}

// ----- access boundary -----

test("a group member can create a plan in their group", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({ groupId: g });
  assert.match(id, /^e_/);
  const e = await row(id);
  assert.equal(e.groupId, g);
});

test("the creating member is stored as the plan's creator", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({ groupId: g });
  const e = await row(id);
  assert.equal(e.createdByUserId, u);
});

test("a non-member of the target group is FORBIDDEN from creating", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const g = await makeGroup([member]);
  await assert.rejects(() => caller(outsider).events.create({ groupId: g }), isCode("FORBIDDEN"));
});

test("an unauthenticated caller is UNAUTHORIZED", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(() => caller(null).events.create({ groupId: g }), isCode("UNAUTHORIZED"));
});

test("a non-member create writes no plan row", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const g = await makeGroup([member]);
  await assert.rejects(() => caller(outsider).events.create({ groupId: g }));
  const rows = await db.select().from(events).where(eq(events.groupId, g));
  assert.equal(rows.length, 0);
});

// ----- the concrete shortcut: both axes pinned opens the blind moment -----

test("one locked time + one locked activity opens straight into a moment", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.phase, "moment");
});

test("a pinned plan is non-contingent (it always happens)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.contingent, false);
});

test("a pinned plan sets chosenCandidateId and the moment window", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  const [cand] = await candidatesOf(id).then((cs) => cs.filter((c) => c.kind === "time"));
  assert.equal(e.chosenCandidateId, cand.id, "chosen candidate is the single time slot");
  assert.ok(e.momentStartsAt, "moment has started");
  assert.ok(e.momentEndsAt, "moment has an end / countdown");
});

test("a pinned plan adopts the locked activity as its name", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Bouldering"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.activity, "Bouldering");
});

test("a locked single time but unlocked empty activity axis collects (activity axis still open)", async () => {
  // The activity axis is only "pinned" when lockActivity is true (with <=1 candidate). With
  // lockActivity:false the axis is open - members may still add activities - so the plan must
  // collect rather than take the concrete shortcut, even though the time axis is fully pinned.
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    lockTimes: true,
    lockActivity: false,
  });
  const e = await row(id);
  assert.equal(e.phase, "collecting", "an open activity axis keeps the plan collecting");
});

// ----- any open or contested axis collects -----

test("default flags (both open) start a collecting round", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
  });
  const e = await row(id);
  assert.equal(e.phase, "collecting");
  assert.equal(e.contingent, true);
});

test("a locked time axis but open activity axis collects", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: false,
  });
  const e = await row(id);
  assert.equal(e.phase, "collecting");
});

test("two locked time candidates (contested) collect even though locked", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }, { startsAt: futureTime(4) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.phase, "collecting", "a contested (2+) time axis collects despite the lock");
});

test("two locked activity candidates (contested) collect even though locked", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner", "Bowling"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.phase, "collecting", "a contested (2+) activity axis collects despite the lock");
});

test("an unlocked single time + locked single activity collects (time axis open)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: false,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.phase, "collecting");
});

// ----- a locked-but-empty axis is illegal -----

test("lockTimes with no time candidates is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        activityCandidates: ["Dinner"],
        lockTimes: true,
      }),
    isCode("BAD_REQUEST"),
  );
});

test("lockActivity with no activity candidates is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: futureTime(3) }],
        lockActivity: true,
      }),
    isCode("BAD_REQUEST"),
  );
});

// ----- quorum defaults -----

test("a plan that opens a moment defaults quorum to 1", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.quorum, 1);
});

test("a collecting plan defaults quorum to 2", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
  });
  const e = await row(id);
  assert.equal(e.quorum, 2);
});

test("an explicit quorum overrides the default", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    quorum: 5,
  });
  const e = await row(id);
  assert.equal(e.quorum, 5);
});

// ----- decidesBy bounds (collecting plans only) -----

test("an in-range decidesBy override is accepted and stored", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  // earliest time is 5 days out; a decides-by 2 days out is after now and leaves > MOMENT_MS room.
  const decidesBy = new Date(Date.now() + 2 * DAY).toISOString();
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(5) }],
    activityCandidates: ["Dinner"],
    decidesBy,
  });
  const e = await row(id);
  assert.ok(e.decidesBy, "decidesBy stored");
  assert.equal(e.decidesBy.getTime(), new Date(decidesBy).getTime());
});

test("a decidesBy in the past is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: futureTime(5) }],
        activityCandidates: ["Dinner"],
        decidesBy: new Date(Date.now() - HOUR).toISOString(),
      }),
    isCode("BAD_REQUEST"),
  );
});

test("a decidesBy that leaves no MOMENT_MS room before the earliest time is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const earliestMs = Date.now() + 2 * DAY;
  // 30 minutes before the earliest time leaves < MOMENT_MS (1h) for the blind moment.
  const tooLate = new Date(earliestMs - 30 * 60 * 1000).toISOString();
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: new Date(earliestMs).toISOString() }],
        activityCandidates: ["Dinner"],
        decidesBy: tooLate,
      }),
    isCode("BAD_REQUEST"),
  );
});

test("an invalid (NaN) decidesBy is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: futureTime(5) }],
        activityCandidates: ["Dinner"],
        decidesBy: "not-a-date",
      }),
    isCode("BAD_REQUEST"),
  );
});

test("a collecting plan with no decidesBy override gets a sensible default in (now, earliest)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const earliestMs = Date.now() + 5 * DAY;
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: new Date(earliestMs).toISOString() }],
    activityCandidates: ["Dinner"],
  });
  const e = await row(id);
  assert.ok(e.decidesBy, "a collecting plan has a decides-by deadline");
  const t = e.decidesBy.getTime();
  assert.ok(t > Date.now(), "default decides-by is after now");
  assert.ok(
    t <= earliestMs - MOMENT_MS,
    "default leaves a moment of room before the earliest time",
  );
});

test("a pinned (moment) plan has no decides-by deadline", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.decidesBy, null, "a plan that skips collecting needs no decides-by");
});

// ----- replyBy bounds -----

test("a replyBy no later than the earliest time and after the vote closes is accepted", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const earliestMs = Date.now() + 6 * DAY;
  // After the default decides-by and before the event.
  const replyBy = new Date(earliestMs - HOUR).toISOString();
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: new Date(earliestMs).toISOString() }],
    activityCandidates: ["Dinner"],
    replyBy,
  });
  const e = await row(id);
  assert.ok(e.replyBy, "replyBy stored");
  assert.equal(e.replyBy.getTime(), new Date(replyBy).getTime());
});

test("a replyBy later than the earliest event time is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const earliestMs = Date.now() + 5 * DAY;
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: new Date(earliestMs).toISOString() }],
        activityCandidates: ["Dinner"],
        replyBy: new Date(earliestMs + DAY).toISOString(),
      }),
    isCode("BAD_REQUEST"),
  );
});

test("a replyBy at or before the vote close (decidesBy) is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const earliestMs = Date.now() + 6 * DAY;
  const decidesBy = new Date(Date.now() + 2 * DAY).toISOString();
  // reply-by must sit AFTER the vote closes; pin it before decidesBy.
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: new Date(earliestMs).toISOString() }],
        activityCandidates: ["Dinner"],
        decidesBy,
        replyBy: new Date(Date.now() + DAY).toISOString(),
      }),
    isCode("BAD_REQUEST"),
  );
});

test("an invalid (NaN) replyBy is BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: futureTime(5) }],
        activityCandidates: ["Dinner"],
        replyBy: "nope",
      }),
    isCode("BAD_REQUEST"),
  );
});

// ----- time candidates: dedup, anchoring, validity -----

// Regression: create now collapses same-minute time candidates (events.ts), matching addCandidate,
// so a single intended slot sent twice stays one row instead of splitting the vote.
test("duplicate time candidates collapse to one row", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const t = futureTime(3);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: t }, { startsAt: t }],
    activityCandidates: ["Dinner"],
  });
  const times = (await candidatesOf(id)).filter((c) => c.kind === "time");
  assert.equal(times.length, 1, "the duplicate instant is de-duplicated");
});

test("the earliest time candidate anchors startsAt", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const earliestMs = Date.now() + 3 * DAY;
  const laterMs = Date.now() + 5 * DAY;
  const { id } = await caller(u).events.create({
    groupId: g,
    // pass out of order to prove the server picks the earliest, not the first
    timeCandidates: [
      { startsAt: new Date(laterMs).toISOString() },
      { startsAt: new Date(earliestMs).toISOString() },
    ],
    activityCandidates: ["Dinner"],
  });
  const e = await row(id);
  assert.equal(e.startsAt.getTime(), earliestMs, "startsAt is the earliest candidate");
});

test("an invalid (NaN) time candidate is rejected", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  // A lone invalid time, with lockTimes, should fail: after dropping the NaN the time axis is
  // empty, so a locked-but-empty time axis is illegal. This proves NaN times do not persist.
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: "garbage-date" }],
        activityCandidates: ["Dinner"],
        lockTimes: true,
        lockActivity: true,
      }),
    isCode("BAD_REQUEST"),
  );
});

// Regression (D1): a malformed time-instant string is rejected at the schema boundary (the shared
// Instant refinement), so a request mixing a valid and a garbage time fails outright rather than
// silently dropping the bad candidate and persisting a half-built plan.
test("an invalid time candidate is rejected, never silently dropped alongside valid ones", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: futureTime(3) }, { startsAt: "garbage-date" }],
        activityCandidates: ["Dinner"],
      }),
    isCode("BAD_REQUEST"),
  );
});

// Regression (A5): a valid time in the PAST would give a collecting plan an already-expired default
// decides-by, so it self-fizzles on first read. The server rejects a past time outright instead.
test("a past time candidate is rejected with BAD_REQUEST", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [{ startsAt: new Date(Date.now() - DAY).toISOString() }],
        activityCandidates: ["Dinner"],
      }),
    isCode("BAD_REQUEST"),
  );
});

test("a past time mixed with a future one is rejected (no plan is created)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  await assert.rejects(
    () =>
      caller(u).events.create({
        groupId: g,
        timeCandidates: [
          { startsAt: futureTime(3) },
          { startsAt: new Date(Date.now() - HOUR).toISOString() },
        ],
        activityCandidates: ["Dinner"],
      }),
    isCode("BAD_REQUEST"),
  );
});

// Regression (A4): create dedupes activity candidates case-insensitively (keeping the first), so a
// label sent twice stays one row instead of splitting the vote, and the both-axes-pinned moment
// shortcut still fires for "duplicate" locked activities. Whitespace-only labels are dropped.
test("duplicate activity candidates collapse case-insensitively to one row, keeping the first", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner", "dinner", "DINNER"],
  });
  const acts = (await candidatesOf(id)).filter((c) => c.kind === "activity");
  assert.equal(acts.length, 1, "the case-variant duplicates collapse to one activity row");
  assert.equal(acts[0].label, "Dinner", "the first occurrence's casing is kept");
});

test("a single time + duplicate locked activities still opens the moment shortcut", async () => {
  // After dedupe the activity axis has exactly one candidate, so a both-pinned plan opens a moment
  // rather than wrongly collecting on two rows that are really the same activity.
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner", "Dinner"],
    lockTimes: true,
    lockActivity: true,
  });
  const e = await row(id);
  assert.equal(e.phase, "moment", "duplicate locked activities collapse to one, so a moment opens");
  assert.equal(e.activity, "Dinner");
});

// ----- candidate persistence + flags round-trip -----

test("activity candidates are persisted as activity-kind rows", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner", "Bowling"],
  });
  const acts = (await candidatesOf(id)).filter((c) => c.kind === "activity");
  assert.deepEqual(new Set(acts.map((a) => a.label)), new Set(["Dinner", "Bowling"]));
});

test("the lock flags round-trip onto the stored plan", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    lockTimes: true,
    lockActivity: false,
  });
  const e = await row(id);
  assert.equal(e.lockTimes, true);
  assert.equal(e.lockActivity, false);
});

test("a plan is always created anonymous", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
  });
  const e = await row(id);
  assert.equal(e.isAnonymous, true, "creator anonymity is always on");
});

test("a collecting plan has no activity name yet (it is vote-decided at lock)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner", "Bowling"],
  });
  const e = await row(id);
  assert.equal(e.activity, "", "the stored activity stays empty until the vote locks it");
});

test("location and notes round-trip onto the plan", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const { id } = await caller(u).events.create({
    groupId: g,
    timeCandidates: [{ startsAt: futureTime(3) }],
    activityCandidates: ["Dinner"],
    location: "The Pub",
    description: "bring cash",
  });
  const e = await row(id);
  assert.equal(e.location, "The Pub");
  assert.equal(e.description, "bring cash");
});
