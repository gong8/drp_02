import { describe, expect, it } from "vitest";
import { expandWindow, PART_HOUR } from "./window.js";

// A fixed "now": 2026-06-01 (a Monday) 06:00 local - early enough that every band hour today is
// still ahead, so day-counts are deterministic regardless of the machine's timezone.
const fromMs = new Date(2026, 5, 1, 6, 0, 0, 0).getTime();

describe("expandWindow", () => {
  it("tonight yields a single slot at the band hour", () => {
    const slots = expandWindow("tonight", "evening", fromMs);
    expect(slots).toHaveLength(1);
    expect(slots[0].partOfDay).toBe("evening");
    expect(new Date(slots[0].startsAt).getHours()).toBe(PART_HOUR.evening);
  });

  it("this_week yields 7 day candidates, none in the past", () => {
    const slots = expandWindow("this_week", "afternoon", fromMs);
    expect(slots).toHaveLength(7);
    for (const s of slots) {
      expect(new Date(s.startsAt).getTime()).toBeGreaterThanOrEqual(fromMs);
    }
  });

  it("next_two_weeks yields 14 day candidates", () => {
    expect(expandWindow("next_two_weeks", "morning", fromMs)).toHaveLength(14);
  });

  it("this_weekend yields the upcoming Saturday and Sunday", () => {
    const slots = expandWindow("this_weekend", "evening", fromMs);
    expect(slots).toHaveLength(2);
    expect(new Date(slots[0].startsAt).getDay()).toBe(6);
    expect(new Date(slots[1].startsAt).getDay()).toBe(0);
  });

  it("drops a band hour that has already passed today", () => {
    // now = today 20:00; today's evening (19:00) is gone, so this_week drops from 7 to 6.
    const lateNow = new Date(2026, 5, 1, 20, 0, 0, 0).getTime();
    expect(expandWindow("this_week", "evening", lateNow)).toHaveLength(6);
  });

  it("rolls forward to a future slot when the whole window has already passed", () => {
    // tonight + evening asked at 21:00 (after the 19:00 band) -> tomorrow's evening, never the past.
    const lateNow = new Date(2026, 5, 1, 21, 0, 0, 0).getTime();
    const slots = expandWindow("tonight", "evening", lateNow);
    expect(slots).toHaveLength(1);
    expect(new Date(slots[0].startsAt).getTime()).toBeGreaterThan(lateNow);
  });
});
