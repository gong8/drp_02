// Unit tests for the device-local "last seen roster" markers (apps/mobile/src/lib/rosterSeen.ts) -
// the DRP-63 Who's-in NEW badge. Mobile-local pure helpers (no shared counterpart); these pin the
// documented contract: a null marker reads as all-seen, seeding baselines the first look, marking
// advances past everything visible.

import {
  getRosterSeen,
  isNewJoin,
  latestJoinMs,
  markRosterSeen,
  newJoinerCount,
  seedRosterSeen,
  setRosterSeen,
} from "../rosterSeen";

const T0 = "2026-06-10T12:00:00.000Z";
const T1 = "2026-06-11T12:00:00.000Z";
const ms = (iso: string) => Date.parse(iso);

describe("latestJoinMs", () => {
  it("returns the newest join instant, skipping unparseable strings", () => {
    expect(latestJoinMs([T0, T1, "not-a-date"])).toBe(ms(T1));
  });

  it("returns null with no +1s", () => {
    expect(latestJoinMs([])).toBeNull();
  });
});

describe("isNewJoin / newJoinerCount", () => {
  it("badges joins strictly after the marker", () => {
    expect(isNewJoin(T1, ms(T0))).toBe(true);
    expect(isNewJoin(T0, ms(T0))).toBe(false);
    expect(newJoinerCount([T0, T1], ms(T0))).toBe(1);
  });

  it("reads everything as seen when the user has never looked (null marker)", () => {
    expect(isNewJoin(T1, null)).toBe(false);
    expect(newJoinerCount([T0, T1], null)).toBe(0);
  });
});

describe("markers", () => {
  // Distinct event ids per test: the native fallback store is module-scoped.
  it("round-trips set -> get", () => {
    expect(getRosterSeen("e_rt")).toBeNull();
    setRosterSeen("e_rt", 1234);
    expect(getRosterSeen("e_rt")).toBe(1234);
  });

  it("markRosterSeen advances past the newest visible join AND the local now", () => {
    const before = Date.now();
    markRosterSeen("e_mark", [T0, T1]);
    const marker = getRosterSeen("e_mark");
    expect(marker).not.toBeNull();
    if (marker !== null) {
      expect(marker).toBeGreaterThanOrEqual(before);
      expect(marker).toBeGreaterThanOrEqual(ms(T1));
    }
    // The rows just shown never re-badge.
    expect(newJoinerCount([T0, T1], marker)).toBe(0);
  });

  it("seedRosterSeen baselines only the FIRST look", () => {
    seedRosterSeen("e_seed", [T0]);
    const first = getRosterSeen("e_seed");
    expect(first).not.toBeNull();
    // A later seed (e.g. a re-render) must not move an existing marker.
    setRosterSeen("e_seed", 42);
    seedRosterSeen("e_seed", [T1]);
    expect(getRosterSeen("e_seed")).toBe(42);
  });
});
