import { describe, expect, it } from "vitest";
import { clears, type ResponseInput, resolveIn } from "./resolve.js";

const yes = (userId: string): ResponseInput => ({ userId, kind: "yes" });
const no = (userId: string): ResponseInput => ({ userId, kind: "no" });
const ifAll = (userId: string, ...targetIds: string[]): ResponseInput => ({
  userId,
  kind: "conditional",
  cond: { mode: "all", targetIds },
});
const ifAny = (userId: string, ...targetIds: string[]): ResponseInput => ({
  userId,
  kind: "conditional",
  cond: { mode: "any", targetIds },
});

describe("resolveIn", () => {
  it("counts plain yeses and ignores nos", () => {
    expect([...resolveIn([yes("a"), yes("b"), no("c")])].sort()).toEqual(["a", "b"]);
  });

  it("resolves a conditional off a yes anchor and cascades through the chain", () => {
    // a says yes; b is in if a; c is in if b — all three should latch on.
    const IN = resolveIn([yes("a"), ifAny("b", "a"), ifAny("c", "b")]);
    expect([...IN].sort()).toEqual(["a", "b", "c"]);
  });

  it("'all' requires every target IN, 'any' requires just one", () => {
    // all: b waits on a AND c, but c never comes — b stays out.
    expect(resolveIn([yes("a"), ifAll("b", "a", "c")]).has("b")).toBe(false);
    // any: b waits on a OR c, and a is in — b comes in.
    expect(resolveIn([yes("a"), ifAny("b", "a", "c")]).has("b")).toBe(true);
  });

  it("never resolves a pure conditional cycle with no yes anchor", () => {
    expect(resolveIn([ifAny("a", "b"), ifAny("b", "a")]).size).toBe(0);
  });
});

describe("clears", () => {
  it("is true only once the IN set reaches quorum", () => {
    expect(clears([yes("a"), yes("b"), yes("c")], 3)).toBe(true);
    expect(clears([yes("a"), yes("b")], 3)).toBe(false);
  });

  it("counts resolved conditionals toward quorum", () => {
    // a yes plus b "in if a" → IN = {a, b}, meeting quorum 2.
    expect(clears([yes("a"), ifAll("b", "a")], 2)).toBe(true);
  });
});
