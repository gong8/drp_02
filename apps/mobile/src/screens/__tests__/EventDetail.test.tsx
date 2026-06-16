// EventDetail screen tests. Assertions are derived from the SPEC (ARCHITECTURE.md + CLAUDE.md + the
// lane brief), not from what the implementation happens to do. Each test targets one behavior a
// plausible bug would break: a flipped optimistic toggle, a dropped revert, a leaked voter name, a
// mis-mapped conditional mode, a clobbered conflict, or a leaked Lock control.

jest.mock("../../lib/trpc");

// Replace the native date/time picker with a deterministic stand-in (the CreateWizard test's
// pattern): each mounted pill registers its onDate/onTime callbacks in `mockPillInstances`, so a
// test sets a concrete date+time by calling them inside act(). Only the AddTime composer mounts one
// here, so the rest of the suite is unaffected.
jest.mock("../../ui/DateTimePill", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    DateTimePill: (props: { onDate: (next: string) => void; onTime: (next: string) => void }) => {
      mockPillInstances.push({ onDate: props.onDate, onTime: props.onTime });
      return React.createElement(View, { accessibilityLabel: "datetimepill" });
    },
  };
});

import { TRPCClientError } from "@trpc/client";
import {
  mockMutation,
  mockMutationError,
  mockQuery,
  resetTrpcMock,
} from "../../lib/__mocks__/trpc";
import { setRosterSeen } from "../../lib/rosterSeen";
import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { act, fireEvent, renderScreen, screen, waitFor } from "../../test/render";
import { EventDetail } from "../EventDetail";

type PillHandle = { onDate: (next: string) => void; onTime: (next: string) => void };
const mockPillInstances: PillHandle[] = [];

// The exact shape events.get returns (NonNullable so optional null fields are part of the type).
type Detail = NonNullable<RouterOutputs["events"]["get"]>;
type RosterData = RouterOutputs["events"]["roster"];

// A future ISO instant, far enough out that no deadline/moment lazily settles during a test.
const SOON = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const LATER = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();

// A complete collecting-phase Detail. Two ACTIVITY candidates (one mine, one not) and two TIME
// candidates carry PUBLIC +1 counts; members carry names but no candidate ever carries a voter name.
function collectingDetail(over: Partial<Detail> = {}): Detail {
  return {
    id: "e1",
    groupName: "Climbing crew",
    // The display activity (leading candidate, server-derived) is kept distinct from any candidate
    // ROW label so a candidate row is uniquely findable - it is not part of the behavior under test.
    activity: "Friday plan",
    activityRaw: "",
    description: null,
    location: "",
    phase: "collecting",
    contingent: true,
    quorum: 2,
    lockTimes: false,
    lockActivity: false,
    startsAt: SOON,
    decidesBy: SOON,
    msLeftToDecide: 1000,
    replyBy: null,
    chosenStartsAt: null,
    momentStartsAt: null,
    momentEndsAt: null,
    msLeft: null,
    revealed: false,
    isCreator: false,
    iOptedOut: false,
    readyToLock: false,
    // Counts are kept pairwise-distinct so a single count value uniquely identifies one row in an
    // assertion (no need to scope by row): t1=3, t2=1, a1=4, a2=7.
    timeCandidates: [
      { id: "t1", startsAt: SOON, partOfDay: null, count: 3, mine: false },
      { id: "t2", startsAt: LATER, partOfDay: null, count: 1, mine: true },
    ],
    activityCandidates: [
      { id: "a1", text: "Bowling", count: 4, mine: false },
      { id: "a2", text: "Pub quiz", count: 7, mine: true },
    ],
    myResponse: null,
    myStatus: "reacting",
    members: [
      { id: "u2", name: "Priya" },
      { id: "u3", name: "Sam" },
    ],
    going: [],
    ...over,
  };
}

// A moment-phase Detail (blind RSVP window open). No response yet, so the answer choices show.
function momentDetail(over: Partial<Detail> = {}): Detail {
  const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    ...collectingDetail(),
    phase: "moment",
    activity: "Bowling",
    activityRaw: "Bowling",
    location: "TenPin",
    chosenStartsAt: SOON,
    momentStartsAt: new Date(Date.now() - 1000).toISOString(),
    momentEndsAt: end,
    msLeft: 60 * 60 * 1000,
    myResponse: null,
    myStatus: "awaiting",
    going: [],
    ...over,
  };
}

// A minimal Who's-in payload (DRP-63) so every mount survives the roster fetch that now rides
// alongside events.get; roster-specific tests override it per test.
function emptyRoster(): RosterData {
  return {
    joinsOpen: true,
    lockJoins: false,
    canToggle: true,
    groups: [{ id: "g1", name: "The Boys", members: [] }],
    participants: [],
  };
}

beforeEach(() => {
  resetTrpcMock();
  mockQuery(trpc.events.roster, emptyRoster());
  mockPillInstances.length = 0;
});

// The picker's local "YYYY-MM-DD" for a day N days out (the date half the mocked pill records).
function dateParts(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("EventDetail - collecting view (public counts, no names)", () => {
  test("renders each candidate's public +1 count", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    renderScreen(EventDetail, { eventId: "e1" });

    // The activity candidate "Bowling" has 4 public +1s and "Pub quiz" has 7; the count is the
    // shown momentum.
    expect(await screen.findByText("Bowling")).toBeOnTheScreen();
    expect(await screen.findByText("Pub quiz")).toBeOnTheScreen();
    expect(screen.getByText("4")).toBeOnTheScreen();
    expect(screen.getByText("7")).toBeOnTheScreen();
  });

  test("never shows a voter name on any candidate row, and states the no-names rule", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    renderScreen(EventDetail, { eventId: "e1" });

    // Member names exist in the group roster but must never surface as voters during collecting.
    await screen.findByText("Bowling");
    expect(screen.queryByText("Priya")).toBeNull();
    expect(screen.queryByText("Sam")).toBeNull();
    // The privacy disclaimer is shown verbatim.
    expect(screen.getByText("No names, just the group.")).toBeOnTheScreen();
  });

  test("tapping a candidate I have not +1'd optimistically increments its count and toggles my pick", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockMutation(trpc.events.toggleReaction, { reacted: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    // "Bowling" starts at 4 and is not mine; one tap should optimistically read 5 immediately.
    const bowling = await screen.findByText("Bowling");
    expect(screen.getByText("4")).toBeOnTheScreen();
    fireEvent.press(bowling);

    await waitFor(() => expect(screen.getByText("5")).toBeOnTheScreen());
    expect(screen.queryByText("4")).toBeNull();
    expect(trpc.events.toggleReaction.mutate).toHaveBeenCalledWith({
      eventId: "e1",
      candidateId: "a1",
    });
  });

  test("tapping a candidate I already +1'd optimistically decrements its count (un-vote)", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockMutation(trpc.events.toggleReaction, { reacted: false as const });
    renderScreen(EventDetail, { eventId: "e1" });

    // "Pub quiz" is mine at count 7; tapping it removes my +1, so it drops to 6 (a unique value).
    const pubQuiz = await screen.findByText("Pub quiz");
    expect(screen.getByText("7")).toBeOnTheScreen();
    fireEvent.press(pubQuiz);

    await waitFor(() => expect(screen.getByText("6")).toBeOnTheScreen());
    expect(screen.queryByText("7")).toBeNull();
    expect(trpc.events.toggleReaction.mutate).toHaveBeenCalledWith({
      eventId: "e1",
      candidateId: "a2",
    });
  });

  test("a failed toggle reverts the optimistic count back to the server value", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockMutationError(trpc.events.toggleReaction, new Error("network"));
    renderScreen(EventDetail, { eventId: "e1" });

    const bowling = await screen.findByText("Bowling");
    fireEvent.press(bowling);

    // It briefly reads 5, then the rejected mutation must put it back to 4 (no silent acceptance).
    await waitFor(() => expect(screen.getByText("4")).toBeOnTheScreen());
    expect(screen.queryByText("5")).toBeNull();
  });

  test("the opt-out toggle calls setOptOut with out:true and reflects it optimistically", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockMutation(trpc.events.setOptOut, { ok: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    const cantMakeIt = await screen.findByText("Can't make it");
    fireEvent.press(cantMakeIt);

    await waitFor(() =>
      expect(trpc.events.setOptOut.mutate).toHaveBeenCalledWith({ eventId: "e1", out: true }),
    );
  });

  test("opting out clears my +1s optimistically (my voted count falls immediately)", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockMutation(trpc.events.setOptOut, { ok: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    // "Pub quiz" is mine at 7; opting out drops my +1 so it must read 6 without waiting for a poll.
    await screen.findByText("Pub quiz");
    expect(screen.getByText("7")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Can't make it"));

    await waitFor(() => expect(screen.getByText("6")).toBeOnTheScreen());
    expect(screen.queryByText("7")).toBeNull();
  });
});

describe("EventDetail - add controls gated by the lock flags", () => {
  test("an open activity axis shows the add-activity affordance", async () => {
    mockQuery(trpc.events.get, collectingDetail({ lockActivity: false }));
    renderScreen(EventDetail, { eventId: "e1" });
    expect(await screen.findByText("+ add an activity")).toBeOnTheScreen();
  });

  test("a locked activity axis hides the add-activity affordance (vote only)", async () => {
    mockQuery(trpc.events.get, collectingDetail({ lockActivity: true }));
    renderScreen(EventDetail, { eventId: "e1" });
    await screen.findByText("Bowling");
    expect(screen.queryByText("+ add an activity")).toBeNull();
  });

  test("a locked time axis hides the add-time affordance (vote only)", async () => {
    mockQuery(trpc.events.get, collectingDetail({ lockTimes: true }));
    renderScreen(EventDetail, { eventId: "e1" });
    await screen.findByText("Bowling");
    expect(screen.queryByText("+ add a time")).toBeNull();
  });
});

// The server rejects a time at/before decides-by or past the horizon; the screen must catch the
// predictable cases BEFORE submitting and survive the race cases without blanking (DRP-59 - adding
// a time used to swap the whole screen for the full-screen error).
describe("EventDetail - adding a time is bounded and fails gracefully", () => {
  function openAddTime() {
    fireEvent.press(screen.getByText("+ add a time"));
  }

  test("a pick before voting closes disables Add and names the boundary, without calling the server", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    renderScreen(EventDetail, { eventId: "e1" });
    await screen.findByText("Bowling");
    openAddTime();

    // decidesBy is 7 days out; a 2-days-out pick is inside the voting window, so it can't be a slot.
    act(() => mockPillInstances[0].onDate(dateParts(2)));
    act(() => mockPillInstances[0].onTime("12:00"));

    expect(
      await screen.findByText(/^Voting closes .+ - pick a time after that\.$/),
    ).toBeOnTheScreen();
    expect(screen.getByText("Add")).toBeDisabled();
    expect(trpc.events.addCandidate.mutate).not.toHaveBeenCalled();
  });

  test("a server reject surfaces as an inline line and the vote board stays (no full-screen error)", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    // The race the composer cannot pre-validate: the deadline passed mid-compose.
    mockMutationError(trpc.events.addCandidate, new TRPCClientError("plan is not collecting"));
    renderScreen(EventDetail, { eventId: "e1" });
    await screen.findByText("Bowling");
    openAddTime();

    // A pick the client-side bounds accept: 8 days out, between decidesBy (+7d) and the horizon (+9d).
    act(() => mockPillInstances[0].onDate(dateParts(8)));
    act(() => mockPillInstances[0].onTime("19:00"));
    await act(async () => {
      fireEvent.press(screen.getByText("Add"));
    });

    expect(
      await screen.findByText("Voting just closed - this meetup has moved on."),
    ).toBeOnTheScreen();
    // The loaded screen survives: the board is still up, not the full-screen error.
    expect(screen.getByText("Bowling")).toBeOnTheScreen();
    expect(screen.queryByText("Couldn't reach the server.")).toBeNull();
  });

  test("a fully-elapsed window hides the add-time composer (no crash-prone picker)", async () => {
    // The exact live-demo crash shape: a collecting plan whose entire candidate spread is in the past
    // and has no decides-by, so the add window has closed. Offering the picker here fed inverted
    // min > max bounds to the native date picker and hard-crashed the app, so the composer must be gone.
    const PAST = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
    const PAST2 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    mockQuery(
      trpc.events.get,
      collectingDetail({
        decidesBy: null,
        timeCandidates: [
          { id: "t1", startsAt: PAST, partOfDay: null, count: 3, mine: false },
          { id: "t2", startsAt: PAST2, partOfDay: null, count: 1, mine: true },
        ],
      }),
    );
    renderScreen(EventDetail, { eventId: "e1" });
    await screen.findByText("Bowling");
    expect(screen.queryByText("+ add a time")).toBeNull();
  });
});

describe("EventDetail - Lock control is creator-only", () => {
  test("the creator sees the Lock (Decide now) control while collecting", async () => {
    mockQuery(trpc.events.get, collectingDetail({ isCreator: true }));
    renderScreen(EventDetail, { eventId: "e1" });
    expect(await screen.findByText("Decide now (dev)")).toBeOnTheScreen();
  });

  test("a non-creator never sees the Lock control", async () => {
    mockQuery(trpc.events.get, collectingDetail({ isCreator: false }));
    renderScreen(EventDetail, { eventId: "e1" });
    await screen.findByText("Bowling");
    expect(screen.queryByText("Decide now (dev)")).toBeNull();
  });
});

describe("EventDetail - moment view (blind RSVP)", () => {
  test("offers yes / conditional / no choices while unanswered", async () => {
    mockQuery(trpc.events.get, momentDetail());
    renderScreen(EventDetail, { eventId: "e1" });

    expect(await screen.findByText("I'm in")).toBeOnTheScreen();
    expect(screen.getByText("Go if...")).toBeOnTheScreen();
    expect(screen.getByText("Can't make it")).toBeOnTheScreen();
  });

  test("the moment is blind: it states so and never lists who else is in before close", async () => {
    mockQuery(trpc.events.get, momentDetail());
    renderScreen(EventDetail, { eventId: "e1" });

    expect(await screen.findByText("Blind until close.")).toBeOnTheScreen();
    // Other members' identities must never appear as a revealed crowd during a live moment.
    expect(screen.queryByText("Priya")).toBeNull();
    expect(screen.queryByText("Sam")).toBeNull();
  });

  test("'I'm in' records a plain yes", async () => {
    mockQuery(trpc.events.get, momentDetail());
    mockMutation(trpc.events.respond, { recorded: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("I'm in"));
    await waitFor(() =>
      expect(trpc.events.respond.mutate).toHaveBeenCalledWith({ eventId: "e1", kind: "yes" }),
    );
  });

  test("'Can't make it' records a no", async () => {
    mockQuery(trpc.events.get, momentDetail());
    mockMutation(trpc.events.respond, { recorded: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Can't make it"));
    await waitFor(() =>
      expect(trpc.events.respond.mutate).toHaveBeenCalledWith({ eventId: "e1", kind: "no" }),
    );
  });

  test("conditional 'All of them' maps to mode 'all' with the picked people", async () => {
    mockQuery(trpc.events.get, momentDetail());
    mockMutation(trpc.events.respond, { recorded: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    // Open the conditional sheet, switch to "All of them", pick a person, confirm.
    fireEvent.press(await screen.findByText("Go if..."));
    fireEvent.press(await screen.findByText("All of them"));
    fireEvent.press(await screen.findByText("Priya"));
    fireEvent.press(screen.getByText("Confirm"));

    await waitFor(() =>
      expect(trpc.events.respond.mutate).toHaveBeenCalledWith({
        eventId: "e1",
        kind: "conditional",
        cond: { mode: "all", targetIds: ["u2"] },
      }),
    );
  });

  test("conditional 'At least one' maps to mode 'any' with the picked people", async () => {
    mockQuery(trpc.events.get, momentDetail());
    mockMutation(trpc.events.respond, { recorded: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    // "At least one" is the default mode, so just pick someone and confirm.
    fireEvent.press(await screen.findByText("Go if..."));
    fireEvent.press(await screen.findByText("Sam"));
    fireEvent.press(screen.getByText("Confirm"));

    await waitFor(() =>
      expect(trpc.events.respond.mutate).toHaveBeenCalledWith({
        eventId: "e1",
        kind: "conditional",
        cond: { mode: "any", targetIds: ["u3"] },
      }),
    );
  });

  test("a committed conditional reads as 'in if your people are', not 'Awaiting you'", async () => {
    // Per the spec, a blind committed conditional gets its own wording and must not show the
    // misleading awaiting status. The phrase conveys "you're in if your people are".
    mockQuery(
      trpc.events.get,
      momentDetail({
        myResponse: { kind: "conditional", cond: { mode: "any", targetIds: ["u2"] } },
        myStatus: "awaiting",
      }),
    );
    renderScreen(EventDetail, { eventId: "e1" });

    expect(await screen.findByText(/if your people are/i)).toBeOnTheScreen();
    expect(screen.queryByText("Awaiting you")).toBeNull();
    // Still blind: the choices are hidden once committed and no crowd is revealed.
    expect(screen.queryByText("I'm in")).toBeNull();
  });

  test("a committed yes shows the locked-in status and hides the answer choices", async () => {
    mockQuery(
      trpc.events.get,
      momentDetail({ myResponse: { kind: "yes", cond: null }, myStatus: "going" }),
    );
    renderScreen(EventDetail, { eventId: "e1" });

    expect(await screen.findByText("You're in")).toBeOnTheScreen();
    expect(screen.queryByText("I'm in")).toBeNull();
  });
});

describe("EventDetail - edit sheet (per-field compare-and-set)", () => {
  test("editing location sends only a {from,to} patch for the changed field", async () => {
    mockQuery(trpc.events.get, momentDetail({ location: "TenPin", activityRaw: "Bowling" }));
    mockMutation(trpc.events.update, { applied: ["location"], conflicts: [] });
    renderScreen(EventDetail, { eventId: "e1" });

    // Open the edit sheet from the detail card's Edit affordance.
    fireEvent.press(await screen.findByText("Edit"));

    const locationField = await screen.findByDisplayValue("TenPin");
    fireEvent.changeText(locationField, "Rowans");
    fireEvent.press(screen.getByText("Save"));

    // The exact-match assertion proves ONLY the location field was patched: an activity or
    // description key would make this fail, so the per-field CAS sends nothing for unchanged fields.
    await waitFor(() =>
      expect(trpc.events.update.mutate).toHaveBeenCalledWith({
        eventId: "e1",
        location: { from: "TenPin", to: "Rowans" },
      }),
    );
  });

  test("editing the activity (once locked) sends a {from,to} patch for activity", async () => {
    mockQuery(trpc.events.get, momentDetail({ activityRaw: "Bowling", activity: "Bowling" }));
    mockMutation(trpc.events.update, { applied: ["activity"], conflicts: [] });
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Edit"));
    const activityField = await screen.findByDisplayValue("Bowling");
    fireEvent.changeText(activityField, "Mini golf");
    fireEvent.press(screen.getByText("Save"));

    await waitFor(() =>
      expect(trpc.events.update.mutate).toHaveBeenCalledWith({
        eventId: "e1",
        activity: { from: "Bowling", to: "Mini golf" },
      }),
    );
  });

  test("a conflict adopts the server-current value and keeps the sheet open (no clobber)", async () => {
    mockQuery(trpc.events.get, momentDetail({ location: "TenPin", activityRaw: "Bowling" }));
    // Server reports the location was changed under us to "Hollywood Bowl" instead of applying ours.
    mockMutation(trpc.events.update, {
      applied: [],
      conflicts: [{ field: "location", current: "Hollywood Bowl" }],
    });
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Edit"));
    const locationField = await screen.findByDisplayValue("TenPin");
    fireEvent.changeText(locationField, "Rowans");
    fireEvent.press(screen.getByText("Save"));

    // The sheet adopts the server's current value (does not silently overwrite it) and stays open.
    expect(await screen.findByDisplayValue("Hollywood Bowl")).toBeOnTheScreen();
    expect(screen.getByText("Save")).toBeOnTheScreen();
    // Our rejected value must NOT have been kept in the field.
    expect(screen.queryByDisplayValue("Rowans")).toBeNull();
  });

  test("after a conflict the next save targets the adopted server value (no re-conflict loop)", async () => {
    mockQuery(trpc.events.get, momentDetail({ location: "TenPin", activityRaw: "Bowling" }));
    // First save conflicts: the server reports location is now "Hollywood Bowl". The second save
    // must therefore send from="Hollywood Bowl" (the adopted baseline), not the stale "TenPin".
    const update = trpc.events.update.mutate as unknown as jest.Mock;
    update
      .mockResolvedValueOnce({
        applied: [],
        conflicts: [{ field: "location", current: "Hollywood Bowl" }],
      })
      .mockResolvedValueOnce({ applied: ["location"], conflicts: [] });
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Edit"));
    const locationField = await screen.findByDisplayValue("TenPin");
    fireEvent.changeText(locationField, "Rowans");
    fireEvent.press(screen.getByText("Save"));

    // The field adopts the server's current value; we then edit it again and re-save.
    const adopted = await screen.findByDisplayValue("Hollywood Bowl");
    fireEvent.changeText(adopted, "Rowans");
    fireEvent.press(screen.getByText("Save"));

    // The decisive assertion: the SECOND call uses from=current ("Hollywood Bowl"), so the baseline
    // advanced and the save can win - the old bug re-sent from="TenPin" and conflicted forever.
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith({
        eventId: "e1",
        location: { from: "Hollywood Bowl", to: "Rowans" },
      }),
    );
  });

  test("while collecting the activity is vote-decided, so no editable activity field is offered", async () => {
    // Spec: an activity edit is rejected during collecting. The sheet must not offer the activity
    // field at all - only location/notes are editable then.
    mockQuery(trpc.events.get, collectingDetail({ location: "TenPin" }));
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Edit"));
    // Location is editable, activity is not.
    expect(await screen.findByDisplayValue("TenPin")).toBeOnTheScreen();
    expect(screen.queryByText("Activity")).toBeNull();
  });

  test("a cleared plan is final, so it offers no Edit control", async () => {
    mockQuery(
      trpc.events.get,
      momentDetail({ phase: "cleared", going: [], myStatus: "going", revealed: true }),
    );
    renderScreen(EventDetail, { eventId: "e1" });

    await screen.findByText("Who's in");
    expect(screen.queryByText("Edit")).toBeNull();
  });
});

describe("EventDetail - Who's invited roster + the +1 door (DRP-63)", () => {
  // A roster with one group member and one attributed +1 who joined moments ago.
  function rosterWithPlusOne(over: Partial<RosterData> = {}): RosterData {
    return {
      joinsOpen: true,
      lockJoins: false,
      canToggle: true,
      groups: [{ id: "g1", name: "The Boys", members: [{ id: "u1", name: "Leo", color: "#111" }] }],
      participants: [
        {
          id: "u9",
          name: "Nathan",
          color: "#222",
          invitedBy: { id: "u1", name: "Leo", color: "#111" },
          joinedAt: new Date().toISOString(),
        },
      ],
      ...over,
    };
  }

  test("the Who's invited row shows the distinct headcount and opens the roster sheet", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockQuery(trpc.events.roster, rosterWithPlusOne());
    renderScreen(EventDetail, { eventId: "e1" });

    // 2 distinct people: Leo (group) + Nathan (+1).
    expect(await screen.findByText("Who's invited")).toBeOnTheScreen();
    expect(screen.getByText("2 people")).toBeOnTheScreen();

    fireEvent.press(screen.getByText("Who's invited"));
    // The sheet sections: the group, then the +1 with brought-by attribution.
    expect(await screen.findByText("The Boys")).toBeOnTheScreen();
    expect(screen.getByText("Nathan")).toBeOnTheScreen();
    expect(screen.getByText("via Leo")).toBeOnTheScreen();
  });

  test("a +1 who joined after this device last looked badges as NEW in the sheet", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockQuery(trpc.events.roster, rosterWithPlusOne());
    // This device looked long ago (a stored marker), so the fresh join must badge. A previously
    // unseen plan would instead baseline silently (seedRosterSeen) - covered in rosterSeen tests.
    setRosterSeen("e1", Date.parse("2026-01-01T00:00:00.000Z"));

    renderScreen(EventDetail, { eventId: "e1" });

    expect(await screen.findByText("1 new")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Who's invited"));
    expect(await screen.findByText("New")).toBeOnTheScreen();
  });

  test("the door toggle calls setJoinsOpen; a locked door renders disabled with the frozen note", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockQuery(trpc.events.roster, rosterWithPlusOne());
    mockMutation(trpc.events.setJoinsOpen, { ok: true as const });
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Who's invited"));
    fireEvent.press(await screen.findByText("Open to +1s"));
    await waitFor(() =>
      expect(trpc.events.setJoinsOpen.mutate).toHaveBeenCalledWith({ eventId: "e1", open: false }),
    );
  });

  test("a frozen door (lockJoins) shows the decided-at-suggestion note instead of a live toggle", async () => {
    mockQuery(trpc.events.get, collectingDetail());
    mockQuery(
      trpc.events.roster,
      rosterWithPlusOne({ joinsOpen: false, lockJoins: true, canToggle: false }),
    );
    renderScreen(EventDetail, { eventId: "e1" });

    fireEvent.press(await screen.findByText("Who's invited"));
    expect(await screen.findByText("Locked when the plan was suggested")).toBeOnTheScreen();
    // Tapping the disabled toggle is a no-op - the door mutation is never called.
    fireEvent.press(screen.getByText("Open to +1s"));
    expect(trpc.events.setJoinsOpen.mutate).not.toHaveBeenCalled();
  });
});
