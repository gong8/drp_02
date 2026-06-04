import {
  activeDeadline,
  type Bucketable,
  compareForDisplay,
  isActionRequired,
  isPast,
  planBucket,
} from "./status";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const PAST = new Date(NOW - 86_400_000).toISOString();
const SOON = new Date(NOW + 3_600_000).toISOString();
const LATER = new Date(NOW + 86_400_000).toISOString();

type Plan = Bucketable & { iReacted: boolean; iResponded: boolean };
function plan(p: Partial<Plan>): Plan {
  return {
    phase: "collecting",
    myStatus: "reacting",
    startsAt: LATER,
    decidesBy: SOON,
    momentEndsAt: null,
    iReacted: false,
    iResponded: false,
    ...p,
  };
}

test("isPast trusts startsAt only once a slot is locked", () => {
  expect(isPast(plan({ phase: "cleared", startsAt: PAST }), NOW)).toBe(true);
  expect(isPast(plan({ phase: "moment", startsAt: PAST }), NOW)).toBe(true);
  expect(isPast(plan({ phase: "cleared", startsAt: LATER }), NOW)).toBe(false);
  // A collecting placeholder startsAt in the past is NOT past (the time is not decided yet).
  expect(isPast(plan({ phase: "collecting", startsAt: PAST }), NOW)).toBe(false);
});

test("planBucket: going only while upcoming", () => {
  expect(planBucket(plan({ myStatus: "going", phase: "cleared", startsAt: LATER }), NOW)).toBe(
    "going",
  );
  expect(planBucket(plan({ myStatus: "going", phase: "cleared", startsAt: PAST }), NOW)).toBe(
    "done",
  );
});

test("planBucket: open is engaged + undecided + upcoming", () => {
  expect(planBucket(plan({ phase: "collecting", myStatus: "reacting" }), NOW)).toBe("open");
  expect(planBucket(plan({ phase: "moment", myStatus: "awaiting", startsAt: LATER }), NOW)).toBe(
    "open",
  );
});

test("planBucket: the awaiting bug - a cleared past plan you ignored is DONE, not open", () => {
  // Server returns myStatus 'awaiting' for a cleared plan with no response; it must land in Done.
  expect(planBucket(plan({ phase: "cleared", myStatus: "awaiting", startsAt: PAST }), NOW)).toBe(
    "done",
  );
  expect(planBucket(plan({ phase: "fizzled", myStatus: "awaiting" }), NOW)).toBe("done");
  expect(planBucket(plan({ phase: "collecting", myStatus: "declined" }), NOW)).toBe("done");
});

test("isActionRequired: only live plans still wanting you", () => {
  expect(isActionRequired(plan({ phase: "moment", iResponded: false }))).toBe(true);
  expect(isActionRequired(plan({ phase: "moment", iResponded: true }))).toBe(false);
  expect(isActionRequired(plan({ phase: "collecting", iReacted: false }))).toBe(true);
  expect(isActionRequired(plan({ phase: "collecting", iReacted: true }))).toBe(false);
  expect(
    isActionRequired(plan({ phase: "collecting", iReacted: false, myStatus: "declined" })),
  ).toBe(false);
  expect(isActionRequired(plan({ phase: "cleared", iResponded: false }))).toBe(false);
});

test("activeDeadline maps phase to the right field + label", () => {
  expect(activeDeadline(plan({ phase: "moment", momentEndsAt: SOON }))).toEqual({
    iso: SOON,
    label: "RSVP closes",
  });
  expect(activeDeadline(plan({ phase: "collecting", decidesBy: SOON }))).toEqual({
    iso: SOON,
    label: "Voting closes",
  });
  expect(activeDeadline(plan({ phase: "cleared" })).iso).toBeNull();
});

test("compareForDisplay: upcoming soonest-first, then past most-recent-first", () => {
  const upSoon = plan({ phase: "cleared", startsAt: SOON });
  const upLater = plan({ phase: "cleared", startsAt: LATER });
  const pastOld = plan({
    phase: "cleared",
    startsAt: new Date(NOW - 2 * 86_400_000).toISOString(),
  });
  const pastRecent = plan({ phase: "cleared", startsAt: PAST });
  const sorted = [pastOld, upLater, pastRecent, upSoon].sort((a, b) =>
    compareForDisplay(a, b, NOW),
  );
  expect(sorted).toEqual([upSoon, upLater, pastRecent, pastOld]);
});
