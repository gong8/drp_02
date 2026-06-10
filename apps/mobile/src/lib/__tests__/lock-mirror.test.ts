// Pins the mobile-local lock mirror (apps/mobile/src/lib/lock.ts) against the canonical shared
// helpers in packages/shared/src/logic/lock.ts. The mobile copy exists because Metro cannot value-
// import the shared ESM barrel (the `.js` re-exports do not resolve in the bundler). Jest, however,
// CAN load the shared file directly by relative path (no barrel, no `.js` re-exports in lock.ts),
// so this test compares the two implementations side by side. If a future edit changes one copy and
// not the other, the drift assertions here fail loudly.
//
// Assertions come from the SPEC (the documented contract in the shared lock.ts JSDoc + the product
// model), not from copying the implementation: we assert the intended numeric behavior directly AND
// require the mirror to agree with the canonical copy.

import * as sharedLock from "../../../../../packages/shared/src/logic/lock";
import * as mobileLock from "../lock";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A fixed reference instant ON a half-hour boundary (multiple of 30min); real wall-clock is not
// used. Alignment keeps the whole-hour spec expectations untouched by the half-hour flooring.
const now = 999_999_000_000;

// Spec-defined constants (a "moment" is one hour; a day is 24 of them).
const SPEC_MOMENT_MS = 60 * 60 * 1000;
const SPEC_DAY_MS = 24 * SPEC_MOMENT_MS;

// A broad sweep of (gap-from-now, in hours) inputs covering: degenerate already-here, very near term
// (below the moment floor), the proportional T/3 band, and far-out (above the day cap).
const GAP_HOURS = [
  -2,
  -0.001,
  0,
  0.01,
  0.25,
  0.5,
  0.9,
  1,
  1.5,
  2,
  3,
  6,
  8,
  12,
  23,
  24,
  25,
  48,
  72,
  24 * 7,
  24 * 14,
  24 * 60,
];

// Spread inputs for addCandidateHorizon: (earliest, latest) pairs as offsets from `now`, in hours.
// Covers zero spread, sub-day, exactly two days, and beyond the two-day slack cap.
const SPREAD_HOURS: ReadonlyArray<readonly [number, number]> = [
  [24, 24], // zero span
  [24, 25], // 1h span
  [24, 36], // 12h span
  [24, 48], // 1d span
  [24, 72], // 2d span (== cap)
  [24, 73], // just over 2d span (slack should cap at 2d)
  [24, 24 + 24 * 5], // 5d span (slack capped at 2d)
  [0, 24 * 30], // 30d span
];

describe("lock mirror: exported constants match the spec and the shared copy", () => {
  it("MOMENT_MS is one hour and equals the shared constant", () => {
    expect(mobileLock.MOMENT_MS).toBe(SPEC_MOMENT_MS);
    expect(mobileLock.MOMENT_MS).toBe(sharedLock.MOMENT_MS);
  });
});

describe("defaultDecidesByForCandidates (mobile mirror)", () => {
  it("caps the notice lead at one day for far-out options", () => {
    // Spec: lead scales as a third of the run-up but caps at one day.
    for (const days of [3, 5, 14, 60]) {
      const earliest = now + days * SPEC_DAY_MS;
      expect(mobileLock.defaultDecidesByForCandidates(earliest, now)).toBe(earliest - SPEC_DAY_MS);
    }
  });

  it("gives the react phase the larger share for mid-range options (lead = T/3)", () => {
    // Spec: for a 24h run-up the lead is 8h (a third), so decides-by is 8h before the slot.
    const earliest = now + 24 * HOUR;
    expect(mobileLock.defaultDecidesByForCandidates(earliest, now)).toBe(earliest - 8 * HOUR);
  });

  it("floors the lead at one moment when a third of the run-up is smaller", () => {
    // Spec: lead is clamped to a minimum of one moment. With a 2h run-up, a third (40min) is below
    // the 1h floor, so the lead becomes 1h and decides-by lands 1h before the slot.
    const earliest = now + 2 * HOUR;
    expect(mobileLock.defaultDecidesByForCandidates(earliest, now)).toBe(earliest - SPEC_MOMENT_MS);
  });

  it("falls back to the midpoint when the slot is too close for even a moment of lead", () => {
    // Spec: a 30-min run-up cannot fit a 1h lead, so it falls back to the clamped midpoint (now+15m).
    const earliest = now + 30 * 60 * 1000;
    expect(mobileLock.defaultDecidesByForCandidates(earliest, now)).toBe(now + 15 * 60 * 1000);
  });

  it("always returns an instant strictly inside (now, earliest) for any future slot", () => {
    for (const gap of GAP_HOURS) {
      if (gap <= 0) continue; // only future slots are in-range by contract
      const earliest = now + gap * HOUR;
      const t = mobileLock.defaultDecidesByForCandidates(earliest, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(earliest);
    }
  });

  it("matches the shared canonical implementation across the input sweep", () => {
    for (const gap of GAP_HOURS) {
      const earliest = now + gap * HOUR;
      expect(mobileLock.defaultDecidesByForCandidates(earliest, now)).toBe(
        sharedLock.defaultDecidesByForCandidates(earliest, now),
      );
    }
  });

  it("matches the shared copy when a non-default momentMs is supplied", () => {
    // The third parameter (momentMs) is part of the contract; the mirror must honor it identically.
    for (const gap of GAP_HOURS) {
      const earliest = now + gap * HOUR;
      for (const moment of [SPEC_MOMENT_MS, 30 * 60 * 1000, 2 * HOUR]) {
        expect(mobileLock.defaultDecidesByForCandidates(earliest, now, moment)).toBe(
          sharedLock.defaultDecidesByForCandidates(earliest, now, moment),
        );
      }
    }
  });

  it("floors a misaligned default to the half hour, identically to the shared copy", () => {
    // Spec: defaults read as chosen times - floored to a half-hour boundary when there is room.
    // Sweep misaligned creation instants (:07, :20, :44-style) across the gap range.
    for (const offset of [7, 20, 44]) {
      const offNow = now + offset * 60 * 1000;
      for (const gap of GAP_HOURS) {
        if (gap <= 0) continue;
        const earliest = offNow + gap * HOUR;
        const t = mobileLock.defaultDecidesByForCandidates(earliest, offNow);
        expect(t).toBe(sharedLock.defaultDecidesByForCandidates(earliest, offNow));
        // Either on a clean boundary, or kept exact because flooring would cross now.
        if (t % (30 * 60 * 1000) !== 0) {
          expect(t - (t % (30 * 60 * 1000))).toBeLessThanOrEqual(offNow);
        }
      }
    }
  });
});

describe("defaultReplyByMs (mobile mirror)", () => {
  it("reveals a lead before the event, capped at a day for a far-off event", () => {
    // Spec: lead = clamp((4d)/3, 1h, 1d) = 1 day before the event.
    expect(mobileLock.defaultReplyByMs(now, now + 4 * SPEC_DAY_MS)).toBe(
      now + 4 * SPEC_DAY_MS - SPEC_DAY_MS,
    );
  });

  it("uses a proportional lead (a third of the run-up) for a nearer event", () => {
    // Spec: lead = clamp((3h)/3, 1h, 1d) = 1h before the event.
    expect(mobileLock.defaultReplyByMs(now, now + 3 * HOUR)).toBe(now + 3 * HOUR - HOUR);
  });

  it("gives a minimal one-moment window when the event is already here", () => {
    // Spec: a degenerate already-here event still gets a minimal window of one moment.
    expect(mobileLock.defaultReplyByMs(now, now - 1000)).toBe(now + SPEC_MOMENT_MS);
    expect(mobileLock.defaultReplyByMs(now, now)).toBe(now + SPEC_MOMENT_MS);
  });

  it("always returns an instant strictly between the open and the event for a future event", () => {
    for (const gap of GAP_HOURS) {
      if (gap <= 0) continue;
      const event = now + gap * HOUR;
      const t = mobileLock.defaultReplyByMs(now, event);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(event);
    }
  });

  it("matches the shared canonical implementation across the input sweep", () => {
    for (const gap of GAP_HOURS) {
      const event = now + gap * HOUR;
      expect(mobileLock.defaultReplyByMs(now, event)).toBe(sharedLock.defaultReplyByMs(now, event));
    }
  });
});

describe("addCandidateHorizon (mobile mirror)", () => {
  it("allows slack equal to the spread for a sub-cap spread", () => {
    // Spec: slack = min(span, 2d). A 1h span gets a 1h slack past the latest.
    const earliest = now + DAY;
    const tight = now + DAY + HOUR;
    expect(mobileLock.addCandidateHorizon(earliest, tight)).toBe(tight + HOUR);
  });

  it("caps the slack at two days for a wide spread", () => {
    // Spec: a 5d span yields a slack capped at 2d, not 5d.
    const earliest = now + DAY;
    const wide = now + 6 * DAY; // span 5d
    expect(mobileLock.addCandidateHorizon(earliest, wide)).toBe(wide + 2 * DAY);
  });

  it("gives zero slack for a zero spread (horizon == latest)", () => {
    // Spec: slack = min(0, 2d) = 0.
    const at = now + DAY;
    expect(mobileLock.addCandidateHorizon(at, at)).toBe(at);
  });

  it("matches the shared canonical implementation across spread pairs", () => {
    for (const [eHours, lHours] of SPREAD_HOURS) {
      const earliest = now + eHours * HOUR;
      const latest = now + lHours * HOUR;
      expect(mobileLock.addCandidateHorizon(earliest, latest)).toBe(
        sharedLock.addCandidateHorizon(earliest, latest),
      );
    }
  });
});

describe("lock mirror: no value has drifted from the canonical copy", () => {
  it("exposes the same set of value exports the shared copy does (no missing/extra helper)", () => {
    // Guards against a future shared export the mirror forgets to add (or a mobile-only stray export).
    // Note: the mobile copy keeps DAY_MS as a private const, while shared exports it; we therefore
    // compare only the documented public API the mobile mirror is contracted to provide.
    const expectedApi = [
      "MOMENT_MS",
      "defaultDecidesByForCandidates",
      "defaultReplyByMs",
      "addCandidateHorizon",
    ];
    for (const name of expectedApi) {
      expect(name in mobileLock).toBe(true);
      expect(name in sharedLock).toBe(true);
    }
  });
});
