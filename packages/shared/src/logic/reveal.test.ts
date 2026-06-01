import { describe, expect, it } from "vitest";
import type { ResponseInput } from "./resolve.js";
import { revealGoing } from "./reveal.js";

const yes = (userId: string): ResponseInput => ({ userId, kind: "yes" });

describe("revealGoing", () => {
  it("hides the crowd while the respond-by timer is still running", () => {
    expect(revealGoing([yes("a")], { respondByAtMs: 1000, status: "open", nowMs: 500 })).toBeNull();
  });

  it("reveals the IN set once respond-by has passed", () => {
    expect(
      revealGoing([yes("a"), yes("b")], {
        respondByAtMs: 1000,
        status: "open",
        nowMs: 2000,
      })?.sort(),
    ).toEqual(["a", "b"]);
  });

  it("reveals immediately when the event is already resolved", () => {
    expect(revealGoing([yes("a")], { respondByAtMs: 9999, status: "resolved", nowMs: 0 })).toEqual([
      "a",
    ]);
  });
});
