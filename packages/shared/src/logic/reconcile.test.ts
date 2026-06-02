import { describe, expect, it } from "vitest";
import {
  type ReconcileIdea,
  type ReconcileTime,
  type ReconcileVote,
  reconcileFloat,
} from "./reconcile.js";

const idea = (id: string, text: string, createdAtMs = 0): ReconcileIdea => ({ id, text, createdAtMs });
const time = (id: string, startsAtMs: number, createdAtMs = 0): ReconcileTime => ({
  id,
  startsAtMs,
  createdAtMs,
});
const vote = (suggestionId: string, userId: string): ReconcileVote => ({ suggestionId, userId });
// All +1s from a set of users on one chip.
const votes = (suggestionId: string, users: string[]): ReconcileVote[] =>
  users.map((u) => vote(suggestionId, u));

describe("reconcileFloat", () => {
  it("fizzles when there are no ideas", () => {
    expect(reconcileFloat([], [], [], 2, [100])).toEqual({ kind: "fizzle" });
  });

  it("fizzles when the winning idea is below min-heat (a one-person float cannot tip)", () => {
    const res = reconcileFloat([idea("i1", "bowling")], [time("t1", 1000)], votes("i1", ["a"]), 2, []);
    expect(res).toEqual({ kind: "fizzle" });
  });

  it("tips into a moment when an idea and a time both have consensus", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [time("t1", 1000)],
      [...votes("i1", ["a", "b"]), ...votes("t1", ["a", "b"])],
      2,
      [],
    );
    expect(res).toEqual({ kind: "moment", ideaId: "i1", ideaText: "bowling", startsAtMs: 1000 });
  });

  it("counts a time only among the winning idea's backers, not all voters", () => {
    // t1 has 3 total votes but only 1 from a backer; t2 has 2 backer votes and wins.
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [time("t1", 1000), time("t2", 2000)],
      [
        ...votes("i1", ["a", "b", "c"]),
        ...votes("t1", ["a", "x", "y"]),
        ...votes("t2", ["b", "c"]),
      ],
      2,
      [],
    );
    expect(res).toEqual({ kind: "moment", ideaId: "i1", ideaText: "bowling", startsAtMs: 2000 });
  });

  it("falls to collecting over the float's time chips when no time reaches consensus", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [time("t1", 1000), time("t2", 2000)],
      [...votes("i1", ["a", "b", "c"]), ...votes("t1", ["a"]), ...votes("t2", ["b"])],
      2,
      [],
    );
    expect(res).toEqual({
      kind: "collecting",
      ideaId: "i1",
      ideaText: "bowling",
      candidateStartsAtMs: [1000, 2000],
    });
  });

  it("falls to collecting over the window slots when the float has no time chips", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [],
      votes("i1", ["a", "b"]),
      2,
      [5000, 3000, 4000],
    );
    expect(res).toEqual({
      kind: "collecting",
      ideaId: "i1",
      ideaText: "bowling",
      candidateStartsAtMs: [3000, 4000, 5000],
    });
  });

  it("a time backed only by non-backers never forces a moment", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [time("t1", 1000)],
      [...votes("i1", ["a", "b"]), ...votes("t1", ["x", "y", "z"])],
      2,
      [],
    );
    expect(res).toEqual({
      kind: "collecting",
      ideaId: "i1",
      ideaText: "bowling",
      candidateStartsAtMs: [1000],
    });
  });

  it("breaks an idea tie toward the earliest created", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling", 10), idea("i2", "the pub", 5)],
      [time("t1", 1000)],
      [...votes("i1", ["a", "b"]), ...votes("i2", ["a", "b"]), ...votes("t1", ["a", "b"])],
      2,
      [],
    );
    expect(res).toEqual({ kind: "moment", ideaId: "i2", ideaText: "the pub", startsAtMs: 1000 });
  });

  it("breaks a time tie toward the earliest created", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [time("t1", 2000, 10), time("t2", 1000, 5)],
      [...votes("i1", ["a", "b"]), ...votes("t1", ["a", "b"]), ...votes("t2", ["a", "b"])],
      2,
      [],
    );
    expect(res).toEqual({ kind: "moment", ideaId: "i1", ideaText: "bowling", startsAtMs: 1000 });
  });

  it("resolves 'everyone likes everything' deterministically (earliest idea, earliest tied time)", () => {
    const res = reconcileFloat(
      [idea("i1", "bowling", 5), idea("i2", "the pub", 10)],
      [time("t1", 1000, 7), time("t2", 2000, 3)],
      [
        ...votes("i1", ["a", "b"]),
        ...votes("i2", ["a", "b"]),
        ...votes("t1", ["a", "b"]),
        ...votes("t2", ["a", "b"]),
      ],
      2,
      [],
    );
    expect(res).toEqual({ kind: "moment", ideaId: "i1", ideaText: "bowling", startsAtMs: 2000 });
  });

  it("honours a higher min-heat for the idea while keeping the 2-backer time rule", () => {
    // idea needs 3; it has 3, and a time band has 2 of them -> moment.
    const res = reconcileFloat(
      [idea("i1", "bowling")],
      [time("t1", 1000)],
      [...votes("i1", ["a", "b", "c"]), ...votes("t1", ["a", "b"])],
      3,
      [],
    );
    expect(res).toEqual({ kind: "moment", ideaId: "i1", ideaText: "bowling", startsAtMs: 1000 });
  });
});
