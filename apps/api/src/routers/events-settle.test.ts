// Lazy state-machine tests for the settle-on-read path (events.resolve + events.get drive
// settleLifecycle = settleCollecting then settlePhase). Every assertion is derived from the spec
// in ARCHITECTURE.md / CLAUDE.md, not from the implementation's current output:
//
//   - A collecting plan whose decidesBy has passed auto-locks: -> moment, picks the most-voted
//     time (ties to the earliest), and names the activity from the winning activity candidate
//     ONLY if no activity is already set (a concurrently-set activity is preserved).
//   - A collecting plan with NO time candidates, or with ZERO reactions, fizzles (never opens a
//     phantom moment).
//   - A moment plan past momentEndsAt settles: cleared when quorum is met OR non-contingent;
//     fizzled (silent) when contingent and quorum is not met.
//   - resolve is idempotent and a safe no-op before the deadline.
//
// We drive the machine by planting PAST decidesBy/momentEndsAt on inserted rows.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
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

const PAST = () => new Date(Date.now() - 60_000);
const FUTURE = () => new Date(Date.now() + 60 * 60_000);
const _SOON = () => new Date(Date.now() + 60_000);

async function phaseOf(eventId: string): Promise<string> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row.phase;
}

async function rowOf(eventId: string) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row;
}

// ---------------------------------------------------------------------------
// Collecting -> auto-lock (decidesBy passed, has time + reactions)
// ---------------------------------------------------------------------------

test("resolve auto-locks a collecting plan whose decidesBy has passed into a moment", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 2,
    decidesBy: PAST(),
  });
  const t = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, t, u);

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "moment");
  assert.equal(await phaseOf(e), "moment");
});

test("auto-lock picks the most-voted TIME candidate as the chosen candidate", async () => {
  const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
  const g = await makeGroup([a, b, c]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  // t1 earlier with 1 vote; t2 later with 2 votes -> t2 (the most-voted) must win.
  const t1At = new Date(Date.now() + 60 * 60_000);
  const t2At = new Date(Date.now() + 2 * 60 * 60_000);
  const t1 = await insertTimeCandidate(e, t1At);
  const t2 = await insertTimeCandidate(e, t2At);
  await insertReaction(e, t1, a);
  await insertReaction(e, t2, b);
  await insertReaction(e, t2, c);

  await caller(a).events.resolve({ eventId: e });

  const row = await rowOf(e);
  assert.equal(row.chosenCandidateId, t2);
  // The chosen TIME's startsAt is promoted onto the event row.
  assert.equal(row.startsAt.getTime(), t2At.getTime());
});

test("auto-lock breaks a TIME tie toward the earliest candidate", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  // Two equally-voted times. The earlier one (by startsAt) must win.
  const early = new Date(Date.now() + 60 * 60_000);
  const late = new Date(Date.now() + 5 * 60 * 60_000);
  const tEarly = await insertTimeCandidate(e, early);
  const tLate = await insertTimeCandidate(e, late);
  await insertReaction(e, tEarly, a);
  await insertReaction(e, tLate, b);

  await caller(a).events.resolve({ eventId: e });

  const row = await rowOf(e);
  assert.equal(row.chosenCandidateId, tEarly);
});

test("auto-lock names the activity from the winning ACTIVITY candidate when none is set", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    activity: "", // no activity set
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  const t = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, t, a);
  // Bowling (2 votes) beats Picnic (1 vote) -> the plan is named "Bowling".
  const bowling = await insertActivityCandidate(e, "Bowling");
  const picnic = await insertActivityCandidate(e, "Picnic");
  await insertReaction(e, bowling, a);
  await insertReaction(e, bowling, b);
  await insertReaction(e, picnic, b);

  await caller(a).events.resolve({ eventId: e });

  const row = await rowOf(e);
  assert.equal(row.phase, "moment");
  assert.equal(row.activity, "Bowling");
});

test("auto-lock preserves a concurrently-set activity instead of clobbering it with the vote winner", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    activity: "Dinner at Mario's", // already set (e.g. a member edited it)
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  const t = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, t, a);
  // An activity candidate that would otherwise win must NOT overwrite the explicit activity.
  const bowling = await insertActivityCandidate(e, "Bowling");
  await insertReaction(e, bowling, a);
  await insertReaction(e, bowling, b);

  await caller(a).events.resolve({ eventId: e });

  const row = await rowOf(e);
  assert.equal(row.phase, "moment");
  assert.equal(row.activity, "Dinner at Mario's");
});

test("auto-lock opens the moment with a future momentEndsAt so members can still respond", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  const t = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, t, u);

  await caller(u).events.resolve({ eventId: e });

  const row = await rowOf(e);
  assert.equal(row.phase, "moment");
  assert.ok(row.momentEndsAt, "moment must have an end deadline");
  assert.ok(
    (row.momentEndsAt as Date).getTime() > Date.now(),
    "the newly-opened moment must end in the future so the RSVP window is real",
  );
  assert.ok(row.momentStartsAt, "moment must have a start time");
});

test("get also drives the auto-lock (settle runs on every read, not just resolve)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  const t = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, t, u);

  const view = await caller(u).events.get({ id: e });

  assert.ok(view);
  assert.equal(view.phase, "moment");
  assert.equal(await phaseOf(e), "moment");
});

// ---------------------------------------------------------------------------
// Collecting -> fizzle (no time candidates OR zero reactions)
// ---------------------------------------------------------------------------

test("a collecting plan past decidesBy with NO time candidates fizzles (no phantom moment)", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  // Only activity candidates exist, plus a reaction on one - but there is no TIME to lock.
  const act = await insertActivityCandidate(e, "Bowling");
  await insertReaction(e, act, a);

  const res = await caller(a).events.resolve({ eventId: e });

  assert.equal(res.phase, "fizzled");
  assert.equal(await phaseOf(e), "fizzled");
});

test("a collecting plan past decidesBy with a time candidate but ZERO reactions fizzles", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  // A time candidate exists but nobody reacted at all -> nothing wanted it -> fizzle.
  await insertTimeCandidate(e, FUTURE());

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "fizzled");
  assert.equal(await phaseOf(e), "fizzled");
});

test("a single +1 on an ACTIVITY (with a time candidate) keeps the plan alive and it locks a time", async () => {
  // Spec: any +1 - even on an activity - keeps a collecting plan alive; it then locks the
  // best-supported (or first) time. So an activity-only reaction must NOT fizzle when a time exists.
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  const t = await insertTimeCandidate(e, FUTURE());
  const act = await insertActivityCandidate(e, "Bowling");
  await insertReaction(e, act, u); // a reaction, but only on the activity

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "moment");
  const row = await rowOf(e);
  assert.equal(row.chosenCandidateId, t, "the only time must be locked even with no time +1");
});

test("a fizzled-from-collecting plan is marked resolved (status), leaving no live trace", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
  });
  await insertTimeCandidate(e, FUTURE()); // no reactions

  await caller(u).events.resolve({ eventId: e });

  const row = await rowOf(e);
  assert.equal(row.phase, "fizzled");
  assert.equal(row.status, "resolved");
});

// ---------------------------------------------------------------------------
// Moment -> settle (past momentEndsAt)
// ---------------------------------------------------------------------------

test("a moment plan past momentEndsAt clears when quorum is met", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "yes");
  await insertResponse(e, b, "yes"); // 2 IN >= quorum 2

  const res = await caller(a).events.resolve({ eventId: e });

  assert.equal(res.phase, "cleared");
  assert.equal(await phaseOf(e), "cleared");
});

test("a contingent moment plan past momentEndsAt fizzles when quorum is NOT met", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "yes"); // only 1 IN < quorum 2

  const res = await caller(a).events.resolve({ eventId: e });

  assert.equal(res.phase, "fizzled");
  assert.equal(await phaseOf(e), "fizzled");
});

test("a NON-contingent moment plan past momentEndsAt clears even when quorum is not met", async () => {
  // The concrete shortcut "always happens": a non-contingent plan clears regardless of quorum.
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: false, // it's on, who's in
    quorum: 2,
    momentEndsAt: PAST(),
  });
  // Nobody is IN (one explicit no), but a non-contingent plan still happens.
  await insertResponse(e, a, "no");

  const res = await caller(a).events.resolve({ eventId: e });

  assert.equal(res.phase, "cleared");
  assert.equal(await phaseOf(e), "cleared");
});

test("moment settle resolves conditionals server-side: a chain that reaches quorum clears", async () => {
  // a: yes anchors; b: "I'll go if a"; with quorum 2 the resolved IN set is {a,b} -> clears.
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "yes");
  await insertResponse(e, b, "conditional", { mode: "all", targetIds: [a] });

  const res = await caller(a).events.resolve({ eventId: e });

  assert.equal(res.phase, "cleared");
});

test("moment settle: a pure conditional cycle with no yes anchor resolves to NOBODY and fizzles", async () => {
  // a: "if b", b: "if a" - no plain yes to anchor, so resolveIn is empty -> under quorum -> fizzle.
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 1,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "conditional", { mode: "all", targetIds: [b] });
  await insertResponse(e, b, "conditional", { mode: "all", targetIds: [a] });

  const res = await caller(a).events.resolve({ eventId: e });

  assert.equal(res.phase, "fizzled");
});

test("a moment plan past momentEndsAt with zero responses fizzles when contingent (quorum unmet)", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "moment",
    contingent: true,
    quorum: 1,
    momentEndsAt: PAST(),
  });
  // No responses at all.

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "fizzled");
});

// ---------------------------------------------------------------------------
// Idempotence + safe no-op before the deadline
// ---------------------------------------------------------------------------

test("resolve is a safe no-op on a collecting plan whose decidesBy is still in the future", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: FUTURE(), // not yet
  });
  const t = await insertTimeCandidate(e, new Date(Date.now() + 2 * 60 * 60_000));
  await insertReaction(e, t, u);

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "collecting");
  assert.equal(await phaseOf(e), "collecting");
});

test("resolve is a safe no-op on a moment plan whose momentEndsAt is still in the future", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "moment",
    contingent: true,
    quorum: 5, // would fizzle if it settled now
    momentEndsAt: FUTURE(),
  });

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "moment");
  assert.equal(await phaseOf(e), "moment");
});

test("resolve does not settle a collecting plan with NO decidesBy set", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: null, // never converges on its own
  });
  await insertTimeCandidate(e, FUTURE());

  const res = await caller(u).events.resolve({ eventId: e });

  assert.equal(res.phase, "collecting");
});

test("resolve is idempotent: a second call after a clear leaves the phase cleared", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "yes");
  await insertResponse(e, b, "yes");

  const first = await caller(a).events.resolve({ eventId: e });
  const second = await caller(a).events.resolve({ eventId: e });

  assert.equal(first.phase, "cleared");
  assert.equal(second.phase, "cleared");
  assert.equal(await phaseOf(e), "cleared");
});

test("resolve is idempotent across the full collecting->moment chain in a single call sequence", async () => {
  // settleLifecycle runs settleCollecting THEN settlePhase. With a past decidesBy AND a past
  // momentEndsAt the plan would lock then immediately try to settle the moment - but the freshly
  // opened moment gets a FUTURE end, so a single resolve lands in 'moment' and stays there.
  const u = await makeUser();
  const g = await makeGroup([u]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "collecting",
    contingent: true,
    quorum: 1,
    decidesBy: PAST(),
    momentEndsAt: PAST(), // stale leftover; auto-lock must overwrite it with a future window
  });
  const t = await insertTimeCandidate(e, FUTURE());
  await insertReaction(e, t, u);

  const first = await caller(u).events.resolve({ eventId: e });
  const second = await caller(u).events.resolve({ eventId: e });

  assert.equal(first.phase, "moment");
  assert.equal(second.phase, "moment");
});

test("resolve never resurrects an already-cleared plan and never changes a cleared/fizzled phase", async () => {
  const u = await makeUser();
  const g = await makeGroup([u]);
  const cleared = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "cleared",
    status: "resolved",
    momentEndsAt: PAST(),
  });
  const fizzled = await insertEvent({
    groupId: g,
    createdByUserId: u,
    phase: "fizzled",
    status: "resolved",
    decidesBy: PAST(),
  });

  const r1 = await caller(u).events.resolve({ eventId: cleared });
  const r2 = await caller(u).events.resolve({ eventId: fizzled });

  assert.equal(r1.phase, "cleared");
  assert.equal(r2.phase, "fizzled");
});

// ---------------------------------------------------------------------------
// Access boundary on the settle entrypoints
// ---------------------------------------------------------------------------

test("resolve rejects a non-member with FORBIDDEN", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const g = await makeGroup([owner]); // outsider is NOT a member
  const e = await insertEvent({
    groupId: g,
    createdByUserId: owner,
    phase: "moment",
    contingent: true,
    quorum: 1,
    momentEndsAt: PAST(),
  });

  await assert.rejects(
    () => caller(outsider).events.resolve({ eventId: e }),
    (err) => err instanceof TRPCError && err.code === "FORBIDDEN",
  );
});

test("resolve rejects a missing event with NOT_FOUND (checked before membership)", async () => {
  const u = await makeUser();
  await makeGroup([u]);

  await assert.rejects(
    () => caller(u).events.resolve({ eventId: "e_does_not_exist" }),
    (err) => err instanceof TRPCError && err.code === "NOT_FOUND",
  );
});

test("get returns null for a missing event rather than throwing", async () => {
  const u = await makeUser();
  await makeGroup([u]);

  const view = await caller(u).events.get({ id: "e_missing" });

  assert.equal(view, null);
});

// ---------------------------------------------------------------------------
// get reflects the post-settle view (the read both drives and shows the transition)
// ---------------------------------------------------------------------------

test("get on a fizzled-via-settle moment shows fizzled and does not reveal a going crowd", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 5, // unreachable -> fizzle
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "yes");

  const view = await caller(a).events.get({ id: e });

  assert.ok(view);
  assert.equal(view.phase, "fizzled");
  // A fizzle reveals nothing: the IN crowd must stay hidden.
  assert.equal(view.revealed, false);
  assert.deepEqual(view.going, []);
});

test("get on a cleared-via-settle moment reveals the resolved IN crowd", async () => {
  const [a, b] = [await makeUser(), await makeUser()];
  const g = await makeGroup([a, b]);
  const e = await insertEvent({
    groupId: g,
    createdByUserId: a,
    phase: "moment",
    contingent: true,
    quorum: 2,
    momentEndsAt: PAST(),
  });
  await insertResponse(e, a, "yes");
  await insertResponse(e, b, "yes");

  const view = await caller(a).events.get({ id: e });

  assert.ok(view);
  assert.equal(view.phase, "cleared");
  assert.equal(view.revealed, true);
  const goingIds = view.going.map((p) => p.id).sort();
  assert.deepEqual(goingIds, [a, b].sort());
});
