import { describe, expect, it } from "vitest";
import {
  addCandidateHorizon,
  DAY_MS,
  defaultDecidesByForCandidates,
  defaultReplyByMs,
  MOMENT_MS,
} from "./lock.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const HALF_HOUR = 30 * 60 * 1000;
// A fixed reference instant ON a half-hour boundary (a multiple of 30min), so whole-hour-offset
// expectations are untouched by the defaults' half-hour flooring; the flooring itself is asserted
// separately with a misaligned now below.
const now = 999_999_000_000;

describe("defaultDecidesByForCandidates", () => {
  it("caps the notice lead at one day for far-out options", () => {
    for (const days of [3, 5, 14]) {
      const earliest = now + days * DAY_MS;
      expect(defaultDecidesByForCandidates(earliest, now)).toBe(earliest - DAY_MS);
    }
  });

  it("gives the react phase the larger share for mid-range options (lead = T/3)", () => {
    const earliest = now + 24 * HOUR;
    expect(defaultDecidesByForCandidates(earliest, now)).toBe(earliest - 8 * HOUR);
  });

  it("always returns a value strictly after now and before the earliest slot", () => {
    for (const gapHours of [0.5, 1, 3, 6, 12, 23, 25, 48, 24 * 14]) {
      const earliest = now + gapHours * HOUR;
      const t = defaultDecidesByForCandidates(earliest, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(earliest);
    }
  });

  it("falls back to a clamped midpoint when the slot is too close for the lead", () => {
    const earliest = now + 30 * 60 * 1000; // 30 min out
    expect(defaultDecidesByForCandidates(earliest, now)).toBe(now + 15 * 60 * 1000);
  });

  it("floors a misaligned default to the half hour, so it reads as a chosen time", () => {
    // Created at a 13:07-style instant: the exact lead would land at :07 too; the default must
    // land on a half-hour boundary in the same neighborhood (within 30min below the exact lead).
    const offNow = now + 7 * 60 * 1000;
    const earliest = offNow + 3 * DAY_MS;
    const t = defaultDecidesByForCandidates(earliest, offNow);
    expect(t % HALF_HOUR).toBe(0);
    expect(t).toBeGreaterThan(earliest - DAY_MS - HALF_HOUR);
    expect(t).toBeLessThanOrEqual(earliest - DAY_MS);
  });

  it("skips the flooring when it would cross now (correctness beats prettiness)", () => {
    // now sits 20min past a boundary and the ideal only 5min later: flooring would land before
    // now, so the exact instant is kept.
    const offNow = now + 20 * 60 * 1000;
    const earliest = offNow + 65 * 60 * 1000; // lead floors to 1h -> ideal = offNow + 5min
    expect(defaultDecidesByForCandidates(earliest, offNow)).toBe(offNow + 5 * 60 * 1000);
  });
});

describe("defaultReplyByMs", () => {
  it("reveals a lead before the event, capped at a day for a far-off event", () => {
    // lead = clamp((4d)/3, 1h, 1d) = 1 day before the event
    expect(defaultReplyByMs(now, now + 4 * DAY_MS)).toBe(now + 4 * DAY_MS - DAY_MS);
  });

  it("uses a proportional lead (a third of the run-up) for a nearer event", () => {
    // lead = clamp((3h)/3, 1h, 1d) = 1h before the event
    expect(defaultReplyByMs(now, now + 3 * HOUR)).toBe(now + 3 * HOUR - HOUR);
  });

  it("gives a minimal window when the event is already here", () => {
    expect(defaultReplyByMs(now, now - 1000)).toBe(now + MOMENT_MS);
  });

  it("always returns an instant strictly between the open and the event", () => {
    for (const gapHours of [0.5, 2, 12, 25, 24 * 14]) {
      const event = now + gapHours * HOUR;
      const t = defaultReplyByMs(now, event);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(event);
    }
  });
});

describe("addCandidateHorizon", () => {
  it("allows a small slack past the spread, capped at two days", () => {
    const earliest = now + DAY_MS;
    const latest = now + 3 * DAY_MS; // span 2 days
    expect(addCandidateHorizon(earliest, latest)).toBe(latest + 2 * DAY_MS);
    const tight = now + DAY_MS + HOUR; // span 1h -> slack 1h
    expect(addCandidateHorizon(now + DAY_MS, tight)).toBe(tight + HOUR);
    // span = 5d -> slack capped at 2d, not 5d
    const wide = now + 6 * DAY;
    expect(addCandidateHorizon(now + DAY, wide)).toBe(wide + 2 * DAY);
  });
});
