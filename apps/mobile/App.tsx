import { ClerkProvider } from "@clerk/clerk-expo";
import { Archivo_800ExtraBold, Archivo_900Black } from "@expo-google-fonts/archivo";
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from "@expo-google-fonts/inter";
import { type BottomTabBarProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  createNavigationContainerRef,
  type LinkingOptions,
  NavigationContainer,
  type NavigatorScreenParams,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useCallback } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { DevAuthProvider, useAuthBridge } from "./src/lib/auth";
import { publishableKey, tokenCache } from "./src/lib/clerk";
import { usePendingInviteRouting } from "./src/lib/usePendingInvite";
import { useMeetupLaunchToken, usePendingMeetupRouting } from "./src/lib/usePendingMeetup";
import { Account } from "./src/screens/Account";
import { CreateGroup } from "./src/screens/CreateGroup";
import { CreateWizard } from "./src/screens/CreateWizard";
import { Dashboard } from "./src/screens/Dashboard";
import { EventDetail } from "./src/screens/EventDetail";
import { GroupDetail } from "./src/screens/GroupDetail";
import { GroupsList } from "./src/screens/GroupsList";
import { JoinGroup } from "./src/screens/JoinGroup";
import { JoinMeetup, MeetupWelcome } from "./src/screens/JoinMeetup";
import { SignIn } from "./src/screens/SignIn";
import { font, ui, webColumnMaxWidth } from "./src/theme";
import { WebBackdrop } from "./src/ui/WebBackdrop";

// Account is reachable from either tab (via the top-right avatar), so it is registered in both stacks
// and gets a real back button - there is no Account tab anymore.
export type MeetupsStackParams = {
  Dashboard: undefined;
  EventDetail: { eventId: string };
  CreateWizard: undefined;
  // The authed landing for a tapped meetup share link (/m/:token); previews the plan then joins.
  JoinMeetup: { token?: string };
  Account: undefined;
};
export type GroupsStackParams = {
  GroupsList: undefined;
  // justCreated: opened straight after creating the group (auto-opens the invite sheet).
  // justJoined: opened straight after joining (shows a one-time welcome band).
  GroupDetail: { groupId: string; justCreated?: boolean; justJoined?: boolean };
  CreateGroup: undefined;
  JoinGroup: { code?: string };
  Account: undefined;
};

// The root tab param list, used to type the navigation ref so the auth gate can route a pending
// invite into the nested Groups -> JoinGroup screen.
export type RootTabParamList = {
  Meetups: NavigatorScreenParams<MeetupsStackParams>;
  Groups: NavigatorScreenParams<GroupsStackParams>;
};

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

// Deep-link map. The only path we need today is the invite link; `/join/:code` resolves to the
// Groups tab's JoinGroup screen (pushed over GroupsList). The same path-based config upgrades to a
// native universal link later with no change here. Both the custom scheme and the public web origin
// (when configured) are accepted as prefixes.
const linking: LinkingOptions<RootTabParamList> = {
  prefixes: [
    "bethere://",
    ...(process.env.EXPO_PUBLIC_WEB_URL ? [process.env.EXPO_PUBLIC_WEB_URL] : []),
  ],
  config: {
    screens: {
      Meetups: {
        initialRouteName: "Dashboard",
        screens: { JoinMeetup: "m/:token" },
      },
      Groups: {
        initialRouteName: "GroupsList",
        screens: { JoinGroup: "join/:code" },
      },
    },
  },
};

const stackHeader = {
  headerShown: false,
  contentStyle: { backgroundColor: "transparent" },
} as const;

const MeetupsStack = createNativeStackNavigator<MeetupsStackParams>();
function MeetupsStackScreen() {
  return (
    <MeetupsStack.Navigator screenOptions={stackHeader}>
      <MeetupsStack.Screen name="Dashboard" component={Dashboard} />
      <MeetupsStack.Screen name="EventDetail" component={EventDetail} />
      <MeetupsStack.Screen name="CreateWizard" component={CreateWizard} />
      <MeetupsStack.Screen name="JoinMeetup" component={JoinMeetup} />
      <MeetupsStack.Screen name="Account" component={Account} />
    </MeetupsStack.Navigator>
  );
}

const GroupsStack = createNativeStackNavigator<GroupsStackParams>();
function GroupsStackScreen() {
  return (
    <GroupsStack.Navigator screenOptions={stackHeader}>
      <GroupsStack.Screen name="GroupsList" component={GroupsList} />
      <GroupsStack.Screen name="GroupDetail" component={GroupDetail} />
      <GroupsStack.Screen name="CreateGroup" component={CreateGroup} />
      <GroupsStack.Screen name="JoinGroup" component={JoinGroup} />
      <GroupsStack.Screen name="Account" component={Account} />
    </GroupsStack.Navigator>
  );
}

// A split tab bar: the bar is halved down the middle by an ink seam, each half a full-bleed colour
// block (the active half brand pink, the inactive a soft lavender). Both labels use the SAME big
// uppercase display face; only the colour changes (white when active, muted when not). No pills.
function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomGap = Math.max(Math.round(insets.bottom * 0.75), 12);
  return (
    <View style={{ flexDirection: "row", borderTopWidth: ui.border, borderTopColor: ui.ink }}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const label = descriptors[route.key].options.title ?? route.name;
        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={{
              flex: 1,
              alignItems: "center",
              paddingTop: 14,
              paddingBottom: bottomGap,
              backgroundColor: focused ? ui.brand : ui.tint,
              borderLeftWidth: i === 0 ? 0 : ui.border,
              borderLeftColor: ui.ink,
            }}
          >
            <Text
              style={{
                fontFamily: font.black,
                fontSize: 15,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: focused ? ui.onInk : ui.muted,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const Tab = createBottomTabNavigator();
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Meetups" component={MeetupsStackScreen} options={{ title: "My meetups" }} />
      <Tab.Screen name="Groups" component={GroupsStackScreen} options={{ title: "My groups" }} />
    </Tab.Navigator>
  );
}

// Auth gate. useAuthBridge keeps the tRPC header holder in sync and tells us whether to show
// the app or the sign-in screen.
function Gate() {
  const authed = useAuthBridge();
  // The meetup token of the link the app was opened with (web reads it synchronously), so a
  // logged-out /m/<token> visit shows the public preview on the first paint instead of bare sign-in.
  const launchMeetup = useMeetupLaunchToken();

  // Route a deep-link invite code across the sign-in boundary (the hook captures it while signed out
  // and resumes it once authed). navigate is the only App-coupled step - it routes to JoinGroup once
  // the navigator is ready, returning false until then so the hook keeps polling. useCallback-stable
  // so the hook's resume effect re-runs only on an auth change, as before.
  const navigate = useCallback((code: string) => {
    if (!navigationRef.isReady()) return false;
    navigationRef.navigate("Groups", { screen: "JoinGroup", params: { code } });
    return true;
  }, []);
  // The meetup sibling: resume joins the plan's group (to learn the eventId) then lands on the plan.
  const navigateMeetup = useCallback((eventId: string) => {
    if (!navigationRef.isReady()) return false;
    navigationRef.navigate("Meetups", { screen: "EventDetail", params: { eventId } });
    return true;
  }, []);
  usePendingMeetupRouting(authed, navigateMeetup);
  usePendingInviteRouting(authed, navigate);

  // Logged-out: a meetup link shows its public preview before sign-in (the conversion funnel); any
  // other entry shows the sign-in screen. Once authed the navigator (and the resume hooks) take over.
  const loggedOut = launchMeetup ? <MeetupWelcome token={launchMeetup} /> : <SignIn />;

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      {authed ? <MainTabs /> : loggedOut}
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

// On web, constrain to a centered phone-width column so desktop looks intentional. The pink gutters
// either side are filled with a decorative WebBackdrop; the column itself is opaque (every screen
// paints a gradient), so the backdrop only ever shows through the gutters.
function Shell({ children }: { children: ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: "center", backgroundColor: ui.brand }}>
      <WebBackdrop />
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: webColumnMaxWidth,
          borderLeftWidth: 4,
          borderRightWidth: 4,
          borderColor: ui.ink,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_800ExtraBold,
    Archivo_900Black,
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: ui.gradient[0] }} />;
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <DevAuthProvider>
        <SafeAreaProvider>
          <Shell>
            <Gate />
          </Shell>
        </SafeAreaProvider>
      </DevAuthProvider>
    </ClerkProvider>
  );
}
