// Pure date/time/countdown helper contract tests. Assertions derive from the documented
// behaviour in format.ts + ARCHITECTURE.md, not from running the implementation.
//
// Timezone strategy: helpers that read LOCAL getters off a Date (clock12, formatSlot, dayUpper,
// dateStringFrom, timeStringFrom, splitIso) are exercised with instants built via the NUMERIC
// Date constructor (always local wall-clock in every engine), so their local components are fixed
// regardless of the machine's zone. The ms-based countdown helpers take raw numbers and are
// zone-independent. The isoFrom/splitIso round-trip is asserted as a wall-clock invariant, which
// holds in any zone (this is exactly the property the Hermes UTC-vs-local off-by-one would break).

import {
  clock12,
  countdownLabel,
  dateStringFrom,
  dayUpper,
  formatSlot,
  formatTimeLeft,
  isoFrom,
  splitIso,
  timeStringFrom,
} from "../format";

// ---------------------------------------------------------------------------
// isoFrom + splitIso: round-trip and the no-hour-shift guard
// ---------------------------------------------------------------------------

describe("isoFrom + splitIso round-trip", () => {
  test("splitIso(isoFrom(date, time)) returns the original local date and time", () => {
    const date = "2026-06-15";
    const time = "14:30";
    const iso = isoFrom(date, time);
    expect(iso).not.toBeNull();
    if (iso === null) throw new Error("isoFrom returned null for a valid date/time");
    expect(splitIso(iso)).toEqual({ date, time });
  });

  test("round-trips an afternoon time without dropping leading zeros", () => {
    const date = "2026-01-09";
    const time = "08:05";
    const iso = isoFrom(date, time);
    if (iso === null) throw new Error("isoFrom returned null for a valid date/time");
    expect(splitIso(iso)).toEqual({ date, time });
  });

  test("round-trips midnight (00:00)", () => {
    const date = "2026-12-31";
    const time = "00:00";
    const iso = isoFrom(date, time);
    if (iso === null) throw new Error("isoFrom returned null for a valid date/time");
    expect(splitIso(iso)).toEqual({ date, time });
  });

  test("isoFrom interprets the input as LOCAL wall-clock - reading it back yields the same hour (no UTC off-by-one)", () => {
    // The Hermes bug: new Date("2026-06-15T14:30") parses as UTC, so in a +1 zone the read-back
    // hour would be 15, not 14. The numeric Date constructor used by isoFrom interprets the input
    // as local, so the local getters round-trip exactly. Asserting the read-back equals the input
    // is zone-independent and catches a regression to string parsing.
    const iso = isoFrom("2026-06-15", "14:30");
    if (iso === null) throw new Error("isoFrom returned null for a valid date/time");
    const back = new Date(iso);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(5); // June is month index 5
    expect(back.getDate()).toBe(15);
    expect(back.getHours()).toBe(14);
    expect(back.getMinutes()).toBe(30);
  });

  test("isoFrom returns a UTC ISO string (ends in Z)", () => {
    const iso = isoFrom("2026-06-15", "14:30");
    expect(iso).not.toBeNull();
    expect(iso).toMatch(/Z$/);
  });

  test("isoFrom returns null when either part is missing", () => {
    expect(isoFrom("", "14:30")).toBeNull();
    expect(isoFrom("2026-06-15", "")).toBeNull();
    expect(isoFrom("", "")).toBeNull();
  });

  test("isoFrom returns null for an unparseable date or time", () => {
    expect(isoFrom("not-a-date", "14:30")).toBeNull();
    expect(isoFrom("2026-06-15", "nope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clock12: 12-hour clock split with the 12/0 boundaries
// ---------------------------------------------------------------------------

describe("clock12", () => {
  test("midnight (00:00 local) reads as 12 AM, not 0 AM", () => {
    const iso = new Date(2026, 5, 3, 0, 0).toISOString();
    expect(clock12(iso)).toEqual({ time: "12:00", ampm: "AM" });
  });

  test("noon (12:00 local) reads as 12 PM, not 0 PM", () => {
    const iso = new Date(2026, 5, 3, 12, 0).toISOString();
    expect(clock12(iso)).toEqual({ time: "12:00", ampm: "PM" });
  });

  test("a normal afternoon time (19:05 local) reads as 7:05 PM", () => {
    const iso = new Date(2026, 5, 3, 19, 5).toISOString();
    expect(clock12(iso)).toEqual({ time: "7:05", ampm: "PM" });
  });

  test("a morning time (09:30 local) reads as 9:30 AM", () => {
    const iso = new Date(2026, 5, 3, 9, 30).toISOString();
    expect(clock12(iso)).toEqual({ time: "9:30", ampm: "AM" });
  });

  test("the hour before noon (11:45) is still AM", () => {
    const iso = new Date(2026, 5, 3, 11, 45).toISOString();
    expect(clock12(iso)).toEqual({ time: "11:45", ampm: "AM" });
  });

  test("minutes are zero-padded to two digits", () => {
    const iso = new Date(2026, 5, 3, 13, 7).toISOString();
    expect(clock12(iso)).toEqual({ time: "1:07", ampm: "PM" });
  });
});

// ---------------------------------------------------------------------------
// formatTimeLeft: bare largest-unit duration with correct pluralization
// ---------------------------------------------------------------------------

describe("formatTimeLeft", () => {
  test("under a minute returns the literal phrase", () => {
    expect(formatTimeLeft(30000)).toBe("under a minute");
  });

  test("exactly one minute is singular", () => {
    expect(formatTimeLeft(60000)).toBe("1 minute");
  });

  test("multiple minutes are plural", () => {
    expect(formatTimeLeft(23 * 60000)).toBe("23 minutes");
  });

  test("exactly one hour is singular (no minutes leak)", () => {
    expect(formatTimeLeft(3600000)).toBe("1 hour");
  });

  test("multiple hours are plural", () => {
    expect(formatTimeLeft(2 * 3600000)).toBe("2 hours");
  });

  test("exactly one day is singular", () => {
    expect(formatTimeLeft(86400000)).toBe("1 day");
  });

  test("multiple days are plural", () => {
    expect(formatTimeLeft(2 * 86400000)).toBe("2 days");
  });

  test("rounds down to the largest whole unit (25h is 1 day, not 2)", () => {
    expect(formatTimeLeft(25 * 3600000)).toBe("1 day");
  });

  test("zero or past returns the bare 'now'", () => {
    expect(formatTimeLeft(0)).toBe("now");
    expect(formatTimeLeft(-1)).toBe("now");
  });
});

// ---------------------------------------------------------------------------
// countdownLabel: the composed "<duration> left" / terminal phrase
// ---------------------------------------------------------------------------

describe("countdownLabel", () => {
  test("once passed (ms <= 0) reads 'Closing now'", () => {
    expect(countdownLabel(0)).toBe("Closing now");
    expect(countdownLabel(-1000)).toBe("Closing now");
  });

  test("appends ' left' to a singular hour", () => {
    expect(countdownLabel(3600000)).toBe("1 hour left");
  });

  test("appends ' left' to plural days", () => {
    expect(countdownLabel(2 * 86400000)).toBe("2 days left");
  });

  test("under a minute composes to 'under a minute left'", () => {
    expect(countdownLabel(30000)).toBe("under a minute left");
  });
});

// ---------------------------------------------------------------------------
// formatSlot / dayUpper / dateStringFrom / timeStringFrom: human formatting of a known instant
// ---------------------------------------------------------------------------

describe("formatSlot / dayUpper", () => {
  // Wed 3 Jun 2026, 19:05 local.
  const wedEvening = new Date(2026, 5, 3, 19, 5).toISOString();

  test("formatSlot renders 'Wed 3 Jun, 19:05' for a Wednesday evening", () => {
    expect(formatSlot(wedEvening)).toBe("Wed 3 Jun, 19:05");
  });

  test("formatSlot zero-pads the time but not the day-of-month", () => {
    // Mon 6 Jul 2026, 08:00 local -> day 6 not 06, time 08:00.
    const julyMorning = new Date(2026, 6, 6, 8, 0).toISOString();
    expect(formatSlot(julyMorning)).toBe("Mon 6 Jul, 08:00");
  });

  test("dayUpper renders the uppercase day line 'WED 3 JUN'", () => {
    expect(dayUpper(wedEvening)).toBe("WED 3 JUN");
  });

  test("dayUpper for a Saturday in June reads 'SAT 6 JUN'", () => {
    const sat = new Date(2026, 5, 6, 19, 0).toISOString();
    expect(dayUpper(sat)).toBe("SAT 6 JUN");
  });
});

describe("dateStringFrom / timeStringFrom", () => {
  test("dateStringFrom produces the picker's 'YYYY-MM-DD' with zero-padded month and day", () => {
    expect(dateStringFrom(new Date(2026, 0, 9, 8, 5))).toBe("2026-01-09");
  });

  test("timeStringFrom produces the picker's 'HH:mm' with zero-padded hour and minute", () => {
    expect(timeStringFrom(new Date(2026, 0, 9, 8, 5))).toBe("08:05");
  });

  test("dateStringFrom / timeStringFrom are the forward halves of isoFrom (compose to round-trip)", () => {
    const d = new Date(2026, 5, 15, 14, 30);
    const iso = isoFrom(dateStringFrom(d), timeStringFrom(d));
    if (iso === null) throw new Error("isoFrom returned null for a valid date/time");
    expect(new Date(iso).getTime()).toBe(d.getTime());
  });
});
