import { describe, expect, it } from "vitest";
import {
  type CandidateReaction,
  pickWinnerOrBestId,
  pickWinningCandidate,
  tallyCandidates,
} from "./candidates.js";
import {
  addCandidateHorizon,
  DAY_MS,
  defaultDecidesByForCandidates,
  defaultReplyByMs,
  MOMENT_MS,
} from "./lock.js";
import { clears, type MomentResponse, resolveIn } from "./resolve.js";
import { revealGoing } from "./reveal.js";

// Edge-case coverage for the pure logic layer. Each assertion is derived from the spec
// (ARCHITECTURE.md / CLAUDE.md), not from the current implementation, and targets a gap left by
// the sibling *.test.ts files. Helpers below mirror the sibling shapes for readability.

const react = (candidateId: string, userId: string): CandidateReaction => ({
  candidateId,
  userId,
});
const yes = (userId: string): MomentResponse => ({ userId, kind: "yes" });
const no = (userId: string): MomentResponse => ({ userId, kind: "no" });
const ifAll = (userId: string, ...targetIds: string[]): MomentResponse => ({
  userId,
  kind: "conditional",
  cond: { mode: "all", targetIds },
});
const ifAny = (userId: string, ...targetIds: string[]): MomentResponse => ({
  userId,
  kind: "conditional",
  cond: { mode: "any", targetIds },
});

const HOUR = MOMENT_MS;
// On a half-hour boundary (a multiple of 30min), so the deadline defaults' half-hour flooring is a
// no-op for the whole-hour offsets these boundary tests use.
const now = 999_999_000_000;

describe("pickWinningCandidate (quorum/winner interplay)", () => {
  it("returns null until any candidate reaches quorum, even with momentum", () => {
    // Spec: the winner is only returned once it meets quorum. Two candidates each have one +1;
    // quorum is 2 so neither is a real winner yet - the public counts exist but no winner.
    const r = [react("c1", "a"), react("c2", "b")];
    expect(pickWinningCandidate(["c1", "c2"], r, 2)).toBeNull();
  });

  it("returns the candidate exactly at quorum (boundary is inclusive)", () => {
    // A candidate with exactly `quorum` distinct reactors is a winner (>= not >).
    const r = [react("c1", "a"), react("c1", "b")];
    expect(pickWinningCandidate(["c1", "c2"], r, 2)).toEqual({
      candidateId: "c1",
      userIds: ["a", "b"],
    });
  });

  it("skips a quorum-short leader for a behind-but-qualifying candidate is NOT done - only quorum-meeting candidates are considered", () => {
    // c1 has 1 reactor (below quorum 2), c2 has 2 (meets quorum). Even though we scan c1 first,
    // it is skipped for failing quorum, so c2 wins. Guards a bug where quorum is checked after pick.
    const r = [react("c1", "a"), react("c2", "x"), react("c2", "y")];
    expect(pickWinningCandidate(["c1", "c2"], r, 2)?.candidateId).toBe("c2");
  });

  it("returns null for an empty candidate slate regardless of quorum", () => {
    expect(pickWinningCandidate([], [], 0)).toBeNull();
    expect(pickWinningCandidate([], [react("c1", "a")], 1)).toBeNull();
  });

  it("with quorum 0, the most-reacted candidate wins and an all-empty slate falls to the earliest", () => {
    // quorum 0 means every candidate qualifies; the strict-greater scan keeps the most-reacted,
    // and with all-empty tallies the earliest in display order is the (first) best.
    expect(pickWinningCandidate(["c1", "c2"], [], 0)?.candidateId).toBe("c1");
    const r = [react("c2", "a")];
    expect(pickWinningCandidate(["c1", "c2"], r, 0)?.candidateId).toBe("c2");
  });
});

describe("pickWinnerOrBestId (tie-break and empty-reaction fallback)", () => {
  it("breaks an equal-count fallback tie toward the earliest among three candidates", () => {
    // c1, c2, c3 each have one reactor; quorum 2 met by none. Earliest in display order wins.
    const r = [react("c1", "a"), react("c2", "b"), react("c3", "c")];
    expect(pickWinnerOrBestId(["c1", "c2", "c3"], r, 2)).toBe("c1");
  });

  it("does not reorder the slate: a later candidate listed first still wins ties", () => {
    // Display order, not id sort: 'z1' precedes 'a2', and on a tie the earliest given wins.
    const r = [react("z1", "p"), react("a2", "q")];
    expect(pickWinnerOrBestId(["z1", "a2"], r, 2)).toBe("z1");
  });

  it("falls back to the earliest of an all-empty multi-candidate slate", () => {
    expect(pickWinnerOrBestId(["c1", "c2", "c3"], [], 1)).toBe("c1");
  });

  it("ignores reactions to unknown candidates when choosing the best id", () => {
    // Only c2 has a real reaction; c9 is unknown and ignored, so c2 beats the empty c1.
    const r = [react("c9", "ghost"), react("c2", "a")];
    expect(pickWinnerOrBestId(["c1", "c2"], r, 5)).toBe("c2");
  });

  it("returns the single candidate when the slate has exactly one entry and no reactions", () => {
    expect(pickWinnerOrBestId(["only"], [], 1)).toBe("only");
  });
});

describe("tallyCandidates (de-dup edge)", () => {
  it("collapses a person's repeated +1 on the same candidate to a single count", () => {
    // A double-tap must not inflate momentum: distinct reactors only.
    const t = tallyCandidates(["c1"], [react("c1", "a"), react("c1", "a"), react("c1", "a")]);
    expect(t).toEqual([{ candidateId: "c1", userIds: ["a"] }]);
  });
});

describe("defaultDecidesByForCandidates (clamp boundaries)", () => {
  it("uses the proportional lead exactly at the lower clamp (span == 3h -> lead == 1h)", () => {
    // span/3 == 1h is the floor exactly; lead = 1h, decidesBy = earliest - 1h, strictly after now.
    const earliest = now + 3 * HOUR;
    expect(defaultDecidesByForCandidates(earliest, now)).toBe(earliest - HOUR);
  });

  it("clamps the lead up to a moment for a sub-3h span (span 2h -> lead floored at 1h)", () => {
    // round(2h/3) = 40min < 1h, so the lead is floored at one moment; still strictly after now.
    const earliest = now + 2 * HOUR;
    const t = defaultDecidesByForCandidates(earliest, now);
    expect(t).toBe(earliest - HOUR);
    expect(t).toBeGreaterThan(now);
  });

  it("uses the proportional lead exactly at the upper clamp (span == 72h -> lead == 24h)", () => {
    // span/3 == 24h is the cap exactly; lead = one day.
    const earliest = now + 3 * DAY_MS;
    expect(defaultDecidesByForCandidates(earliest, now)).toBe(earliest - DAY_MS);
  });

  it("respects a custom momentMs floor for the lead", () => {
    // With a 2h moment, span 5h -> round(5h/3)=100min < 2h, floored to 2h; decidesBy = earliest-2h.
    const earliest = now + 5 * HOUR;
    expect(defaultDecidesByForCandidates(earliest, now, 2 * HOUR)).toBe(earliest - 2 * HOUR);
  });

  it("falls back to the midpoint for a degenerate sub-moment span", () => {
    // span 20min: lead floored to 1h, ideal = earliest - 1h < now -> midpoint = now + 10min.
    const earliest = now + 20 * 60 * 1000;
    expect(defaultDecidesByForCandidates(earliest, now)).toBe(now + 10 * 60 * 1000);
  });
});

describe("defaultReplyByMs (boundary)", () => {
  it("returns a minimal window when the event is exactly at the open instant", () => {
    // eventMs <= openMs is the degenerate guard; equality must take the minimal-window branch.
    expect(defaultReplyByMs(now, now)).toBe(now + MOMENT_MS);
  });

  it("matches the decidesBy default for a future event (shared shape)", () => {
    // For a future event the reply-by reuses the decidesBy default exactly.
    const event = now + 12 * HOUR;
    expect(defaultReplyByMs(now, event)).toBe(defaultDecidesByForCandidates(event, now));
  });
});

describe("addCandidateHorizon (degenerate spans)", () => {
  it("adds zero slack for a zero-length spread (earliest == latest)", () => {
    // span 0 -> min(0, 2d) = 0 slack; the horizon is exactly the latest candidate.
    const at = now + DAY_MS;
    expect(addCandidateHorizon(at, at)).toBe(at);
  });

  it("uses the full span as slack exactly at the two-day cap (span == 2d)", () => {
    // span 2d -> min(2d, 2d) = 2d slack.
    const earliest = now + DAY_MS;
    const latest = now + 3 * DAY_MS;
    expect(addCandidateHorizon(earliest, latest)).toBe(latest + 2 * DAY_MS);
  });
});

describe("resolveIn (deep / mixed / cyclic edge cases)", () => {
  it("latches a long transitive 'all' chain off a single yes anchor", () => {
    // a yes; b in if a; c in if b; d in if c. The fixpoint loop must cascade all four IN.
    const IN = resolveIn([yes("a"), ifAll("b", "a"), ifAll("c", "b"), ifAll("d", "c")]);
    expect([...IN].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("resolves a mixed all/any web to its true fixpoint", () => {
    // a yes. b in if (a AND z) - z never comes, so b stays out. c in if (a OR z) - a is in, c in.
    // d in if c (all) - c is in, d in. The 'all' that depends on an absent target must not latch.
    const IN = resolveIn([yes("a"), ifAll("b", "a", "z"), ifAny("c", "a", "z"), ifAll("d", "c")]);
    expect([...IN].sort()).toEqual(["a", "c", "d"]);
    expect(IN.has("b")).toBe(false);
  });

  it("breaks into a multi-node cycle once a yes anchors any member", () => {
    // Three-node cycle a->b->c->a (each 'any' on the next). With no yes, none are IN; once 'a'
    // also says yes, the whole cycle latches. We anchor by making 'a' a plain yes here.
    const cyclic = [yes("a"), ifAny("b", "a"), ifAny("c", "b"), ifAny("a2", "c")];
    const IN = resolveIn(cyclic);
    expect([...IN].sort()).toEqual(["a", "a2", "b", "c"]);
  });

  it("never resolves a 3-node pure conditional cycle (no anchor)", () => {
    // a if b, b if c, c if a - a closed ring with no plain yes resolves to NOBODY.
    expect(resolveIn([ifAny("a", "b"), ifAny("b", "c"), ifAny("c", "a")]).size).toBe(0);
  });

  it("treats a conditional targeting a non-responder as not-IN", () => {
    // b is in if 'ghost', but 'ghost' never responded (not yes, not resolved) -> b stays out.
    const IN = resolveIn([yes("a"), ifAll("b", "ghost")]);
    expect(IN.has("b")).toBe(false);
    expect([...IN].sort()).toEqual(["a"]);
  });

  it("treats a conditional targeting an explicit 'no' as not-IN", () => {
    // c said no; b is in if c -> the target is not IN, so b never latches.
    const IN = resolveIn([yes("a"), no("c"), ifAll("b", "c")]);
    expect(IN.has("b")).toBe(false);
  });

  it("an 'any' conditional comes in if even one of several targets is IN", () => {
    // b in if (ghost OR a OR z); only a is IN -> b latches.
    expect(resolveIn([yes("a"), ifAny("b", "ghost", "a", "z")]).has("b")).toBe(true);
  });
});

describe("clears (resolved-set boundary)", () => {
  it("is true exactly at quorum after conditional resolution (>= boundary)", () => {
    // IN = {a, b} via a yes + b-if-a; quorum 2 is met exactly.
    expect(clears([yes("a"), ifAll("b", "a")], 2)).toBe(true);
  });

  it("a pure unanchored cycle never clears any positive quorum", () => {
    expect(clears([ifAny("a", "b"), ifAny("b", "a")], 1)).toBe(false);
  });
});

describe("revealGoing (blind/revealed boundary at momentEndsAt)", () => {
  it("stays blind at exactly momentEndsAt (reveal is strictly after the end)", () => {
    // Spec gate: nowMs > momentEndsAtMs. Equality is still inside the blind moment -> null.
    expect(
      revealGoing([yes("a")], { momentEndsAtMs: 1000, terminal: false, nowMs: 1000 }),
    ).toBeNull();
  });

  it("reveals one millisecond past momentEndsAt", () => {
    expect(
      revealGoing([yes("a"), yes("b")], {
        momentEndsAtMs: 1000,
        terminal: false,
        nowMs: 1001,
      })?.sort(),
    ).toEqual(["a", "b"]);
  });

  it("resolves conditionals when revealing the IN crowd (not just plain yeses)", () => {
    // After the moment ends, the revealed crowd must reflect the resolved fixpoint, not raw yeses.
    expect(
      revealGoing([yes("a"), ifAll("b", "a")], {
        momentEndsAtMs: 100,
        terminal: false,
        nowMs: 200,
      })?.sort(),
    ).toEqual(["a", "b"]);
  });

  it("reveals an empty crowd (not null) when cleared with no plain yeses to anchor", () => {
    // resolved=true forces reveal regardless of time; a pure unanchored cycle reveals [] (empty),
    // which is distinct from the still-blind null.
    const revealed = revealGoing([ifAny("a", "b"), ifAny("b", "a")], {
      momentEndsAtMs: 9999,
      terminal: true,
      nowMs: 0,
    });
    expect(revealed).toEqual([]);
    expect(revealed).not.toBeNull();
  });
});
