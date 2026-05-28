import { describe, expect, it } from "vitest";
import { findClearingSlot } from "./matching.js";

describe("findClearingSlot", () => {
  it("returns the busiest slot meeting quorum; null otherwise", () => {
    const avail = [
      { userId: "a", slots: [{ day: "2026-06-01", partOfDay: "evening" as const }] },
      { userId: "b", slots: [{ day: "2026-06-01", partOfDay: "evening" as const }] },
      { userId: "c", slots: [{ day: "2026-06-02", partOfDay: "morning" as const }] },
    ];
    expect(findClearingSlot(avail, 2)?.userIds.sort()).toEqual(["a", "b"]);
    expect(findClearingSlot(avail, 3)).toBeNull();
  });
});
