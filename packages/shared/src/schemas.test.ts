import { describe, expect, it } from "vitest";
import { UpdateEventInput } from "./schemas.js";

describe("UpdateEventInput", () => {
  it("parses a single-field compare-and-set edit", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      activity: { from: "", to: "Bowling night" },
    });
    expect(r.success).toBe(true);
  });

  it("allows an empty `to` (empty activity reverts to auto-derive, empty notes clears)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      activity: { from: "Pub", to: "" },
      description: { from: "old", to: "" },
    });
    expect(r.success).toBe(true);
  });

  it("treats every field as optional (a bare envelope is valid)", () => {
    expect(UpdateEventInput.safeParse({ eventId: "e_1" }).success).toBe(true);
  });

  it("rejects an oversize activity `to` (> 80)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      activity: { from: "", to: "x".repeat(81) },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an oversize location `to` (> 120)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      location: { from: "", to: "x".repeat(121) },
    });
    expect(r.success).toBe(false);
  });

  it("requires both `from` and `to` on a provided field", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input under test
      location: { to: "TenPin" } as any,
    });
    expect(r.success).toBe(false);
  });
});
