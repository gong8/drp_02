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
const now = 1_000_000_000_000; // a fixed reference instant

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
});

describe("defaultReplyByMs", () => {
  it("caps the blind reply window at one day for a far-off event", () => {
    expect(defaultReplyByMs(now, now + 4 * DAY_MS)).toBe(now + DAY_MS);
  });

  it("runs to the event when it is within a day of opening", () => {
    expect(defaultReplyByMs(now, now + 3 * HOUR)).toBe(now + 3 * HOUR);
  });

  it("gives a minimal window when the event is already here", () => {
    expect(defaultReplyByMs(now, now - 1000)).toBe(now + MOMENT_MS);
  });

  it("always returns an instant after the open and no later than the event", () => {
    for (const gapHours of [0.5, 2, 12, 25, 24 * 14]) {
      const event = now + gapHours * HOUR;
      const t = defaultReplyByMs(now, event);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThanOrEqual(event);
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
