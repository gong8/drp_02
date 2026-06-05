// CreateWizard behavior tests. Assertions are derived from the SPEC (ARCHITECTURE.md + CLAUDE.md +
// the shared schema/logic), not from what the screen happens to render: the confirm-step summary must
// agree with the server's concrete-shortcut rule (planOpensMoment), validity must gate submit on the
// real deadline bounds (MOMENT_MS headroom + reply-by window), the redo "source" step must appear only
// for a group with cleared plans and preload the old activity as a single locked candidate while never
// carrying the time, and a valid submit must call events.create with the assembled input then navigate.
//
// The native date/time picker (DateTimePill -> DateTimeField -> @react-native-community/datetimepicker)
// is replaced by a deterministic stand-in: each mounted pill registers its onDate/onTime callbacks in
// `pillInstances`, so a test sets a concrete date/time by calling them inside act(). This keeps the
// REAL wizard logic under test (isoFrom, defaultDecidesByForCandidates, MOMENT_MS, confirmMirror) while
// removing the only nondeterministic, hard-to-drive native surface.

jest.mock("../../lib/trpc");

// Mock only the DateTimePill submodule; the ../ui barrel re-exports it, so the screen picks up the mock.
jest.mock("../../ui/DateTimePill", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    DateTimePill: (props: {
      dateValue: string;
      timeValue: string;
      onDate: (next: string) => void;
      onTime: (next: string) => void;
    }) => {
      // Register this instance's setters so a test can drive it by index/order of mount. The name is
      // `mock`-prefixed so jest allows the factory to reference this module-scope array.
      mockPillInstances.push({ onDate: props.onDate, onTime: props.onTime });
      return React.createElement(View, { accessibilityLabel: "datetimepill" });
    },
  };
});

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { cleanup } from "@testing-library/react-native";
import type { MeetupsStackParams } from "../../../App";
import { mockMutation, mockQuery, resetTrpcMock } from "../../lib/__mocks__/trpc";
import { defaultDecidesByForCandidates, defaultReplyByMs, MOMENT_MS } from "../../lib/lock";
import { trpc } from "../../lib/trpc";
import {
  act,
  fireEvent,
  renderScreen,
  renderWithProviders,
  screen,
  waitFor,
} from "../../test/render";
import { CreateWizard } from "../CreateWizard";

type PillHandle = { onDate: (next: string) => void; onTime: (next: string) => void };
const mockPillInstances: PillHandle[] = [];

// Unmount the previous test's screen BEFORE resetting mocks, so no in-flight async submit from a leaked
// component can land on the freshly reset jest.fn and inflate the next test's call count.
beforeEach(() => {
  cleanup();
  resetTrpcMock();
  mockPillInstances.length = 0;
});

// ---- fixtures ------------------------------------------------------------------------------------

const GROUPS = [{ id: "g1", name: "The Crew" }] as const;

// Build the group/past mocks. By default a group with no cleared plans (no source step).
function mockBaseline(past: Awaited<ReturnType<typeof trpc.events.pastForGroup.query>> = []) {
  mockQuery(
    trpc.groups.mine,
    GROUPS as unknown as Awaited<ReturnType<typeof trpc.groups.mine.query>>,
  );
  mockQuery(trpc.events.pastForGroup, past);
  mockMutation(
    trpc.events.create,
    undefined as unknown as Awaited<ReturnType<typeof trpc.events.create.mutate>>,
  );
  // The shared resetTrpcMock does not reliably clear THIS fn's call history across tests (the manual
  // mock is loaded under two specifiers, so its reset runs on a different module instance). Clear the
  // create mutate explicitly per test so a call-count assertion measures only this test's submit.
  (trpc.events.create.mutate as jest.Mock).mockClear();
}

// A future date/time pair the picker would have produced. Far enough out that the auto decides-by and
// reply-by defaults are valid, and that "earliest - MOMENT_MS" is comfortably in the future.
function futureParts(daysAhead: number): { date: string; time: string } {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: "19:00",
  };
}

// Drive the most-recently-mounted pill (the times step renders exactly one blank row pill).
function setPill(index: number, date: string, time: string) {
  const pill = mockPillInstances[index];
  act(() => {
    pill.onDate(date);
  });
  act(() => {
    pill.onTime(time);
  });
}

async function landOnGroupStep() {
  renderScreen(CreateWizard);
  // The group step waits on pastForGroup (pastLoaded) before Next is valid.
  expect(await screen.findByText("Who's it for?")).toBeOnTheScreen();
}

// Tap "Next". Awaited so the step's state/effect work fully flushes before the next interaction (a
// synchronous act() leaves pending async work that later act()/waitFor calls would replay). The button
// is disabled when invalid (press is then a no-op).
async function pressNext() {
  await act(async () => {
    fireEvent.press(screen.getByText("Next"));
  });
}

// Advance from the group step through to the named step, picking the only group. `withSource` inserts
// the extra "source" step (a redo group). At "activities"/"times" we may set values mid-walk.
async function advanceTo(
  target: "activities" | "times" | "details" | "deadlines" | "confirm",
  opts: { withSource?: boolean; onTimes?: () => void; onActivities?: () => void } = {},
) {
  // group -> next (group is preselected to groups[0]); wait for pastForGroup to settle.
  await waitFor(() => expect(screen.getByText("Next")).toBeEnabled());
  await pressNext();
  if (opts.withSource) {
    expect(await screen.findByText("Start from")).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText("Start fresh"));
    });
    await pressNext();
  }
  if (target === "activities") {
    expect(await screen.findByText("What do you fancy?")).toBeOnTheScreen();
    return;
  }
  // activities
  expect(await screen.findByText("What do you fancy?")).toBeOnTheScreen();
  opts.onActivities?.();
  await pressNext();
  if (target === "times") {
    expect(await screen.findByText("When could it be?")).toBeOnTheScreen();
    return;
  }
  // times
  expect(await screen.findByText("When could it be?")).toBeOnTheScreen();
  opts.onTimes?.();
  await pressNext();
  if (target === "details") {
    expect(await screen.findByText("Where & notes")).toBeOnTheScreen();
    return;
  }
  // details
  expect(await screen.findByText("Where & notes")).toBeOnTheScreen();
  await pressNext();
  if (target === "deadlines") {
    expect(await screen.findByText("Deadlines")).toBeOnTheScreen();
    return;
  }
  // deadlines
  expect(await screen.findByText("Deadlines")).toBeOnTheScreen();
  await pressNext();
  expect(await screen.findByText("Ready to send?")).toBeOnTheScreen();
}

// ---- confirmMirror: agrees with the server's concrete-shortcut rule -----------------------------

describe("confirm summary matches the time x activity x lock matrix", () => {
  test("both axes open: the group votes on time and what to do", async () => {
    mockBaseline();
    await landOnGroupStep();
    await advanceTo("confirm"); // no time, no activity, no locks
    // Open on both axes -> "the group votes" framing, never "it's on"/"happens".
    expect(
      screen.getByText("The group suggests times and what to do, then who's in."),
    ).toBeOnTheScreen();
  });

  test("one open time candidate (unlocked): the group votes on that time", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", { onTimes: () => setPill(0, date, time) });
    // A single proposed but unlocked time is still voted on (members can add more); not concrete.
    expect(screen.getByText("Vote on 1 time and what to do, then who's in.")).toBeOnTheScreen();
  });

  test("both axes pinned (1 locked time + 1 locked activity): it's on, just say who's in", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", {
      onActivities: () => {
        fireEvent.changeText(screen.getByPlaceholderText("bowling, the pub..."), "Bowling");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.press(screen.getByText("Lock the activity"));
      },
      onTimes: () => {
        setPill(0, date, time);
        fireEvent.press(screen.getByText("Lock the times"));
      },
    });
    // Concrete shortcut (planOpensMoment true): the plan happens; wording is "It's on ..." + activity set.
    const summary = screen.getByText(/It's on for/);
    expect(summary).toHaveTextContent(/Activity set - just say who's in\./);
    // It must NOT use the "the group picks/votes" framing reserved for an open axis.
    expect(screen.queryByText(/The group picks/)).toBeNull();
  });

  test("locked single time but open activity: it's on, the group picks what to do", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", {
      onTimes: () => {
        setPill(0, date, time);
        fireEvent.press(screen.getByText("Lock the times"));
      },
    });
    // Time pinned, activity open -> NOT concrete; the activity axis is still decided by the group.
    expect(screen.getByText(/It's on for/)).toHaveTextContent(
      /The group picks what to do, then who's in\./,
    );
  });

  test("locked time but TWO locked activities is contested, so it is not concrete", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", {
      onActivities: () => {
        const input = screen.getByPlaceholderText("bowling, the pub...");
        fireEvent.changeText(input, "Bowling");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.changeText(screen.getByPlaceholderText("bowling, the pub..."), "Pub");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.press(screen.getByText("Lock the activity"));
      },
      onTimes: () => {
        setPill(0, date, time);
        fireEvent.press(screen.getByText("Lock the times"));
      },
    });
    // Two locked activities => activityFixed is false (activityCount > 1) => group still votes the activity.
    // Per planOpensMoment(1,true,2,true) === false, this must NOT read as the concrete "Activity set" line.
    expect(screen.getByText(/It's on for/)).toHaveTextContent(
      /The group picks what to do, then who's in\./,
    );
    expect(screen.queryByText(/Activity set/)).toBeNull();
  });
});

// ---- validity gating on the deadlines step ------------------------------------------------------

describe("submit/continue validity gating", () => {
  test("a valid plan (sensible default deadlines) lets you continue past deadlines", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(10);
    await advanceTo("deadlines", { onTimes: () => setPill(0, date, time) });
    // Defaults are within bounds, so the deadlines step is valid and Next is enabled.
    expect(screen.getByText("Next")).toBeEnabled();
    await pressNext();
    expect(await screen.findByText("Ready to send?")).toBeOnTheScreen();
  });

  test("a decides-by inside the MOMENT_MS headroom is invalid and blocks continuing", async () => {
    mockBaseline();
    await landOnGroupStep();
    const earliest = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const earliestDate = `${earliest.getFullYear()}-${pad(earliest.getMonth() + 1)}-${pad(earliest.getDate())}`;
    await advanceTo("deadlines", { onTimes: () => setPill(0, earliestDate, "19:00") });

    // Enter decides-by edit mode and set it only 30 min before the earliest time - inside the required
    // one-moment (MOMENT_MS) headroom, which the server rejects, so the wizard must refuse to advance.
    // Clear the registry first so the freshly mounted decides-by pill is index 0 (the times-step pill,
    // now unmounted, is still in the array). The decides-by editor is the first DeadlineField.
    mockPillInstances.length = 0;
    act(() => {
      fireEvent.press(screen.getAllByText("Change")[0]);
    });
    setPill(0, earliestDate, "18:30");

    // Sanity: 18:30 is within MOMENT_MS (1h) of 19:00, so it is invalid by the spec bound.
    expect(MOMENT_MS).toBe(60 * 60 * 1000);

    await waitFor(() => expect(screen.getByText("Next")).toBeDisabled());
    await pressNext(); // disabled -> no-op
    // Still on the deadlines step; never reached confirm.
    expect(screen.getByText("Deadlines")).toBeOnTheScreen();
    expect(screen.queryByText("Ready to send?")).toBeNull();
  });

  test("a reply-by after the earliest time is out of bounds and blocks continuing", async () => {
    mockBaseline();
    await landOnGroupStep();
    const earliest = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const after = new Date(earliest.getTime() + 24 * 60 * 60 * 1000); // a day past the event
    const pad = (n: number) => String(n).padStart(2, "0");
    const earliestDate = `${earliest.getFullYear()}-${pad(earliest.getMonth() + 1)}-${pad(earliest.getDate())}`;
    const afterDate = `${after.getFullYear()}-${pad(after.getMonth() + 1)}-${pad(after.getDate())}`;
    await advanceTo("deadlines", { onTimes: () => setPill(0, earliestDate, "19:00") });

    // The reply-by editor is the second DeadlineField; press its "Change". There are two "Change"
    // buttons (decides + reply), so target the reply one (index 1). Clear the registry first so the
    // freshly mounted reply-by pill is index 0.
    const changes = screen.getAllByText("Change");
    mockPillInstances.length = 0;
    act(() => {
      fireEvent.press(changes[1]);
    });
    setPill(0, afterDate, "19:00");

    await waitFor(() => expect(screen.getByText("Next")).toBeDisabled());
    await pressNext();
    expect(screen.getByText("Deadlines")).toBeOnTheScreen();
    expect(screen.queryByText("Ready to send?")).toBeNull();
  });
});

// ---- time dedupe by minute (mirrors events.create) ----------------------------------------------

describe("same-minute times are deduped like the server", () => {
  test("two rows in the same minute collapse to one: the plan reads as concrete", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", {
      onActivities: () => {
        fireEvent.changeText(screen.getByPlaceholderText("bowling, the pub..."), "Bowling");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.press(screen.getByText("Lock the activity"));
      },
      onTimes: () => {
        // First row, then add a SECOND row and give it the exact same date/time (same minute). Clear
        // the pill registry before adding the row so the two rows re-mount as index 0 (row 0) and index
        // 1 (row 1) in render order (the mock pushes on every render, so it otherwise accumulates).
        setPill(0, date, time);
        mockPillInstances.length = 0;
        fireEvent.press(screen.getByText("+ Add a time"));
        setPill(1, date, time);
        fireEvent.press(screen.getByText("Lock the times"));
      },
    });
    // The server collapses same-minute candidates, so two identical rows are ONE time. With one locked
    // time + one locked activity the plan is concrete (planOpensMoment), so the summary must read "It's
    // on ...", not "Vote on 2 times" (which the un-deduped count would have produced).
    expect(screen.getByText(/It's on for/)).toHaveTextContent(/Activity set - just say who's in\./);
    expect(screen.queryByText(/Vote on 2 times/)).toBeNull();
  });

  test("the submit payload sends one time candidate when two rows share a minute", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", {
      onTimes: () => {
        setPill(0, date, time);
        mockPillInstances.length = 0;
        fireEvent.press(screen.getByText("+ Add a time"));
        setPill(1, date, time);
      },
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Send to the group"));
    });
    expect(trpc.events.create.mutate).toHaveBeenCalledTimes(1);
    const arg = (trpc.events.create.mutate as jest.Mock).mock.calls[0][0];
    // Deduped before the payload is built, so the wire carries one slot - matching what the server stores.
    expect(arg.timeCandidates).toHaveLength(1);
  });
});

// ---- stale decides-by must not block a concrete plan (H2) ---------------------------------------

describe("a stale decides-by edit does not strand a concrete plan", () => {
  test("an invalid decides-by left from a non-concrete state stops blocking once the plan is concrete", async () => {
    mockBaseline();
    await landOnGroupStep();
    const earliest = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const earliestDate = `${earliest.getFullYear()}-${pad(earliest.getMonth() + 1)}-${pad(earliest.getDate())}`;

    // Build a NON-concrete plan: two locked activities (contested) + one locked time. The decides-by
    // editor shows because the plan is not concrete yet.
    await advanceTo("deadlines", {
      onActivities: () => {
        fireEvent.changeText(screen.getByPlaceholderText("bowling, the pub..."), "Bowling");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.changeText(screen.getByPlaceholderText("bowling, the pub..."), "Pub");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.press(screen.getByText("Lock the activity"));
      },
      onTimes: () => {
        setPill(0, earliestDate, "19:00");
        fireEvent.press(screen.getByText("Lock the times"));
      },
    });

    // Set an invalid decides-by (inside the MOMENT_MS headroom) so Next is blocked.
    mockPillInstances.length = 0;
    act(() => {
      fireEvent.press(screen.getAllByText("Change")[0]);
    });
    setPill(0, earliestDate, "18:30");
    await waitFor(() => expect(screen.getByText("Next")).toBeDisabled());

    // Go back to the activities step (deadlines -> details -> times -> activities) and drop the second
    // activity, leaving ONE locked activity. With one locked time that makes the plan concrete - the
    // decides-by field disappears, but its stale edit must NOT keep Send disabled.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.press(screen.getByText("‹"));
      });
    }
    expect(await screen.findByText("What do you fancy?")).toBeOnTheScreen();
    // The activity chips render in order; remove "Pub" (the second), keeping the lock on the lone "Bowling".
    const removes = screen.getAllByText("×");
    await act(async () => {
      fireEvent.press(removes[1]);
    });

    // Walk forward to the deadlines step; the plan is now concrete (1 locked time + 1 locked activity).
    await pressNext(); // activities -> times
    expect(await screen.findByText("When could it be?")).toBeOnTheScreen();
    await pressNext(); // times -> details
    expect(await screen.findByText("Where & notes")).toBeOnTheScreen();
    await pressNext(); // details -> deadlines
    expect(await screen.findByText("Deadlines")).toBeOnTheScreen();
    // Regression: before the fix the stale (invalid) decides-by still failed validity even though the
    // field is hidden for a concrete plan, permanently disabling Next. It must be enabled now.
    expect(screen.getByText("Next")).toBeEnabled();
    await pressNext();
    expect(await screen.findByText("Ready to send?")).toBeOnTheScreen();
  });
});

// ---- a past decides-by is rejected client-side (H3) ---------------------------------------------

describe("a decides-by in the past is invalid", () => {
  test("a decides-by at or before now blocks continuing with a future-deadline note", async () => {
    mockBaseline();
    await landOnGroupStep();
    const earliest = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await advanceTo("deadlines", { onTimes: () => setPill(0, fmt(earliest), "19:00") });

    mockPillInstances.length = 0;
    act(() => {
      fireEvent.press(screen.getAllByText("Change")[0]);
    });
    setPill(0, fmt(past), "19:00");

    // The server rejects a past decides-by (must be after now); the wizard must catch it client-side.
    await waitFor(() => expect(screen.getByText("Next")).toBeDisabled());
    expect(screen.getByText("The deadline has to be in the future.")).toBeOnTheScreen();
    await pressNext(); // disabled -> no-op
    expect(screen.getByText("Deadlines")).toBeOnTheScreen();
    expect(screen.queryByText("Ready to send?")).toBeNull();
  });
});

// ---- the activity list caps at 10 (matches the shared schema) (H4) ------------------------------

describe("the activity list caps at 10", () => {
  test("the Add button disables and an 11th activity is refused once ten exist", async () => {
    mockBaseline();
    await landOnGroupStep();
    await advanceTo("activities");
    const input = screen.getByPlaceholderText("bowling, the pub...");
    for (let i = 0; i < 10; i++) {
      fireEvent.changeText(input, `act_${i}`);
      fireEvent.press(screen.getByText("Add"));
    }
    // Ten activities are on the list; the schema caps activityCandidates at 10, so Add is now disabled
    // even with text typed (mirroring the times cap) and a further commit is a no-op.
    fireEvent.changeText(input, "one too many");
    expect(screen.getByText("Add")).toBeDisabled();
    fireEvent.press(screen.getByText("Add"));
    expect(screen.queryByText("one too many")).toBeNull();
  });
});

// ---- redo / source step -------------------------------------------------------------------------

describe("the redo source step", () => {
  test("no source step appears when the group has no cleared plans", async () => {
    mockBaseline([]);
    await landOnGroupStep();
    await waitFor(() => expect(screen.getByText("Next")).toBeEnabled());
    await pressNext();
    // Without past plans the next step is activities, never the source picker.
    expect(await screen.findByText("What do you fancy?")).toBeOnTheScreen();
    expect(screen.queryByText("Start from")).toBeNull();
  });

  test("the source step appears when the group has cleared plans", async () => {
    mockBaseline([
      {
        id: "p1",
        activity: "Bowling",
        location: "TenPin",
        description: "come at 6",
        lockTimes: true,
        lastStartsAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);
    await landOnGroupStep();
    await waitFor(() => expect(screen.getByText("Next")).toBeEnabled());
    await pressNext();
    expect(await screen.findByText("Start from")).toBeOnTheScreen();
    expect(screen.getByText("Start fresh")).toBeOnTheScreen();
    expect(screen.getByText("Bowling")).toBeOnTheScreen();
  });

  test("choosing a past meetup preloads its activity as a single locked activity candidate", async () => {
    mockBaseline([
      {
        id: "p1",
        activity: "Bowling",
        location: "TenPin",
        description: "come at 6",
        lockTimes: false,
        lastStartsAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);
    await landOnGroupStep();
    await waitFor(() => expect(screen.getByText("Next")).toBeEnabled());
    await pressNext();
    // Pick the past meetup on the source step.
    expect(await screen.findByText("Start from")).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText("Bowling"));
    });
    await pressNext();
    // Activities step: the old activity is preloaded as a chip and the activity lock is pre-ticked.
    expect(await screen.findByText("What do you fancy?")).toBeOnTheScreen();
    expect(screen.getByText("Bowling")).toBeOnTheScreen();
    // The lock sub-copy flips to the enabled "can't add more" once an activity exists + lock is on.
    expect(screen.getByText("The group can't add more activities")).toBeOnTheScreen();
  });

  test("a redo carries no time: the times step starts blank and the time must be picked fresh", async () => {
    mockBaseline([
      {
        id: "p1",
        activity: "Bowling",
        location: "TenPin",
        description: "come at 6",
        lockTimes: true,
        lastStartsAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);
    await landOnGroupStep();
    await waitFor(() => expect(screen.getByText("Next")).toBeEnabled());
    await pressNext();
    expect(await screen.findByText("Start from")).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText("Bowling"));
    });
    await pressNext();
    // activities -> times
    expect(await screen.findByText("What do you fancy?")).toBeOnTheScreen();
    await pressNext();
    expect(await screen.findByText("When could it be?")).toBeOnTheScreen();
    // No time is carried over: the confirm summary must show 0 voted times, not a chosen one. Advance.
    await pressNext(); // times -> details
    expect(await screen.findByText("Where & notes")).toBeOnTheScreen();
    await pressNext(); // details -> deadlines
    expect(await screen.findByText("Deadlines")).toBeOnTheScreen();
    await pressNext(); // deadlines -> confirm
    expect(await screen.findByText("Ready to send?")).toBeOnTheScreen();
    // With no time picked, the time axis is open -> "the group suggests times" (no carried time).
    expect(screen.getByText(/The group suggests times/)).toBeOnTheScreen();
  });
});

// ---- submit: assembles the input and navigates --------------------------------------------------

describe("submitting the plan", () => {
  test("a concrete plan calls events.create with the assembled input then navigates to Dashboard", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", {
      onActivities: () => {
        fireEvent.changeText(screen.getByPlaceholderText("bowling, the pub..."), "Bowling");
        fireEvent.press(screen.getByText("Add"));
        fireEvent.press(screen.getByText("Lock the activity"));
      },
      onTimes: () => {
        setPill(0, date, time);
        fireEvent.press(screen.getByText("Lock the times"));
      },
    });
    // The final CTA on the confirm step. Awaited so the async submit (mutate + navigate) settles.
    await act(async () => {
      fireEvent.press(screen.getByText("Send to the group"));
    });

    expect(trpc.events.create.mutate).toHaveBeenCalledTimes(1);
    const arg = (trpc.events.create.mutate as jest.Mock).mock.calls[0][0];
    expect(arg.groupId).toBe("g1");
    // A concrete plan: both axes pinned, so both locks ride through to the server (planOpensMoment).
    expect(arg.lockTimes).toBe(true);
    expect(arg.lockActivity).toBe(true);
    expect(arg.activityCandidates).toEqual(["Bowling"]);
    expect(arg.timeCandidates).toHaveLength(1);
    // The assembled time must be the one the creator picked (round-trips through isoFrom).
    const sentMs = new Date(arg.timeCandidates[0].startsAt).getTime();
    const picked = new Date(`${date}T${time}:00`).getTime();
    expect(Math.abs(sentMs - picked)).toBeLessThan(60_000);
  });

  test("submitting resets the navigation stack to the Dashboard", async () => {
    mockBaseline();
    // Render with a spy `navigation` so we can assert the post-submit navigation. The wizard reads no
    // route.params and uses only plain useEffect (no useNavigation/useFocusEffect), so a direct render
    // with a stub navigation prop is faithful. The one-screen test stack cannot actually route to
    // "Dashboard", so we verify the intent (reset called with that route) rather than the routed UI.
    const reset = jest.fn();
    const goBack = jest.fn();
    const props = {
      navigation: { reset, goBack },
      route: { key: "k", name: "CreateWizard", params: undefined },
    } as unknown as NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;
    renderWithProviders(<CreateWizard {...props} />);

    expect(await screen.findByText("Who's it for?")).toBeOnTheScreen();
    const { date, time } = futureParts(7);
    await advanceTo("confirm", { onTimes: () => setPill(0, date, time) });
    await act(async () => {
      fireEvent.press(screen.getByText("Send to the group"));
    });

    await waitFor(() => expect(trpc.events.create.mutate).toHaveBeenCalledTimes(1));
    // The wizard navigates away by resetting the stack to a single Dashboard route.
    expect(reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Dashboard" }] });
  });

  test("a collecting plan leaves decides-by to the server default but sends the shown reply-by", async () => {
    mockBaseline();
    await landOnGroupStep();
    const { date, time } = futureParts(10);
    await advanceTo("confirm", { onTimes: () => setPill(0, date, time) }); // open axes -> collecting plan
    await act(async () => {
      fireEvent.press(screen.getByText("Send to the group"));
    });

    expect(trpc.events.create.mutate).toHaveBeenCalledTimes(1);
    const arg = (trpc.events.create.mutate as jest.Mock).mock.calls[0][0];
    // The creator did not override decides-by, so the wizard sends undefined and the server applies its
    // own default (defaultDecidesByForCandidates) - the two defaults are the same value, so the wizard
    // does not duplicate it on the wire.
    expect(arg.decidesBy).toBeUndefined();
    expect(arg.lockTimes).toBe(false);
    expect(arg.lockActivity).toBe(false);
    // Reply-by IS sent (the shown default), so the server stores exactly the window the creator saw
    // rather than recomputing one anchored to lock time. It must equal the shared defaultReplyByMs.
    const earliestMs = new Date(`${date}T${time}:00`).getTime();
    const decidesFloor = defaultDecidesByForCandidates(earliestMs, Date.now());
    const expectedReplyMs = defaultReplyByMs(decidesFloor, earliestMs);
    expect(arg.replyBy).toBeDefined();
    // Wide tolerance for the Date.now() drift between render and assertion.
    expect(Math.abs(new Date(arg.replyBy).getTime() - expectedReplyMs)).toBeLessThan(5_000);
  });
});
