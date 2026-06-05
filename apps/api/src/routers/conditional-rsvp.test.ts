// End-to-end conditional RSVP resolution through the procedures.
//
// resolveIn has pure unit tests (packages/shared/src/logic/resolve.test.ts); this file exercises
// the WIRING around it - the persistence + read path. Members RSVP through events.respond (so the
// conditional's { mode, targetIds } round-trips through the jsonb column), the moment settles past
// its momentEndsAt, and we assert who ends up GOING via the revealed crowd (events.get) and whether
// the plan clears (events.resolve). Every assertion is derived from the SPEC (ARCHITECTURE.md +
// CLAUDE.md + resolve.ts doc), not from the implementation's current output:
//
//   - A plain yes anchors the IN set; "I'll go if [A]" latches IN once A is IN; chains cascade
//     (C if B, B if A, A yes -> all three IN).
//   - mode "all" needs EVERY target IN; mode "any" needs just ONE.
//   - A pure conditional cycle (A if B, B if A) with no yes anchor resolves to NOBODY (no phantom).
//   - Resolved conditionals count toward quorum/clearing; a plain "no" never counts toward IN.
//
// We drive the moment live, then push momentEndsAt into the past (a stored-deadline manipulation,
// never a sleep) so settle + reveal both fire on the next read.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import {
  caller,
  db,
  dropTestDb,
  events,
  insertEvent,
  makeGroup,
  makeUsers,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const FUTURE_MS = 60 * 60 * 1000; // a live moment one hour out: reads will not lazily settle it.

// A live blind moment with `n` members (all in one group). Returns the member ids (members[0] is
// also the creator) and the eventId. quorum/contingent are overridable to drive clearing behavior.
async function liveMoment(
  n: number,
  opts: { quorum?: number; contingent?: boolean } = {},
): Promise<{ members: string[]; eventId: string }> {
  const members = await makeUsers(n);
  const groupId = await makeGroup(members);
  const now = new Date();
  const eventId = await insertEvent({
    groupId,
    createdByUserId: members[0],
    phase: "moment",
    contingent: opts.contingent ?? true,
    quorum: opts.quorum ?? 2,
    momentStartsAt: now,
    momentEndsAt: new Date(Date.now() + FUTURE_MS),
    startsAt: new Date(Date.now() + FUTURE_MS),
    respondByAt: new Date(Date.now() + FUTURE_MS),
  });
  return { members, eventId };
}

// End the blind window by moving the stored deadline into the past (no sleeps). The next read then
// reveals the resolved crowd and runs settlePhase.
async function endMomentNow(eventId: string): Promise<void> {
  await db
    .update(events)
    .set({ momentEndsAt: new Date(Date.now() - 60_000) })
    .where(eq(events.id, eventId));
}

// Read the revealed IN crowd as a sorted id list, asserting the plan CLEARED (a cleared moment
// reveals its IN crowd; a fizzle reveals nothing - that path is asserted separately). Drives the
// moment to its end first, then reads via events.get so the assertion exercises the full chain
// respond -> persist -> settle -> reveal end to end.
async function goingIdsAfterClear(eventId: string, reader: string): Promise<string[]> {
  await endMomentNow(eventId);
  const view = await caller(reader).events.get({ id: eventId });
  assert.ok(view, "the moment is readable after it ends");
  assert.equal(view.phase, "cleared", "a moment that reaches quorum clears");
  assert.equal(view.revealed, true, "a cleared moment reveals its IN crowd");
  return view.going.map((p) => p.id).sort();
}

// Drive the moment to its end and assert it FIZZLED (silent dead-end): per the privacy spec a
// fizzle reveals nothing, so the crowd stays hidden no matter who answered. This is the correct
// shape for "resolves to NOBODY / under quorum" outcomes on a contingent plan.
async function assertFizzledAndHidden(eventId: string, reader: string): Promise<void> {
  await endMomentNow(eventId);
  const view = await caller(reader).events.get({ id: eventId });
  assert.ok(view, "the plan is readable after the window closes");
  assert.equal(view.phase, "fizzled", "an under-quorum contingent plan fizzles");
  assert.equal(view.revealed, false, "a fizzle reveals nothing - no trace");
  assert.deepEqual(view.going, [], "a fizzle never reveals a going crowd");
}

async function phaseOf(eventId: string): Promise<string> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row.phase;
}

// ---------------------------------------------------------------------------
// A plain yes anchors; a conditional latches once its target is IN; chains cascade.
// ---------------------------------------------------------------------------

test("a plain yes ends up going; a plain no does not", async () => {
  const { members, eventId } = await liveMoment(2, { quorum: 1 });
  const [a, b] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "no" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a], "only the yes is IN - a no never counts toward going");
});

test('an "I\'ll go if [A]" latches IN once A says yes (mode all, single target)', async () => {
  const { members, eventId } = await liveMoment(2, { quorum: 1 });
  const [a, b] = members;

  // b commits conditionally on a; a then anchors with a plain yes.
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(a).events.respond({ eventId, kind: "yes" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, b].sort(), "the conditional latches in behind its now-IN anchor");
});

test("a conditional whose target never says yes is left OUT (no phantom IN)", async () => {
  const { members, eventId } = await liveMoment(2, { quorum: 1 });
  const [a, b] = members;

  // b is in if a, but a declines outright -> a is not IN, so b never latches. IN resolves to
  // NOBODY, which is under quorum, so the contingent plan fizzles (no phantom plan).
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(a).events.respond({ eventId, kind: "no" });

  await assertFizzledAndHidden(eventId, a);
});

test("a 3-link chain cascades: C if B, B if A, A yes -> all three go", async () => {
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [b] },
  });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(a).events.respond({ eventId, kind: "yes" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, b, c].sort(), "the whole chain latches off the single yes anchor");
});

test("the cascade does not depend on response order (chain resolved as a fixpoint)", async () => {
  // Same chain, but the yes anchor is recorded FIRST. The fixpoint must still pull C and B in.
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [b] },
  });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, b, c].sort(), "resolution is order-independent");
});

// ---------------------------------------------------------------------------
// mode "all" needs every target; mode "any" needs just one.
// ---------------------------------------------------------------------------

test('mode "all" stays OUT until EVERY target is IN', async () => {
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  // c is in only if BOTH a AND b are in; only a says yes, b declines -> c stays out.
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a, b] },
  });
  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "no" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a], 'mode "all" requires all targets IN; a partial match is not enough');
});

test('mode "all" comes IN once ALL targets are IN', async () => {
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a, b] },
  });
  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "yes" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, b, c].sort(), 'mode "all" latches once every target is IN');
});

test('mode "any" comes IN as soon as ONE target is IN', async () => {
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  // c is in if a OR b; only a says yes (b declines), which is enough for "any".
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "any", targetIds: [a, b] },
  });
  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "no" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, c].sort(), 'mode "any" needs just one target IN');
});

test('mode "any" stays OUT when NONE of its targets are IN', async () => {
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  // c is in if a OR b, but neither is IN (both decline) -> c stays out. IN resolves to NOBODY,
  // under quorum, so the contingent plan fizzles.
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "any", targetIds: [a, b] },
  });
  await caller(a).events.respond({ eventId, kind: "no" });
  await caller(b).events.respond({ eventId, kind: "no" });

  await assertFizzledAndHidden(eventId, a);
});

// ---------------------------------------------------------------------------
// A pure conditional cycle with no yes anchor resolves to NOBODY.
// ---------------------------------------------------------------------------

test("a pure conditional cycle (A if B, B if A) with no yes anchor goes to NOBODY", async () => {
  const { members, eventId } = await liveMoment(2, { quorum: 1 });
  const [a, b] = members;

  await caller(a).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [b] },
  });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });

  // No yes anchors the cycle, so IN is empty - under quorum, the contingent plan fizzles silently.
  await assertFizzledAndHidden(eventId, a);
});

test("a conditional cycle clears once an external yes breaks it open", async () => {
  // a if c, c if a (a 2-cycle), plus b says yes; b's yes does not feed the cycle, so the cycle
  // stays out - only b is IN. This proves the cycle needs a yes INSIDE the dependency graph.
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  await caller(a).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [c] },
  });
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(b).events.respond({ eventId, kind: "yes" });

  const going = await goingIdsAfterClear(eventId, b);
  assert.deepEqual(going, [b], "an unrelated yes does not resolve a closed conditional cycle");
});

// ---------------------------------------------------------------------------
// Resolved conditionals count toward quorum / clearing; a no never does.
// ---------------------------------------------------------------------------

test("a resolved conditional counts toward quorum so the plan clears", async () => {
  // quorum 2: a yes alone is under quorum, but b's resolved conditional makes IN = {a,b} -> clears.
  const { members, eventId } = await liveMoment(2, { quorum: 2 });
  const [a, b] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });

  await endMomentNow(eventId);
  const res = await caller(a).events.resolve({ eventId });

  assert.equal(res.phase, "cleared", "a resolved conditional is a real commitment toward quorum");
  assert.equal(await phaseOf(eventId), "cleared");
});

test("an UNresolved conditional does NOT count toward quorum (plan fizzles)", async () => {
  // quorum 2: a yes is the only real IN; b's conditional never latches (its target c declines),
  // so IN = {a} < quorum -> a contingent plan fizzles.
  const { members, eventId } = await liveMoment(3, { quorum: 2 });
  const [a, b, c] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [c] },
  });
  await caller(c).events.respond({ eventId, kind: "no" });

  await endMomentNow(eventId);
  const res = await caller(a).events.resolve({ eventId });

  assert.equal(res.phase, "fizzled", "a conditional that never latches cannot prop up quorum");
});

test("a plain no is excluded from the revealed going crowd (it never counts as IN)", async () => {
  // quorum 2: the two yeses clear the plan; the third member's NO must NOT appear in the revealed
  // IN crowd. A clearing scenario lets us actually inspect the crowd (a fizzle would hide it).
  const { members, eventId } = await liveMoment(3, { quorum: 2 });
  const [a, b, c] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "yes" });
  await caller(c).events.respond({ eventId, kind: "no" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, b].sort(), "the no is absent - a no is never part of the IN set");
  assert.ok(!going.includes(c), "the member who said no is not going");
});

test("a plain no keeps the plan under quorum and fizzles it (a no cannot fill quorum)", async () => {
  // quorum 3 with only 2 yeses and one no: the no does not count, so IN = {a,b} < 3 -> fizzle.
  const { members, eventId } = await liveMoment(3, { quorum: 3 });
  const [a, b, c] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "yes" });
  await caller(c).events.respond({ eventId, kind: "no" });

  await endMomentNow(eventId);
  const res = await caller(a).events.resolve({ eventId });

  assert.equal(res.phase, "fizzled", "a no is never part of the IN set, so quorum 3 is unmet");
});

test("the whole resolved chain counts toward quorum (chain of 3 clears at quorum 3)", async () => {
  const { members, eventId } = await liveMoment(3, { quorum: 3 });
  const [a, b, c] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "any", targetIds: [b] },
  });

  await endMomentNow(eventId);
  const res = await caller(a).events.resolve({ eventId });

  assert.equal(res.phase, "cleared", "all three resolved members count toward quorum 3");
  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a, b, c].sort());
});

// ---------------------------------------------------------------------------
// Re-answering and the blind privacy boundary during the live moment.
// ---------------------------------------------------------------------------

test("re-answering yes -> no removes the member from the resolved going crowd", async () => {
  const { members, eventId } = await liveMoment(2, { quorum: 1 });
  const [a, b] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "yes" });
  // b changes their mind before the window closes.
  await caller(b).events.respond({ eventId, kind: "no" });

  const going = await goingIdsAfterClear(eventId, a);
  assert.deepEqual(going, [a], "the latest answer wins, so a switch to no drops them from going");
});

test("flipping the anchor to no collapses everyone who depended on it", async () => {
  // a yes anchors b (if a) and c (if b). Then a flips to no -> the chain unwinds to nobody.
  const { members, eventId } = await liveMoment(3, { quorum: 1 });
  const [a, b, c] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });
  await caller(c).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [b] },
  });
  await caller(a).events.respond({ eventId, kind: "no" });

  // The only anchor is gone, so the whole dependent chain unwinds to NOBODY and the plan fizzles.
  await assertFizzledAndHidden(eventId, a);
});

test("during the live (un-ended) moment the going crowd stays blind (no reveal, no leak)", async () => {
  const { members, eventId } = await liveMoment(2, { quorum: 1 });
  const [a, b] = members;

  await caller(a).events.respond({ eventId, kind: "yes" });
  await caller(b).events.respond({ eventId, kind: "yes" });

  // Read WITHOUT ending the moment: the crowd must not be revealed yet.
  const view = await caller(a).events.get({ id: eventId });
  assert.ok(view);
  assert.equal(view.phase, "moment", "the moment is still live");
  assert.equal(view.revealed, false, "a live moment is blind - the IN crowd is hidden");
  assert.deepEqual(view.going, [], "no crowd is leaked while blind");
});

test("a non-contingent plan clears even when the conditionals all collapse to nobody", async () => {
  // The concrete shortcut always happens. Even with a pure cycle resolving to NOBODY, a
  // non-contingent plan clears (it is on, regardless of who is in).
  const { members, eventId } = await liveMoment(2, { quorum: 5, contingent: false });
  const [a, b] = members;

  await caller(a).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [b] },
  });
  await caller(b).events.respond({
    eventId,
    kind: "conditional",
    cond: { mode: "all", targetIds: [a] },
  });

  await endMomentNow(eventId);
  const res = await caller(a).events.resolve({ eventId });

  assert.equal(res.phase, "cleared", "a non-contingent plan clears regardless of the IN set");
  // The revealed crowd is still nobody - clearing does not invent attendees.
  const view = await caller(a).events.get({ id: eventId });
  assert.ok(view);
  assert.deepEqual(view.going, [], "clearing a non-contingent plan does not phantom-add anyone");
});
