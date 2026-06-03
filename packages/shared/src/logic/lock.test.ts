import { describe, expect, it } from "vitest";
import {
  addCandidateHorizon,
  DAY_MS,
  defaultLockAtForOptions,
  defaultLockAtForWindow,
  MAX_REACT_MS,
} from "./lock.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = 1_000_000_000_000; // a fixed reference instant

describe("defaultLockAtForOptions", () => {
  it("caps the notice lead at one day for far-out options", () => {
    for (const days of [3, 5, 14]) {
      const earliest = now + days * DAY_MS;
      expect(defaultLockAtForOptions(earliest, now)).toBe(earliest - DAY_MS);
    }
  });

  it("gives the react phase the larger share for mid-range options (lead = T/3)", () => {
    const earliest = now + 24 * HOUR;
    expect(defaultLockAtForOptions(earliest, now)).toBe(earliest - 8 * HOUR);
  });

  it("always returns a value strictly after now and before the earliest slot", () => {
    for (const gapHours of [0.5, 1, 3, 6, 12, 23, 25, 48, 24 * 14]) {
      const earliest = now + gapHours * HOUR;
      const t = defaultLockAtForOptions(earliest, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(earliest);
    }
  });

  it("falls back to a clamped midpoint when the slot is too close for the lead", () => {
    const earliest = now + 30 * 60 * 1000; // 30 min out
    expect(defaultLockAtForOptions(earliest, now)).toBe(now + 15 * 60 * 1000);
  });
});

describe("defaultLockAtForWindow", () => {
  it("locks after ~a third of a short window", () => {
    const last = now + 6 * HOUR;
    expect(defaultLockAtForWindow(last, now)).toBe(now + 2 * HOUR);
  });

  it("caps the react window at three days for a long window", () => {
    const last = now + 14 * DAY_MS;
    expect(defaultLockAtForWindow(last, now)).toBe(now + MAX_REACT_MS);
  });

  it("always returns a value strictly after now and before the last slot", () => {
    for (const spanHours of [1, 4, 24, 24 * 7, 24 * 14]) {
      const last = now + spanHours * HOUR;
      const t = defaultLockAtForWindow(last, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(last);
    }
  });

  it("falls back to the midpoint when the whole window fits inside one moment", () => {
    const last = now + 30 * 60 * 1000; // 30 min span
    expect(defaultLockAtForWindow(last, now)).toBe(now + 15 * 60 * 1000);
  });
});

describe("addCandidateHorizon", () => {
  it("for fuzzy plans is exactly the last window slot", () => {
    const earliest = now + DAY_MS;
    const latest = now + 7 * DAY_MS;
    expect(addCandidateHorizon(earliest, latest, true)).toBe(latest);
  });

  it("for options plans allows a small slack past the spread, capped at two days", () => {
    const earliest = now + DAY_MS;
    const latest = now + 3 * DAY_MS; // span 2 days
    expect(addCandidateHorizon(earliest, latest, false)).toBe(latest + 2 * DAY_MS);
    const tight = now + DAY_MS + HOUR; // span 1h -> slack 1h
    expect(addCandidateHorizon(now + DAY_MS, tight, false)).toBe(tight + HOUR);
    // span=5d -> slack capped at 2d, not 5d
    const wide = now + 6 * DAY;
    expect(addCandidateHorizon(now + DAY, wide, false)).toBe(wide + 2 * DAY);
  });
});
