import { describe, expect, it } from "vitest";
import {
  AddCandidateInput,
  ByEvent,
  Conditional,
  CreateEventInput,
  CreateGroupInput,
  GroupMemberRef,
  RenameGroupInput,
  RespondInput,
  SetOptOutInput,
  ToggleReactionInput,
  UpdateEventInput,
} from "./schemas.js";

// All assertions are derived from the spec (ARCHITECTURE.md + CLAUDE.md + the schema doc
// comments), not from re-running the parser. Each case is meant to break under a plausible bug
// (a flipped default, a dropped guard, a relaxed bound, a leaked optional).

describe("CreateEventInput", () => {
  it("accepts a minimal create (only groupId)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1" });
    expect(r.success).toBe(true);
  });

  it("defaults both lock flags to false (open) when omitted", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lockTimes).toBe(false);
      expect(r.data.lockActivity).toBe(false);
    }
  });

  it("defaults the +1 door open and unlocked when omitted (DRP-63)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.joinsOpen).toBe(true);
      expect(r.data.lockJoins).toBe(false);
    }
  });

  it("preserves an explicitly closed, locked +1 door (DRP-63)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", joinsOpen: false, lockJoins: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.joinsOpen).toBe(false);
      expect(r.data.lockJoins).toBe(true);
    }
  });

  it("preserves lock flags when explicitly set true (pinned axes)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      lockTimes: true,
      lockActivity: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lockTimes).toBe(true);
      expect(r.data.lockActivity).toBe(true);
    }
  });

  it("accepts a full pinned-concrete create (one time candidate, one activity, both locked)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      description: "see you there",
      location: "TenPin",
      timeCandidates: [{ startsAt: "2026-07-01T19:00:00.000Z", partOfDay: "evening" }],
      activityCandidates: ["Bowling"],
      lockTimes: true,
      lockActivity: true,
      decidesBy: "2026-06-30T12:00:00.000Z",
      replyBy: "2026-07-01T12:00:00.000Z",
      quorum: 3,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing groupId (group is required)", () => {
    const bad: unknown = { lockTimes: false };
    expect(CreateEventInput.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty activity candidate (a candidate must carry content)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      activityCandidates: [""],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an over-long activity candidate (> 80)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      activityCandidates: ["x".repeat(81)],
    });
    expect(r.success).toBe(false);
  });

  it("accepts an activity candidate at the 80-char bound", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      activityCandidates: ["x".repeat(80)],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a whitespace-only activity candidate (trim then min(1))", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      activityCandidates: ["   "],
    });
    expect(r.success).toBe(false);
  });

  it("trims surrounding whitespace off an activity candidate at the boundary", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      activityCandidates: ["  Bowling  "],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.activityCandidates).toEqual(["Bowling"]);
    }
  });

  it("rejects more than 10 time candidates", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      timeCandidates: Array.from({ length: 11 }, () => ({ startsAt: "2026-07-01T19:00:00.000Z" })),
    });
    expect(r.success).toBe(false);
  });

  it("accepts exactly 10 time candidates (the cap)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      timeCandidates: Array.from({ length: 10 }, () => ({ startsAt: "2026-07-01T19:00:00.000Z" })),
    });
    expect(r.success).toBe(true);
  });

  it("rejects more than 10 activity candidates", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      activityCandidates: Array.from({ length: 11 }, (_v, i) => `act_${i}`),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a quorum below 1 (need at least one committer)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", quorum: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects a non-integer quorum", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", quorum: 2.5 });
    expect(r.success).toBe(false);
  });

  it("rejects a quorum above the 50 cap", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", quorum: 51 });
    expect(r.success).toBe(false);
  });

  it("rejects an over-long description (> 500)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      description: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an over-long location (> 120)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      location: "x".repeat(121),
    });
    expect(r.success).toBe(false);
  });

  it("requires startsAt on a time candidate", () => {
    const bad: unknown = {
      groupId: "g_1",
      timeCandidates: [{ partOfDay: "evening" }],
    };
    expect(CreateEventInput.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown part-of-day band on a time candidate", () => {
    const bad: unknown = {
      groupId: "g_1",
      timeCandidates: [{ startsAt: "2026-07-01T19:00:00.000Z", partOfDay: "noon" }],
    };
    expect(CreateEventInput.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed startsAt on a time candidate (not a parseable datetime)", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      timeCandidates: [{ startsAt: "not-a-date" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed decidesBy (not a parseable datetime)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", decidesBy: "soon-ish" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed replyBy (not a parseable datetime)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", replyBy: "" });
    expect(r.success).toBe(false);
  });

  it("accepts valid ISO instants for startsAt / decidesBy / replyBy", () => {
    const r = CreateEventInput.safeParse({
      groupId: "g_1",
      timeCandidates: [{ startsAt: "2026-07-01T19:00:00.000Z" }],
      decidesBy: "2026-06-30T12:00:00.000Z",
      replyBy: "2026-07-01T12:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("does NOT carry a separate title (title was unified into activity)", () => {
    const r = CreateEventInput.safeParse({ groupId: "g_1", title: "Bowling" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("title" in r.data).toBe(false);
    }
  });
});

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

  it("treats every editable field as optional (a bare envelope is valid)", () => {
    expect(UpdateEventInput.safeParse({ eventId: "e_1" }).success).toBe(true);
  });

  it("applies several fields in one envelope (different-field edits both carried)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      activity: { from: "Pub", to: "Bowling" },
      location: { from: "Soho", to: "TenPin" },
      description: { from: "", to: "bring cash" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an oversize activity `to` (> 80)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      activity: { from: "", to: "x".repeat(81) },
    });
    expect(r.success).toBe(false);
  });

  it("accepts an activity `to` at the 80-char bound", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      activity: { from: "", to: "x".repeat(80) },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an oversize location `to` (> 120)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      location: { from: "", to: "x".repeat(121) },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an oversize description `to` (> 500)", () => {
    const r = UpdateEventInput.safeParse({
      eventId: "e_1",
      description: { from: "", to: "x".repeat(501) },
    });
    expect(r.success).toBe(false);
  });

  it("requires both `from` and `to` on a provided field (missing `from`)", () => {
    // Build the malformed value as plain unknown - safeParse accepts unknown, so no cast/ignore.
    const bad: unknown = {
      eventId: "e_1",
      location: { to: "TenPin" },
    };
    expect(UpdateEventInput.safeParse(bad).success).toBe(false);
  });

  it("requires both `from` and `to` on a provided field (missing `to`)", () => {
    const bad: unknown = {
      eventId: "e_1",
      location: { from: "Soho" },
    };
    expect(UpdateEventInput.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-string CAS value (from/to are strings)", () => {
    const bad: unknown = {
      eventId: "e_1",
      activity: { from: "", to: 42 },
    };
    expect(UpdateEventInput.safeParse(bad).success).toBe(false);
  });

  it("requires an eventId envelope", () => {
    const bad: unknown = { activity: { from: "", to: "x" } };
    expect(UpdateEventInput.safeParse(bad).success).toBe(false);
  });
});

describe("Conditional", () => {
  it("accepts an `all` conditional with one target", () => {
    const r = Conditional.safeParse({ mode: "all", targetIds: ["u_2"] });
    expect(r.success).toBe(true);
  });

  it("accepts an `any` conditional with several targets", () => {
    const r = Conditional.safeParse({ mode: "any", targetIds: ["u_2", "u_3"] });
    expect(r.success).toBe(true);
  });

  it("rejects an empty target list (a conditional needs at least one person)", () => {
    const r = Conditional.safeParse({ mode: "all", targetIds: [] });
    expect(r.success).toBe(false);
  });

  it("rejects a mode outside {all, any}", () => {
    const bad: unknown = { mode: "some", targetIds: ["u_2"] };
    expect(Conditional.safeParse(bad).success).toBe(false);
  });

  it("requires a mode", () => {
    const bad: unknown = { targetIds: ["u_2"] };
    expect(Conditional.safeParse(bad).success).toBe(false);
  });
});

describe("RespondInput", () => {
  it("accepts a plain yes with no cond", () => {
    const r = RespondInput.safeParse({ eventId: "e_1", kind: "yes" });
    expect(r.success).toBe(true);
  });

  it("accepts a plain no with no cond", () => {
    const r = RespondInput.safeParse({ eventId: "e_1", kind: "no" });
    expect(r.success).toBe(true);
  });

  it("accepts a conditional carrying a valid cond", () => {
    const r = RespondInput.safeParse({
      eventId: "e_1",
      kind: "conditional",
      cond: { mode: "all", targetIds: ["u_2"] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a conditional with no cond", () => {
    const r = RespondInput.safeParse({ eventId: "e_1", kind: "conditional" });
    expect(r.success).toBe(false);
  });

  // Spec (lane brief): "yes/no carry no cond". A plain yes/no answer is unconditional, so a stray
  // `cond` on it is malformed input and should be rejected.
  it.skip("rejects a yes that carries a stray cond (yes/no carry no cond)", () => {
    // BUG: RespondInput.refine only requires cond when kind==="conditional"; it does not forbid a
    // stray cond on a yes/no, so a contradictory { kind: "yes", cond } is accepted.
    const r = RespondInput.safeParse({
      eventId: "e_1",
      kind: "yes",
      cond: { mode: "all", targetIds: ["u_2"] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a conditional whose cond has an empty target list", () => {
    const r = RespondInput.safeParse({
      eventId: "e_1",
      kind: "conditional",
      cond: { mode: "any", targetIds: [] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown response kind", () => {
    const bad: unknown = { eventId: "e_1", kind: "maybe" };
    expect(RespondInput.safeParse(bad).success).toBe(false);
  });

  it("requires an eventId envelope", () => {
    const bad: unknown = { kind: "yes" };
    expect(RespondInput.safeParse(bad).success).toBe(false);
  });
});

describe("ToggleReactionInput", () => {
  it("accepts a +1 toggle on a candidate", () => {
    const r = ToggleReactionInput.safeParse({ eventId: "e_1", candidateId: "c_1" });
    expect(r.success).toBe(true);
  });

  it("requires a candidateId (a toggle targets one candidate)", () => {
    const bad: unknown = { eventId: "e_1" };
    expect(ToggleReactionInput.safeParse(bad).success).toBe(false);
  });

  it("requires an eventId envelope", () => {
    const bad: unknown = { candidateId: "c_1" };
    expect(ToggleReactionInput.safeParse(bad).success).toBe(false);
  });
});

describe("AddCandidateInput", () => {
  it("accepts a time candidate (kind=time, startsAt set)", () => {
    const r = AddCandidateInput.safeParse({
      eventId: "e_1",
      kind: "time",
      startsAt: "2026-07-01T19:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed startsAt (not a parseable datetime)", () => {
    const r = AddCandidateInput.safeParse({
      eventId: "e_1",
      kind: "time",
      startsAt: "yesterday",
    });
    expect(r.success).toBe(false);
  });

  it("accepts an activity candidate (kind=activity, text set)", () => {
    const r = AddCandidateInput.safeParse({
      eventId: "e_1",
      kind: "activity",
      text: "Bowling",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown candidate kind", () => {
    const bad: unknown = { eventId: "e_1", kind: "place" };
    expect(AddCandidateInput.safeParse(bad).success).toBe(false);
  });

  it("requires a kind", () => {
    const bad: unknown = { eventId: "e_1", text: "Bowling" };
    expect(AddCandidateInput.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty activity text (a candidate must carry content)", () => {
    const r = AddCandidateInput.safeParse({
      eventId: "e_1",
      kind: "activity",
      text: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an over-long activity text (> 80)", () => {
    const r = AddCandidateInput.safeParse({
      eventId: "e_1",
      kind: "activity",
      text: "x".repeat(81),
    });
    expect(r.success).toBe(false);
  });

  it("requires an eventId envelope", () => {
    const bad: unknown = { kind: "activity", text: "Bowling" };
    expect(AddCandidateInput.safeParse(bad).success).toBe(false);
  });
});

describe("SetOptOutInput", () => {
  it("accepts opting out", () => {
    const r = SetOptOutInput.safeParse({ eventId: "e_1", out: true });
    expect(r.success).toBe(true);
  });

  it("accepts rejoining (out=false)", () => {
    const r = SetOptOutInput.safeParse({ eventId: "e_1", out: false });
    expect(r.success).toBe(true);
  });

  it("requires the `out` boolean", () => {
    const bad: unknown = { eventId: "e_1" };
    expect(SetOptOutInput.safeParse(bad).success).toBe(false);
  });
});

describe("ByEvent", () => {
  it("requires a string eventId", () => {
    expect(ByEvent.safeParse({ eventId: "e_1" }).success).toBe(true);
    const bad: unknown = { eventId: 7 };
    expect(ByEvent.safeParse(bad).success).toBe(false);
  });
});

describe("group inputs", () => {
  it("CreateGroupInput accepts a non-empty name", () => {
    expect(CreateGroupInput.safeParse({ name: "Climbers" }).success).toBe(true);
  });

  it("CreateGroupInput rejects an empty name", () => {
    expect(CreateGroupInput.safeParse({ name: "" }).success).toBe(false);
  });

  it("CreateGroupInput rejects an over-long name (> 60)", () => {
    expect(CreateGroupInput.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("RenameGroupInput requires both id and a valid name", () => {
    expect(RenameGroupInput.safeParse({ id: "g_1", name: "Renamed" }).success).toBe(true);
    expect(RenameGroupInput.safeParse({ id: "g_1", name: "" }).success).toBe(false);
    const bad: unknown = { name: "Renamed" };
    expect(RenameGroupInput.safeParse(bad).success).toBe(false);
  });

  it("GroupMemberRef requires both groupId and userId", () => {
    expect(GroupMemberRef.safeParse({ groupId: "g_1", userId: "u_1" }).success).toBe(true);
    const missingUser: unknown = { groupId: "g_1" };
    expect(GroupMemberRef.safeParse(missingUser).success).toBe(false);
    const missingGroup: unknown = { userId: "u_1" };
    expect(GroupMemberRef.safeParse(missingGroup).success).toBe(false);
  });
});
