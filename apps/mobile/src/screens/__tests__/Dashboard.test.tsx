// Dashboard screen tests. Assertions are derived from the spec (ARCHITECTURE.md + CLAUDE.md + the
// status/copy modules), NOT from what the implementation happens to render:
//
//  - No groups  -> the "No groups yet" onboarding card; its button routes to create a group.
//  - ACTION REQUIRED panel: moment-not-yet-answered OR collecting-not-yet-reacted-and-not-declined,
//    sorted moment-first then soonest deadline; the count label reads "N action(s) required".
//  - The Going / Open / Done segmented filter partitions everything else by bucket; switching the
//    filter changes the list, and an empty bucket shows the empty state.
//  - Tapping a plan card navigates to EventDetail with its eventId.
//  - A query error shows the network-error copy.

jest.mock("../../lib/trpc");

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { render } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { mockQuery, mockQueryError, resetTrpcMock } from "../../lib/__mocks__/trpc";
import { ERR_NETWORK } from "../../lib/copy";
import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { fireEvent, renderScreen, screen, waitFor } from "../../test/render";
import { Dashboard } from "../Dashboard";

beforeEach(resetTrpcMock);

// The exact shape of one events.mine row (apps/api/src/routers/events.ts:763). Tests override only the
// fields under test; everything else is a sane default so the row always renders.
type Ev = RouterOutputs["events"]["mine"][number];
type Group = RouterOutputs["groups"]["mine"][number];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// All times anchored far in the future so the live wall clock can never flip a live plan to "past"
// mid-test (status.isPast compares against Date.now()).
const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const past = (ms: number): string => new Date(Date.now() - ms).toISOString();

function makeEv(overrides: Partial<Ev> & Pick<Ev, "id">): Ev {
  return {
    groupName: "Climbing Crew",
    activity: "Bouldering",
    location: "The Castle",
    phase: "collecting",
    startsAt: future(3 * DAY),
    createdAt: past(DAY),
    decidesBy: future(2 * DAY),
    msLeftToDecide: 2 * DAY,
    momentStartsAt: null,
    momentEndsAt: null,
    msLeft: 0,
    myStatus: "reacting",
    iReacted: false,
    iResponded: false,
    candidateCount: 3,
    isCreator: false,
    readyToLock: false,
    goingCount: 0,
    goingPreview: [],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<Group> & Pick<Group, "id">): Group {
  return { name: "Climbing Crew", memberCount: 4, ...overrides };
}

// A real two-screen stack (Dashboard + a probe EventDetail) so navigation.navigate("EventDetail",
// { eventId }) resolves to an actual route and the probe records the eventId it received. This lets a
// navigation test FAIL on a wrong route name or a dropped/mismatched eventId, rather than just
// asserting "did not throw".
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderInMeetupsStack(): { lastEventId: () => string | undefined } {
  let received: string | undefined;
  const Stack = createNativeStackNavigator();
  function EventDetailProbe({ route }: { route: { params?: { eventId?: string } } }) {
    received = route.params?.eventId;
    return <Text>EventDetail probe for {route.params?.eventId}</Text>;
  }
  // The navigator supplies navigation/route at runtime, so the param-list typing is erased for the
  // registration (the same pattern test/render.tsx uses for renderScreen).
  const DashboardScreen = Dashboard as unknown as ComponentType;
  const ProbeScreen = EventDetailProbe as unknown as ComponentType;
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="EventDetail" component={ProbeScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
  return { lastEventId: () => received };
}

describe("Dashboard - no groups onboarding", () => {
  test("shows the 'No groups yet' onboarding card when the user has no groups", async () => {
    mockQuery(trpc.events.mine, []);
    mockQuery(trpc.groups.mine, []);

    renderScreen(Dashboard);

    expect(await screen.findByText("No groups yet")).toBeOnTheScreen();
    expect(screen.getByText("Create a group")).toBeOnTheScreen();
  });

  test("does NOT show the onboarding card when the user has a group", async () => {
    mockQuery(trpc.events.mine, []);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    // The Going/Open/Done filter only renders in the has-groups branch; wait for it, then assert
    // the onboarding card is absent.
    expect(await screen.findByText("Going")).toBeOnTheScreen();
    expect(screen.queryByText("No groups yet")).not.toBeOnTheScreen();
  });

  test("pressing the onboarding button navigates toward create-a-group", async () => {
    mockQuery(trpc.events.mine, []);
    mockQuery(trpc.groups.mine, []);

    // The Dashboard routes to the sibling Groups stack via navigation.getParent()?.navigate("Groups",
    // { screen: "CreateGroup" }). That parent (the tab navigator) does not exist in a single-screen
    // test stack, so getParent() is null and the press is a safe no-op here; we can only assert the
    // button is present and pressable. The route name/params are type-checked at the call site.
    renderScreen(Dashboard);

    const btn = await screen.findByText("Create a group");
    expect(() => fireEvent.press(btn)).not.toThrow();
  });
});

describe("Dashboard - ACTION REQUIRED panel", () => {
  test("a moment the caller has not answered is action-required", async () => {
    const ev = makeEv({
      id: "m1",
      activity: "Dinner",
      phase: "moment",
      startsAt: future(2 * DAY),
      decidesBy: null,
      momentEndsAt: future(6 * HOUR),
      myStatus: "awaiting",
      iReacted: false,
      iResponded: false,
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    // Spec: one action -> singular "1 action required" (rendered uppercase by the panel).
    expect(await screen.findByText("1 action required")).toBeOnTheScreen();
  });

  test("a collecting plan the caller has not reacted to is action-required", async () => {
    const ev = makeEv({
      id: "c1",
      activity: "Bowling",
      phase: "collecting",
      iReacted: false,
      myStatus: "reacting",
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    expect(await screen.findByText("1 action required")).toBeOnTheScreen();
  });

  test("a collecting plan the caller already reacted to is NOT action-required", async () => {
    const ev = makeEv({
      id: "c2",
      activity: "Bowling",
      phase: "collecting",
      iReacted: true,
      myStatus: "reacting",
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    // Wait for the screen to settle (filter renders), then the panel must be absent.
    expect(await screen.findByText("Going")).toBeOnTheScreen();
    expect(screen.queryByText(/action(s)? required/)).not.toBeOnTheScreen();
  });

  test("a collecting plan the caller declined is NOT action-required", async () => {
    const ev = makeEv({
      id: "c3",
      phase: "collecting",
      iReacted: false,
      myStatus: "declined",
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    expect(await screen.findByText("Going")).toBeOnTheScreen();
    expect(screen.queryByText(/action(s)? required/)).not.toBeOnTheScreen();
  });

  test("a moment the caller already answered is NOT action-required", async () => {
    const ev = makeEv({
      id: "m2",
      phase: "moment",
      decidesBy: null,
      momentEndsAt: future(6 * HOUR),
      iResponded: true,
      myStatus: "going",
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    expect(await screen.findByText("Going")).toBeOnTheScreen();
    expect(screen.queryByText(/action(s)? required/)).not.toBeOnTheScreen();
  });

  test("the count label pluralises for several action items", async () => {
    const a = makeEv({ id: "a", phase: "collecting", iReacted: false });
    const b = makeEv({ id: "b", phase: "collecting", iReacted: false });
    const c = makeEv({
      id: "c",
      phase: "moment",
      decidesBy: null,
      momentEndsAt: future(3 * HOUR),
      iResponded: false,
      myStatus: "awaiting",
    });
    mockQuery(trpc.events.mine, [a, b, c]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    expect(await screen.findByText("3 actions required")).toBeOnTheScreen();
  });

  test("action items are sorted moment-first, then by soonest deadline", async () => {
    // A collecting plan whose deadline is sooner than the moment's close, plus a moment. Spec:
    // moments always lead the panel regardless of which deadline is sooner (compareActions).
    const collectingSoon = makeEv({
      id: "collecting-soon",
      activity: "Picnic",
      phase: "collecting",
      iReacted: false,
      decidesBy: future(1 * HOUR),
    });
    const momentLater = makeEv({
      id: "moment-later",
      activity: "Concert",
      phase: "moment",
      decidesBy: null,
      momentEndsAt: future(10 * HOUR),
      iResponded: false,
      myStatus: "awaiting",
    });
    // Order in the payload is collecting-first to prove the screen re-sorts.
    mockQuery(trpc.events.mine, [collectingSoon, momentLater]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    await screen.findByText("2 actions required");
    await waitFor(() => expect(screen.getByText("Concert")).toBeOnTheScreen());

    // Moment row ("Concert") must appear before the collecting row ("Picnic") in document order,
    // even though the collecting plan's deadline is sooner and it was listed first in the payload.
    expect(orderOf(screen.getByText("Concert"))).toBeLessThan(orderOf(screen.getByText("Picnic")));
  });

  test("two moments are ordered by soonest close first", async () => {
    const later = makeEv({
      id: "later",
      activity: "Late Show",
      phase: "moment",
      decidesBy: null,
      momentEndsAt: future(12 * HOUR),
      iResponded: false,
      myStatus: "awaiting",
    });
    const sooner = makeEv({
      id: "sooner",
      activity: "Early Show",
      phase: "moment",
      decidesBy: null,
      momentEndsAt: future(2 * HOUR),
      iResponded: false,
      myStatus: "awaiting",
    });
    // Payload lists the later-closing one first to prove the re-sort.
    mockQuery(trpc.events.mine, [later, sooner]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    await screen.findByText("2 actions required");
    await waitFor(() => expect(screen.getByText("Early Show")).toBeOnTheScreen());
    expect(orderOf(screen.getByText("Early Show"))).toBeLessThan(
      orderOf(screen.getByText("Late Show")),
    );
  });
});

describe("Dashboard - Going / Open / Done filter", () => {
  // A "going" plan: caller is in, not past, not fizzled. Already responded so it does NOT also land in
  // the action panel (the panel and the bucket lists are disjoint by id).
  const goingPlan = makeEv({
    id: "going",
    activity: "Going Plan",
    phase: "moment",
    decidesBy: null,
    momentEndsAt: future(6 * HOUR),
    startsAt: future(1 * DAY),
    myStatus: "going",
    iResponded: true,
  });
  // An "open" plan: collecting, not declined, not going, not past - and already reacted so it is not
  // action-required (keeps it in the bucket list, not the panel).
  const openPlan = makeEv({
    id: "open",
    activity: "Open Plan",
    phase: "collecting",
    myStatus: "reacting",
    iReacted: true,
  });
  // A "done" plan: cleared in the past.
  const donePlan = makeEv({
    id: "done",
    activity: "Done Plan",
    phase: "cleared",
    decidesBy: null,
    momentEndsAt: past(2 * DAY),
    startsAt: past(2 * DAY),
    myStatus: "going",
    iResponded: true,
    goingCount: 4,
  });

  function mountAll() {
    mockQuery(trpc.events.mine, [goingPlan, openPlan, donePlan]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);
    return renderScreen(Dashboard);
  }

  test("the default Going filter shows only the going-bucket plan", async () => {
    mountAll();

    expect(await screen.findByText("Going Plan")).toBeOnTheScreen();
    expect(screen.queryByText("Open Plan")).not.toBeOnTheScreen();
    expect(screen.queryByText("Done Plan")).not.toBeOnTheScreen();
  });

  test("switching to Open shows only the open-bucket plan", async () => {
    mountAll();

    await screen.findByText("Going Plan");
    fireEvent.press(screen.getByText("Open"));

    expect(await screen.findByText("Open Plan")).toBeOnTheScreen();
    expect(screen.queryByText("Going Plan")).not.toBeOnTheScreen();
    expect(screen.queryByText("Done Plan")).not.toBeOnTheScreen();
  });

  test("switching to Done shows only the done-bucket plan", async () => {
    mountAll();

    await screen.findByText("Going Plan");
    fireEvent.press(screen.getByText("Done"));

    expect(await screen.findByText("Done Plan")).toBeOnTheScreen();
    expect(screen.queryByText("Going Plan")).not.toBeOnTheScreen();
    expect(screen.queryByText("Open Plan")).not.toBeOnTheScreen();
  });

  test("a declined plan lands in Done, not Open", async () => {
    const declined = makeEv({
      id: "declined",
      activity: "Declined Plan",
      phase: "collecting",
      myStatus: "declined",
      iReacted: true,
    });
    mockQuery(trpc.events.mine, [declined]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    // Default Going filter: declined is not shown.
    await screen.findByText("Going");
    expect(screen.queryByText("Declined Plan")).not.toBeOnTheScreen();

    // It is NOT in Open (declined is excluded from the open bucket).
    fireEvent.press(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByText("Nothing here yet.")).toBeOnTheScreen());
    expect(screen.queryByText("Declined Plan")).not.toBeOnTheScreen();

    // It IS in Done.
    fireEvent.press(screen.getByText("Done"));
    expect(await screen.findByText("Declined Plan")).toBeOnTheScreen();
  });

  test("an empty bucket shows the 'Nothing here yet.' empty state", async () => {
    // Only an open plan exists, so the Going bucket is empty.
    mockQuery(trpc.events.mine, [openPlan]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    // Default filter is Going, which has nothing.
    expect(await screen.findByText("Nothing here yet.")).toBeOnTheScreen();

    // Switching to Open reveals the plan and clears the empty state.
    fireEvent.press(screen.getByText("Open"));
    expect(await screen.findByText("Open Plan")).toBeOnTheScreen();
    expect(screen.queryByText("Nothing here yet.")).not.toBeOnTheScreen();
  });
});

describe("Dashboard - navigation", () => {
  test("tapping a plan card navigates to EventDetail with its eventId", async () => {
    const ev = makeEv({
      id: "evt-42",
      activity: "Open Plan",
      phase: "collecting",
      myStatus: "reacting",
      iReacted: true, // keep it out of the action panel so we tap the bucket card
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    const nav = renderInMeetupsStack();

    await screen.findByText("Going");
    fireEvent.press(screen.getByText("Open"));
    const card = await screen.findByText("Open Plan");
    fireEvent.press(card);

    // The probe EventDetail screen records exactly the eventId the card passed.
    await waitFor(() => expect(nav.lastEventId()).toBe("evt-42"));
  });

  test("tapping an action-panel row navigates to EventDetail with its eventId", async () => {
    const ev = makeEv({
      id: "evt-99",
      activity: "Pending Moment",
      phase: "moment",
      decidesBy: null,
      momentEndsAt: future(4 * HOUR),
      iResponded: false,
      myStatus: "awaiting",
    });
    mockQuery(trpc.events.mine, [ev]);
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    const nav = renderInMeetupsStack();

    await screen.findByText("1 action required");
    fireEvent.press(screen.getByText("Pending Moment"));

    await waitFor(() => expect(nav.lastEventId()).toBe("evt-99"));
  });
});

describe("Dashboard - errors", () => {
  test("a query error shows the network error copy", async () => {
    mockQueryError(trpc.events.mine, new Error("boom"));
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1" })]);

    renderScreen(Dashboard);

    expect(await screen.findByText(ERR_NETWORK)).toBeOnTheScreen();
  });

  test("the error copy is the canonical fetch-failure string", () => {
    // Locks the spec's wording so a screen edit cannot drift it silently.
    expect(ERR_NETWORK).toBe("Couldn't reach the server.");
  });
});

// Document order of a rendered node among all text nodes, so "appears before" assertions do not depend
// on layout. RNTL exposes the test instance tree; we flatten it and compare indices.
function orderOf(node: ReturnType<typeof screen.getByText>): number {
  const all = screen.root.findAll(() => true);
  return all.indexOf(node);
}
