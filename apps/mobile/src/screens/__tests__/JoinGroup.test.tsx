// JoinGroup funnel tests. Assertions derive from the SPEC (the join flow: a code resolves to a
// preview, the user confirms, then joins and lands in the group), not the implementation. The
// previewByCode / joinByCode procedures are mocked; navigation is asserted structurally via echo
// stubs (as in Groups.test.tsx).

jest.mock("../../lib/trpc");

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { cleanup, render } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { mockMutation, mockQuery, mockQueryError, resetTrpcMock } from "../../lib/__mocks__/trpc";
import {
  ACTION_FIND_GROUP,
  ACTION_JOIN_GROUP,
  JOIN_NOT_FOUND_TITLE,
  joinPrompt,
  memberCountLabel,
} from "../../lib/copy";
import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { fireEvent, screen, waitFor } from "../../test/render";
import { JoinGroup } from "../JoinGroup";

beforeEach(resetTrpcMock);
afterEach(cleanup);

type Preview = RouterOutputs["groups"]["previewByCode"];
type JoinResult = RouterOutputs["groups"]["joinByCode"];

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

// Mount JoinGroup as the initial route alongside the reset targets (GroupsList + GroupDetail) as echo
// stubs, so a successful join's navigation.reset lands on a real registered route.
function mountJoin(params?: object) {
  const Initial = JoinGroup as unknown as ComponentType;
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="JoinGroup" component={Initial} initialParams={params} />
          <Stack.Screen name="GroupsList" component={makeStub("GroupsList")} />
          <Stack.Screen name="GroupDetail" component={makeStub("GroupDetail")} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

test("entering a code previews the group, then joining lands in it (justJoined)", async () => {
  const preview: Preview = { groupId: "g1", name: "Climbing Crew", memberCount: 5 };
  const joined: JoinResult = { groupId: "g1", name: "Climbing Crew", alreadyMember: false };
  mockQuery(trpc.groups.previewByCode, preview);
  mockMutation(trpc.groups.joinByCode, joined);

  mountJoin({});

  // idle -> type a code -> find the group.
  const field = await screen.findByPlaceholderText("ABCD-EF12");
  fireEvent.changeText(field, "abcd-2345");
  fireEvent.press(screen.getByText(ACTION_FIND_GROUP));

  // The confirm step shows the group name + size (no member names).
  expect(await screen.findByText(joinPrompt("Climbing Crew"))).toBeOnTheScreen();
  expect(screen.getByText(memberCountLabel(5))).toBeOnTheScreen();
  await waitFor(() =>
    expect(trpc.groups.previewByCode.query).toHaveBeenCalledWith({ code: "ABCD2345" }),
  );

  // Joining redeems the code and lands on the group, flagged for the one-time welcome band.
  fireEvent.press(screen.getByText(ACTION_JOIN_GROUP));
  await waitFor(() =>
    expect(trpc.groups.joinByCode.mutate).toHaveBeenCalledWith({ code: "ABCD2345" }),
  );
  expect(await screen.findByText("stub:GroupDetail")).toBeOnTheScreen();
  expect(screen.getByText('params:{"groupId":"g1","justJoined":true}')).toBeOnTheScreen();
});

test("a code carried in the route params auto-resolves to the confirm step", async () => {
  mockQuery(trpc.groups.previewByCode, {
    groupId: "g2",
    name: "Book Club",
    memberCount: 1,
  } satisfies Preview);

  mountJoin({ code: "WXYZ2345" });

  // No "Find group" press needed: a complete code from a tapped link previews automatically.
  expect(await screen.findByText(joinPrompt("Book Club"))).toBeOnTheScreen();
  // "1 member" pluralizes correctly.
  expect(screen.getByText(memberCountLabel(1))).toBeOnTheScreen();
});

test("an unknown code shows the not-found error, not a crash", async () => {
  mockQueryError(trpc.groups.previewByCode, { data: { code: "NOT_FOUND" } });

  mountJoin({ code: "ZZZZ9999" });

  expect(await screen.findByText(JOIN_NOT_FOUND_TITLE)).toBeOnTheScreen();
});
