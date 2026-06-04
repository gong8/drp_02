import { describe, expect, it } from "vitest";
import {
  type CandidateReactionInput,
  pickWinnerOrBestId,
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

describe("pickWinnerOrBestId", () => {
  it("returns the quorum winner when one is met", () => {
    const r = [react("c1", "a"), react("c1", "b"), react("c2", "a")];
    expect(pickWinnerOrBestId(["c1", "c2"], r, 2)).toBe("c1");
  });

  it("falls back to the most-reacted candidate when none meets quorum", () => {
    // c2 has 2 reactions, c1 has 1; quorum 3 is met by neither, so the best-supported wins.
    const r = [react("c1", "a"), react("c2", "a"), react("c2", "b")];
    expect(pickWinnerOrBestId(["c1", "c2"], r, 3)).toBe("c2");
  });

  it("returns the first candidate id when there are no reactions", () => {
    // All tallies empty; the sort is stable so the earliest candidate wins.
    expect(pickWinnerOrBestId(["c1", "c2"], [], 1)).toBe("c1");
  });

  it("breaks a fallback tie toward the earlier candidate in display order", () => {
    // Equal reaction counts, quorum unmet - the earlier candidate in the slate wins.
    const r = [react("c1", "a"), react("c2", "b")];
    expect(pickWinnerOrBestId(["c1", "c2"], r, 2)).toBe("c1");
  });
});
