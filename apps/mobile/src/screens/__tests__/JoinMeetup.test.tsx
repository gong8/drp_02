// JoinMeetup (authed) funnel tests. Assertions derive from the SPEC (a meetup token resolves to a
// public preview, then one tap joins the group and lands on the plan), not the implementation. The
// previewByToken / joinByToken procedures are mocked; navigation is asserted structurally via echo
// stubs (as in JoinGroup.test.tsx). The logged-out MeetupWelcome path is exercised via the manual
// web e2e (it depends on Clerk's SSO flow), not here.

jest.mock("../../lib/trpc");

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { cleanup, render } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  mockMutation,
  mockMutationError,
  mockQuery,
  mockQueryError,
  resetTrpcMock,
} from "../../lib/__mocks__/trpc";
import {
  ACTION_OPEN_IF_IN,
  ACTION_VIEW_MEETUP,
  MEETUP_CLOSED_TITLE,
  MEETUP_NOT_FOUND_TITLE,
  meetupInviteHeadline,
} from "../../lib/copy";
import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { fireEvent, screen, waitFor } from "../../test/render";
import { JoinMeetup } from "../JoinMeetup";

beforeEach(resetTrpcMock);
afterEach(cleanup);

type Preview = RouterOutputs["events"]["previewByToken"];
type JoinResult = RouterOutputs["events"]["joinByToken"];

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function makeStub(name: string): ComponentType {
  function Stub({ route }: { route: { params?: object } }) {
    return (
      <View>
        <Text>{`stub:${name}`}</Text>
        <Text>{`params:${JSON.stringify(route.params ?? {})}`}</Text>
      </View>
    );
  }
  return Stub as unknown as ComponentType;
}

const Stack = createNativeStackNavigator();

// Mount JoinMeetup as the initial route alongside the reset targets (Dashboard + EventDetail) as echo
// stubs, so a successful join's navigation.reset lands on a real registered route.
function mountJoin(params?: object) {
  const Initial = JoinMeetup as unknown as ComponentType;
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="JoinMeetup" component={Initial} initialParams={params} />
          <Stack.Screen name="Dashboard" component={makeStub("Dashboard")} />
          <Stack.Screen name="EventDetail" component={makeStub("EventDetail")} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

const basePreview: Preview = {
  eventId: "e1",
  activity: "Bowling",
  groupName: "The Boys",
  phase: "moment",
  startsAt: "2026-06-12T19:00:00.000Z",
  candidateCount: 0,
  joinsOpen: true,
};

test("a token previews the meetup, then joining lands on the plan", async () => {
  const preview: Preview = basePreview;
  const joined: JoinResult = { eventId: "e1", groupId: "g1", alreadyMember: false };
  mockQuery(trpc.events.previewByToken, preview);
  mockMutation(trpc.events.joinByToken, joined);

  mountJoin({ token: "e1" });

  // The preview shows what you're invited to + the group (no member/voter names).
  expect(await screen.findByText(meetupInviteHeadline("Bowling"))).toBeOnTheScreen();
  expect(screen.getByText("The Boys")).toBeOnTheScreen();
  await waitFor(() =>
    expect(trpc.events.previewByToken.query).toHaveBeenCalledWith({ eventId: "e1" }),
  );

  // One tap joins the group and lands on the plan's detail.
  fireEvent.press(screen.getByText(ACTION_VIEW_MEETUP));
  await waitFor(() =>
    expect(trpc.events.joinByToken.mutate).toHaveBeenCalledWith({ eventId: "e1" }),
  );
  expect(await screen.findByText("stub:EventDetail")).toBeOnTheScreen();
  expect(screen.getByText('params:{"eventId":"e1"}')).toBeOnTheScreen();
});

test("an unknown token shows the not-found error, not a crash", async () => {
  mockQueryError(trpc.events.previewByToken, { data: { code: "NOT_FOUND" } });

  mountJoin({ token: "e_missing" });

  expect(await screen.findByText(MEETUP_NOT_FOUND_TITLE)).toBeOnTheScreen();
});

test("the link's ?via= rides along into the join for brought-by attribution (DRP-63)", async () => {
  mockQuery(trpc.events.previewByToken, basePreview);
  mockMutation(trpc.events.joinByToken, {
    eventId: "e1",
    groupId: "g1",
    alreadyMember: false,
  } satisfies JoinResult);

  mountJoin({ token: "e1", via: "u_sharer" });

  fireEvent.press(await screen.findByText(ACTION_VIEW_MEETUP));
  await waitFor(() =>
    expect(trpc.events.joinByToken.mutate).toHaveBeenCalledWith({ eventId: "e1", via: "u_sharer" }),
  );
});

test("a closed +1 door previews with the closed notice and a quiet already-in path (DRP-63)", async () => {
  mockQuery(trpc.events.previewByToken, { ...basePreview, joinsOpen: false });
  mockMutation(trpc.events.joinByToken, {
    eventId: "e1",
    groupId: "g1",
    alreadyMember: true,
  } satisfies JoinResult);

  mountJoin({ token: "e1" });

  // No affirmative join CTA - the closed notice plus the already-in escape hatch instead.
  expect(await screen.findByText(MEETUP_CLOSED_TITLE)).toBeOnTheScreen();
  expect(screen.queryByText(ACTION_VIEW_MEETUP)).toBeNull();

  // An existing roster member no-ops through to the plan.
  fireEvent.press(screen.getByText(ACTION_OPEN_IF_IN));
  expect(await screen.findByText("stub:EventDetail")).toBeOnTheScreen();
});

test("a stranger refused by the closed door (FORBIDDEN) sees the closed state, not a crash", async () => {
  mockQuery(trpc.events.previewByToken, { ...basePreview, joinsOpen: false });
  mockMutationError(trpc.events.joinByToken, { data: { code: "FORBIDDEN" } });

  mountJoin({ token: "e1" });

  fireEvent.press(await screen.findByText(ACTION_OPEN_IF_IN));
  // The closed error card replaces the preview: wait for its dashboard CTA (unique to the error
  // state - the closed preview has no affirmative CTA), then check the closed title rode along.
  expect(await screen.findByText(ACTION_VIEW_MEETUP)).toBeOnTheScreen();
  expect(screen.getByText(MEETUP_CLOSED_TITLE)).toBeOnTheScreen();
});
