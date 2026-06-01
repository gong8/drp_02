import { describe, expect, it } from "vitest";
import {
  type CandidateReactionInput,
  pickWinningCandidate,
  tallyCandidates,
} from "./candidates.js";

const react = (candidateId: string, userId: string): CandidateReactionInput => ({
  candidateId,
  userId,
});

describe("tallyCandidates", () => {
  it("counts distinct reactors per candidate and keeps display order", () => {
    const t = tallyCandidates(
      ["c1", "c2"],
      [react("c1", "a"), react("c1", "b"), react("c2", "a"), react("c1", "a")],
    );
    expect(t).toEqual([
      { candidateId: "c1", userIds: ["a", "b"] },
      { candidateId: "c2", userIds: ["a"] },
    ]);
  });

  it("includes candidates with no reactions and ignores unknown candidate ids", () => {
    expect(tallyCandidates(["c1", "c2"], [react("c9", "a")])).toEqual([
      { candidateId: "c1", userIds: [] },
      { candidateId: "c2", userIds: [] },
    ]);
  });
});

describe("pickWinningCandidate", () => {
  it("returns the best-supported candidate that meets quorum", () => {
    const r = [react("c1", "a"), react("c1", "b"), react("c2", "a")];
    expect(pickWinningCandidate(["c1", "c2"], r, 2)).toEqual({
      candidateId: "c1",
      userIds: ["a", "b"],
    });
  });

  it("returns null when no candidate meets quorum", () => {
    expect(pickWinningCandidate(["c1", "c2"], [react("c1", "a")], 2)).toBeNull();
  });

  it("breaks ties toward the earlier candidate in display order", () => {
    const r = [react("c1", "a"), react("c2", "b")];
    expect(pickWinningCandidate(["c1", "c2"], r, 1)?.candidateId).toBe("c1");
  });
});
