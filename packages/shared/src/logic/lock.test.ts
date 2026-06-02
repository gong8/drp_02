import { describe, expect, it } from "vitest";
import { defaultLockAt } from "./lock.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = 1_000_000_000_000; // a fixed reference instant

describe("defaultLockAt", () => {
  it("uses the full day-before lead when there is room", () => {
    const earliest = now + 5 * DAY;
    expect(defaultLockAt(earliest, now)).toBe(earliest - DAY);
  });

  it("always returns a value strictly after now and at or before the earliest slot", () => {
    for (const gapHours of [0.5, 1, 3, 6, 12, 23, 25, 48, 24 * 14]) {
      const earliest = now + gapHours * HOUR;
      const t = defaultLockAt(earliest, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThanOrEqual(earliest);
    }
  });

  it("leaves the moment room to finish before the slot when it can", () => {
    const earliest = now + 6 * HOUR; // a day-before lead is in the past, but there is still room
    const t = defaultLockAt(earliest, now);
    expect(t).toBeLessThanOrEqual(earliest - HOUR); // moment (default 60m) finishes before the event
    expect(t).toBeGreaterThan(now);
  });

  it("falls back toward the midpoint for a near-term plan", () => {
    const earliest = now + 3 * HOUR;
    const t = defaultLockAt(earliest, now);
    // day-before is past; midpoint is now + 1.5h, capped to earliest - 60m = now + 2h -> 1.5h wins
    expect(t).toBe(now + 1.5 * HOUR);
  });

  it("still returns a real window when the slot is too close for a full moment", () => {
    const earliest = now + 30 * 60 * 1000; // 30 min out; earliest - 60m is before now
    const t = defaultLockAt(earliest, now);
    expect(t).toBe(now + 15 * 60 * 1000); // midpoint
    expect(t).toBeGreaterThan(now);
    expect(t).toBeLessThan(earliest);
  });
});
