// Group screen tests (GroupsList, GroupDetail, CreateGroup). Assertions are derived from the
// SPEC (ARCHITECTURE.md + CLAUDE.md + the groups router + the shared schemas), not from what the
// implementation happens to render. The product model: groups support membership CRUD - a user
// sees the groups they belong to (with member counts), can open one to see its roster, add or
// remove members, rename it, and create a new group from a name.
//
// Navigation is asserted structurally: each screen is mounted in a real multi-route stack whose
// destination routes are stub screens that echo the route name + the params they received. So a
// correct navigate makes the destination stub appear with the right params; a misroute or dropped
// param would fail the assertion. This is stronger than a "did not throw" smoke check because it
// pins both the target route and the payload.

jest.mock("../../lib/trpc");

import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
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
  ACTION_CREATE_GROUP,
  ACTION_JOIN,
  ACTION_JOIN_WITH_CODE,
  ERR_NETWORK,
  LABEL_JOIN_CODE,
  ONBOARD_NO_GROUPS_TITLE,
  TITLE_INVITE,
  TITLE_NEW_GROUP,
} from "../../lib/copy";
import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { act, fireEvent, screen, waitFor } from "../../test/render";
import { CreateGroup } from "../CreateGroup";
import { GroupDetail } from "../GroupDetail";
import { GroupsList } from "../GroupsList";

beforeEach(resetTrpcMock);
// Unmount the previous test's tree so a stale screen never bleeds state (e.g. a typed name or a
// still-mounted form) into the next test's queries. RNTL's auto-cleanup is not firing under this
// preset, so we do it explicitly.
afterEach(cleanup);

// ---- shapes (from the groups router return types; values are spec-irrelevant defaults) ----------
type Group = RouterOutputs["groups"]["mine"][number];
type Detail = NonNullable<RouterOutputs["groups"]["get"]>;
type Member = Detail["members"][number];
type Invite = RouterOutputs["groups"]["inviteByGroup"];

function makeGroup(overrides: Partial<Group> & Pick<Group, "id">): Group {
  return { name: "Climbing Crew", memberCount: 4, ...overrides };
}

function makeMember(overrides: Partial<Member> & Pick<Member, "id">): Member {
  return { name: "Ada", color: "#5F9472", ...overrides };
}

function makeDetail(overrides: Partial<Detail> & Pick<Detail, "id">): Detail {
  return {
    name: "Climbing Crew",
    members: [makeMember({ id: "u1", name: "Ada" })],
    ...overrides,
  };
}

// Fixed safe-area metrics so insets resolve synchronously (mirrors test/render.tsx).
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// A stub destination screen: renders the route name and a JSON dump of its params, so a test can
// assert both WHICH route the screen navigated to and WHAT params it carried. The navigator supplies
// navigation/route at runtime; the screen-component param typing is erased for registration (the same
// approach test/render.tsx's renderScreen uses).
type StubProps = { route: { params?: object } };
function makeStub(name: string): ComponentType {
  function Stub({ route }: StubProps) {
    return (
      <View>
        <Text>{`stub:${name}`}</Text>
        <Text>{`params:${JSON.stringify(route.params ?? {})}`}</Text>
      </View>
    );
  }
  return Stub as unknown as ComponentType;
}

// Read how many times a mocked mutation has been invoked. resetTrpcMock leaves stale call history
// on mutation fns, so tests that assert "not called" compare a delta from a baseline instead of an
// absolute zero. The mock's .mutate is a jest.fn, so it carries a `mock.calls` array.
function mutateCalls(proc: { mutate: unknown }): number {
  const fn = proc.mutate as unknown as { mock?: { calls: unknown[] } };
  return fn.mock?.calls.length ?? 0;
}

const Stack = createNativeStackNavigator();

// Mount `Component` as the initial route of a real stack that also registers the named destination
// routes as echo stubs. Because it is a real navigator, useFocusEffect/useFetchOnFocus fire and the
// screen receives a working { navigation, route }. Navigating to a destination mounts its stub.
// Generic over the screen's own props so any typed screen is accepted; the navigator supplies
// navigation/route at runtime, so the param-list typing is erased for registration.
function mountStack<P extends object>(
  Component: ComponentType<P>,
  opts: { initialName: string; params?: object; destinations: string[] },
) {
  const Initial = Component as unknown as ComponentType;
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name={opts.initialName} component={Initial} initialParams={opts.params} />
          {opts.destinations.map((d) => (
            <Stack.Screen key={d} name={d} component={makeStub(d)} />
          ))}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

// Mount GroupDetail in a stack alongside a sibling stub and return a `refocus()` that pushes the stub
// (blurring GroupDetail) then pops back (re-focusing it), so its on-focus load() fires again. This is
// how a transient failure recovers in the real app: there is no in-screen retry on the error view,
// the screen reloads when it regains focus. The refocus is wrapped in act() so the navigation state
// updates and the re-fired load() resolve before assertions run.
function mountGroupDetailWithRefocus(params: object) {
  // Type the ref's param list so navigate("Sibling")/goBack() typecheck against this ad-hoc
  // navigator's route names (GroupDetail carries params; Sibling is a paramless stub).
  const ref = createNavigationContainerRef<{ GroupDetail: object; Sibling: undefined }>();
  const Initial = GroupDetail as unknown as ComponentType;
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer ref={ref}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="GroupDetail" component={Initial} initialParams={params} />
          <Stack.Screen name="Sibling" component={makeStub("Sibling")} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
  return {
    async refocus() {
      await act(async () => ref.navigate("Sibling"));
      await act(async () => ref.goBack());
    },
  };
}

// =================================================================================================
// GroupsList
// =================================================================================================
describe("GroupsList", () => {
  test("renders each of the user's groups with its member count", async () => {
    mockQuery(trpc.groups.mine, [
      makeGroup({ id: "g1", name: "Climbing Crew", memberCount: 4 }),
      makeGroup({ id: "g2", name: "Book Club", memberCount: 7 }),
    ]);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account"],
    });

    // Each group is named, with its own member count. Spec: groups.mine returns a memberCount per row.
    expect(await screen.findByText("Climbing Crew")).toBeOnTheScreen();
    expect(screen.getByText("Book Club")).toBeOnTheScreen();
    expect(screen.getByText("4 members")).toBeOnTheScreen();
    expect(screen.getByText("7 members")).toBeOnTheScreen();
  });

  test("a user with no groups sees the two-path onboarding card (create / join)", async () => {
    mockQuery(trpc.groups.mine, []);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account", "JoinGroup"],
    });

    // Spec: a brand-new user is offered both paths into a group, not a dead-end "No groups yet".
    expect(await screen.findByText(ONBOARD_NO_GROUPS_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(ACTION_CREATE_GROUP)).toBeOnTheScreen();
    expect(screen.getByText(ACTION_JOIN_WITH_CODE)).toBeOnTheScreen();
  });

  test("the onboarding 'Create a group' button navigates to CreateGroup", async () => {
    mockQuery(trpc.groups.mine, []);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account", "JoinGroup"],
    });

    fireEvent.press(await screen.findByText(ACTION_CREATE_GROUP));

    expect(await screen.findByText("stub:CreateGroup")).toBeOnTheScreen();
  });

  test("does NOT show the onboarding card when there is at least one group", async () => {
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1", name: "Climbing Crew" })]);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account", "JoinGroup"],
    });

    expect(await screen.findByText("Climbing Crew")).toBeOnTheScreen();
    expect(screen.queryByText(ONBOARD_NO_GROUPS_TITLE)).not.toBeOnTheScreen();
  });

  test("tapping a group navigates to GroupDetail carrying that group's id", async () => {
    mockQuery(trpc.groups.mine, [
      makeGroup({ id: "g1", name: "Climbing Crew" }),
      makeGroup({ id: "g2", name: "Book Club" }),
    ]);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account"],
    });

    fireEvent.press(await screen.findByText("Book Club"));

    // The GroupDetail stub mounts (right route) and echoes the id it received (right param).
    expect(await screen.findByText("stub:GroupDetail")).toBeOnTheScreen();
    expect(screen.getByText('params:{"groupId":"g2"}')).toBeOnTheScreen();
  });

  test("the 'New group' affordance navigates to CreateGroup", async () => {
    // With at least one group the trailing "New group" button is shown (the onboarding card is not).
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1", name: "Climbing Crew" })]);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account", "JoinGroup"],
    });

    fireEvent.press(await screen.findByText(TITLE_NEW_GROUP));

    expect(await screen.findByText("stub:CreateGroup")).toBeOnTheScreen();
  });

  test("'Join with a code' navigates to JoinGroup carrying the normalized code", async () => {
    mockQuery(trpc.groups.mine, [makeGroup({ id: "g1", name: "Climbing Crew" })]);

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account", "JoinGroup"],
    });

    // Open the paste sheet, type a pretty/lowercased code, and join.
    fireEvent.press(await screen.findByText(ACTION_JOIN_WITH_CODE));
    const field = await screen.findByPlaceholderText("ABCDEF12");
    fireEvent.changeText(field, "abcd-2345");
    fireEvent.press(screen.getByText(ACTION_JOIN));

    // The code is normalized (uppercased, dash stripped) before it travels to the join funnel.
    expect(await screen.findByText("stub:JoinGroup")).toBeOnTheScreen();
    expect(screen.getByText('params:{"code":"ABCD2345"}')).toBeOnTheScreen();
  });

  test("a query failure surfaces the canonical network-error copy", async () => {
    mockQueryError(trpc.groups.mine, new Error("boom"));

    mountStack(GroupsList, {
      initialName: "GroupsList",
      destinations: ["GroupDetail", "CreateGroup", "Account"],
    });

    expect(await screen.findByText(ERR_NETWORK)).toBeOnTheScreen();
  });
});

// =================================================================================================
// GroupDetail
// =================================================================================================
describe("GroupDetail", () => {
  test("renders the full member roster from groups.get", async () => {
    mockQuery(
      trpc.groups.get,
      makeDetail({
        id: "g1",
        name: "Climbing Crew",
        members: [
          makeMember({ id: "u1", name: "Ada" }),
          makeMember({ id: "u2", name: "Grace" }),
          makeMember({ id: "u3", name: "Linus" }),
        ],
      }),
    );

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    expect(await screen.findByText("Ada")).toBeOnTheScreen();
    expect(screen.getByText("Grace")).toBeOnTheScreen();
    expect(screen.getByText("Linus")).toBeOnTheScreen();
  });

  test("the roster header reports the member count", async () => {
    mockQuery(
      trpc.groups.get,
      makeDetail({
        id: "g1",
        members: [makeMember({ id: "u1", name: "Ada" }), makeMember({ id: "u2", name: "Grace" })],
      }),
    );

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    // Spec: the roster section is labelled with the live member count.
    expect(await screen.findByText("Members (2)")).toBeOnTheScreen();
  });

  test("fetches the group by the id from route params", async () => {
    mockQuery(trpc.groups.get, makeDetail({ id: "g7", name: "Trivia Night" }));

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g7" },
      destinations: [],
    });

    await screen.findByText("Trivia Night");
    expect(trpc.groups.get.query).toHaveBeenCalledWith({ id: "g7" });
  });

  test("removing a member calls groups.removeMember with the group and that user", async () => {
    mockQuery(
      trpc.groups.get,
      makeDetail({
        id: "g1",
        members: [makeMember({ id: "u1", name: "Ada" }), makeMember({ id: "u2", name: "Grace" })],
      }),
    );
    mockMutation(trpc.groups.removeMember, { ok: true });

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    await screen.findByText("Ada");
    // Each roster row has a "×" remove control; there is one per member.
    const removeButtons = screen.getAllByText("×");
    expect(removeButtons.length).toBe(2);
    fireEvent.press(removeButtons[1]);

    await waitFor(() =>
      expect(trpc.groups.removeMember.mutate).toHaveBeenCalledWith({ groupId: "g1", userId: "u2" }),
    );
  });

  test("the group grows via invites, not a seeded-user picker", async () => {
    // Spec (M4): the old "+ Add to group" picker is replaced by an invite. The forward action is now
    // "Invite to group"; the seeded picker affordance must be gone.
    mockQuery(
      trpc.groups.get,
      makeDetail({ id: "g1", members: [makeMember({ id: "u1", name: "Ada" })] }),
    );

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    expect(await screen.findByText(TITLE_INVITE)).toBeOnTheScreen();
    expect(screen.queryByText("+ Add to group")).not.toBeOnTheScreen();
  });

  test("opening 'Invite to group' shows the join code and link from inviteByGroup", async () => {
    mockQuery(
      trpc.groups.get,
      makeDetail({ id: "g1", members: [makeMember({ id: "u1", name: "Ada" })] }),
    );
    const invite: Invite = {
      code: "ABCD2345",
      url: "https://bethere-beta.vercel.app/join/ABCD2345",
    };
    mockQuery(trpc.groups.inviteByGroup, invite);

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    fireEvent.press(await screen.findByText(TITLE_INVITE));

    // The invite is fetched for this group when the sheet opens, and the code is shown grouped for
    // legibility (ABCD-2345) alongside the shareable link verbatim.
    await waitFor(() =>
      expect(trpc.groups.inviteByGroup.query).toHaveBeenCalledWith({ groupId: "g1" }),
    );
    expect(await screen.findByText("ABCD-2345")).toBeOnTheScreen();
    expect(screen.getByText(LABEL_JOIN_CODE)).toBeOnTheScreen();
    expect(
      screen.getByDisplayValue("https://bethere-beta.vercel.app/join/ABCD2345"),
    ).toBeOnTheScreen();
  });

  test("renaming to a new name calls groups.rename with the trimmed name", async () => {
    mockQuery(trpc.groups.get, makeDetail({ id: "g1", name: "Climbing Crew" }));
    mockMutation(trpc.groups.rename, { ok: true });

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    await screen.findByText("Members (1)");
    // The name field is pre-filled with the current name; editing it reveals "Save".
    const field = screen.getByDisplayValue("Climbing Crew");
    fireEvent.changeText(field, "  Boulder Buddies  ");

    fireEvent.press(await screen.findByText("Save"));

    await waitFor(() =>
      expect(trpc.groups.rename.mutate).toHaveBeenCalledWith({ id: "g1", name: "Boulder Buddies" }),
    );
  });

  test("no Save affordance appears until the name actually changes", async () => {
    mockQuery(trpc.groups.get, makeDetail({ id: "g1", name: "Climbing Crew" }));

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    // Field is pre-filled with the current name, which is not a change -> no Save.
    await screen.findByDisplayValue("Climbing Crew");
    expect(screen.queryByText("Save")).not.toBeOnTheScreen();
  });

  test("clearing the name to blank does not offer Save (an empty rename is blocked)", async () => {
    // Spec: GroupName is non-empty (RenameGroupInput rejects ""), so a blank draft must not rename.
    mockQuery(trpc.groups.get, makeDetail({ id: "g1", name: "Climbing Crew" }));

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    const field = await screen.findByDisplayValue("Climbing Crew");
    fireEvent.changeText(field, "   ");

    await screen.findByText("Members (1)");
    expect(screen.queryByText("Save")).not.toBeOnTheScreen();
  });

  test("a missing group (null) shows the not-found state, not the network error", async () => {
    // Spec: groups.get returns null for a group that does not exist; the screen shows its own
    // not-found label rather than the network-error copy.
    mockQuery(trpc.groups.get, null);

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "ghost" },
      destinations: [],
    });

    expect(await screen.findByText("Group not found.")).toBeOnTheScreen();
    expect(screen.queryByText(ERR_NETWORK)).not.toBeOnTheScreen();
  });

  test("a fetch failure shows the network error, not the not-found label", async () => {
    mockQueryError(trpc.groups.get, new Error("boom"));

    mountStack(GroupDetail, {
      initialName: "GroupDetail",
      params: { groupId: "g1" },
      destinations: [],
    });

    expect(await screen.findByText(ERR_NETWORK)).toBeOnTheScreen();
    expect(screen.queryByText("Group not found.")).not.toBeOnTheScreen();
  });

  test("a transient failure clears once a later reload succeeds (error is not sticky)", async () => {
    // I1: the first focus fails (full-screen error view), but a subsequent focus that succeeds must
    // drop the error and render the group. The old bug only ever set the error flag true, so the
    // screen stayed stuck on the error view forever even after the server recovered.
    const getQuery = trpc.groups.get.query as unknown as jest.Mock;
    getQuery
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(makeDetail({ id: "g1", name: "Climbing Crew" }));

    const { refocus } = mountGroupDetailWithRefocus({ groupId: "g1" });

    expect(await screen.findByText(ERR_NETWORK)).toBeOnTheScreen();

    await refocus();

    expect(await screen.findByText("Members (1)")).toBeOnTheScreen();
    expect(screen.queryByText(ERR_NETWORK)).not.toBeOnTheScreen();
  });

  test("an in-progress rename draft survives an unrelated reload", async () => {
    // The draft is seeded from the server only on the first load; a later reload (a refocus) must not
    // clobber a half-typed rename.
    mockQuery(trpc.groups.get, makeDetail({ id: "g1", name: "Climbing Crew" }));

    const { refocus } = mountGroupDetailWithRefocus({ groupId: "g1" });

    const field = await screen.findByDisplayValue("Climbing Crew");
    fireEvent.changeText(field, "Boulder Buddies");

    // A reload fires (the screen regains focus), still returning the old name from the server.
    await refocus();

    // The unsaved draft is preserved (not reset to "Climbing Crew"), so Save still shows.
    expect(screen.getByDisplayValue("Boulder Buddies")).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText("Save")).toBeOnTheScreen());
  });
});

// =================================================================================================
// CreateGroup
// =================================================================================================
// Mount the real GroupsList with CreateGroup pushed on top, so CreateGroup's success-path goBack()
// has a valid back-target (avoids a spurious React Navigation GO_BACK warning for an initial route).
function mountCreateGroupPushed() {
  mockQuery(trpc.groups.mine, [makeGroup({ id: "g1", name: "Climbing Crew" })]);
  // Erase the screens' param-list typing for registration (navigator supplies navigation/route).
  const ListScreen = GroupsList as unknown as ComponentType;
  const CreateScreen = CreateGroup as unknown as ComponentType;
  const r = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="GroupsList">
          <Stack.Screen name="GroupsList" component={ListScreen} />
          <Stack.Screen name="CreateGroup" component={CreateScreen} />
          <Stack.Screen name="GroupDetail" component={makeStub("GroupDetail")} />
          <Stack.Screen name="Account" component={makeStub("Account")} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
  return r;
}

describe("CreateGroup", () => {
  test("submitting a name calls groups.create with the trimmed name", async () => {
    mockMutation(trpc.groups.create, { id: "g_new" });

    mountCreateGroupPushed();

    fireEvent.press(await screen.findByText("New group"));
    const field = await screen.findByPlaceholderText("The Boys");
    fireEvent.changeText(field, "  Trivia Night  ");
    fireEvent.press(screen.getByText("Create group"));

    await waitFor(() =>
      expect(trpc.groups.create.mutate).toHaveBeenCalledWith({ name: "Trivia Night" }),
    );
  });

  test("a successful create lands on the new group's invite (GroupDetail, justCreated)", async () => {
    // Spec (M4): after creating, the creator is taken straight into the new group with its invite
    // ready to share (replace, so back returns to the list), not just back to the list.
    mockMutation(trpc.groups.create, { id: "g_new" });

    mountCreateGroupPushed();

    fireEvent.press(await screen.findByText("New group"));
    const field = await screen.findByPlaceholderText("The Boys");
    fireEvent.changeText(field, "Trivia Night");
    fireEvent.press(screen.getByText("Create group"));

    // The form is replaced by the new group, flagged to auto-open its invite sheet.
    expect(await screen.findByText("stub:GroupDetail")).toBeOnTheScreen();
    expect(screen.getByText('params:{"groupId":"g_new","justCreated":true}')).toBeOnTheScreen();
  });

  test("an empty name does not call groups.create", async () => {
    mockMutation(trpc.groups.create, { id: "g_new" });

    mountStack(CreateGroup, { initialName: "CreateGroup", destinations: ["GroupsList"] });

    // Baseline: resetTrpcMock does not reliably clear the mutate call history between tests (harness
    // gap), so count calls made AFTER our own press rather than asserting an absolute zero.
    await screen.findByText("Create group");
    const before = mutateCalls(trpc.groups.create);

    // The button exists but the name is blank: pressing it must be a no-op (the button is disabled
    // and the create guard rejects an empty/whitespace name).
    fireEvent.press(screen.getByText("Create group"));

    // Give any erroneous async submit a tick to fire; it must not.
    await waitFor(() => expect(screen.getByText("Create group")).toBeOnTheScreen());
    expect(mutateCalls(trpc.groups.create)).toBe(before);
  });

  test("a whitespace-only name does not call groups.create", async () => {
    mockMutation(trpc.groups.create, { id: "g_new" });

    mountStack(CreateGroup, { initialName: "CreateGroup", destinations: ["GroupsList"] });

    const field = await screen.findByPlaceholderText("The Boys");
    const before = mutateCalls(trpc.groups.create);
    fireEvent.changeText(field, "    ");
    fireEvent.press(screen.getByText("Create group"));

    await waitFor(() => expect(screen.getByText("Create group")).toBeOnTheScreen());
    // Whitespace trims to empty, which the GroupName schema rejects, so no create call is made.
    expect(mutateCalls(trpc.groups.create)).toBe(before);
  });

  test("a create failure shows the save-error copy and stays on the form", async () => {
    mockMutationError(trpc.groups.create, new Error("boom"));

    mountStack(CreateGroup, { initialName: "CreateGroup", destinations: ["GroupsList"] });

    const field = await screen.findByPlaceholderText("The Boys");
    fireEvent.changeText(field, "Trivia Night");
    fireEvent.press(screen.getByText("Create group"));

    expect(await screen.findByText("Couldn't save. Try again.")).toBeOnTheScreen();
    // Still on the form (did not navigate away).
    expect(screen.getByText("Create group")).toBeOnTheScreen();
  });
});
