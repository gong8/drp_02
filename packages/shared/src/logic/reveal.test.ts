import { describe, expect, it } from "vitest";
import type { MomentResponse } from "./resolve.js";
import { revealGoing } from "./reveal.js";

const yes = (userId: string): MomentResponse => ({ userId, kind: "yes" });

describe("revealGoing", () => {
  it("hides the crowd while the blind moment is still running", () => {
    expect(
      revealGoing([yes("a")], { momentEndsAtMs: 1000, resolved: false, nowMs: 500 }),
    ).toBeNull();
  });

  it("reveals the IN set once the moment has ended", () => {
    expect(
      revealGoing([yes("a"), yes("b")], {
        momentEndsAtMs: 1000,
        resolved: false,
        nowMs: 2000,
      })?.sort(),
    ).toEqual(["a", "b"]);
  });

  it("reveals immediately when the plan is already cleared/fizzled", () => {
    expect(revealGoing([yes("a")], { momentEndsAtMs: 9999, resolved: true, nowMs: 0 })).toEqual([
      "a",
    ]);
  });
});
