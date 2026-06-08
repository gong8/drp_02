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
import { type ReactNode, useEffect } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { DevAuthProvider, useAuthBridge } from "./src/lib/auth";
import { publishableKey, tokenCache } from "./src/lib/clerk";
import {
  clearPendingInvite,
  extractInviteCode,
  getPendingInvite,
  setPendingInvite,
} from "./src/lib/invite";
import { Account } from "./src/screens/Account";
import { CreateGroup } from "./src/screens/CreateGroup";
import { CreateWizard } from "./src/screens/CreateWizard";
import { Dashboard } from "./src/screens/Dashboard";
import { EventDetail } from "./src/screens/EventDetail";
import { GroupDetail } from "./src/screens/GroupDetail";
import { GroupsList } from "./src/screens/GroupsList";
import { JoinGroup } from "./src/screens/JoinGroup";
import { SignIn } from "./src/screens/SignIn";
import { font, ui } from "./src/theme";

// Account is reachable from either tab (via the top-right avatar), so it is registered in both stacks
// and gets a real back button - there is no Account tab anymore.
export type MeetupsStackParams = {
  Dashboard: undefined;
  EventDetail: { eventId: string };
  CreateWizard: undefined;
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

  // While signed out, stash an invite code from the launch URL / any incoming link, so it survives
  // sign-in. This runs during every signed-out window - including the brief one before an async Clerk
  // session resolves - so the code is captured even when the navigator was not yet mounted to route
  // it. When already authed the linking config routes invite URLs directly, so we skip stashing (and
  // a stale code never lingers). The web stash lives in localStorage (see lib/invite), so it survives
  // the OAuth redirect's page reload; native keeps it in memory, which the app's lifetime preserves.
  useEffect(() => {
    if (authed) return;
    let active = true;
    Linking.getInitialURL().then((url) => {
      const code = url ? extractInviteCode(url) : null;
      if (active && code) setPendingInvite(code);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      const code = extractInviteCode(url);
      if (code) setPendingInvite(code);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [authed]);

  // Once authed, resume a STASHED invite (the signed-out capture above): route to JoinGroup, then
  // clear it. We rely only on the stash - an already-authed user opening /join/code is routed by the
  // linking config (the navigator is mounted), so the two never both fire. Clearing only after the
  // navigate lands means a torn-down poll cannot drop the code, and go() bails if the effect is gone.
  useEffect(() => {
    if (!authed) return;
    const code = getPendingInvite();
    if (!code) return;
    let active = true;
    const go = () => {
      if (!active) return;
      if (navigationRef.isReady()) {
        navigationRef.navigate("Groups", { screen: "JoinGroup", params: { code } });
        clearPendingInvite();
      } else {
        setTimeout(go, 50);
      }
    };
    go();
    return () => {
      active = false;
    };
  }, [authed]);

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      {authed ? <MainTabs /> : <SignIn />}
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

// On web, constrain to a centered phone-width column so desktop looks intentional.
function Shell({ children }: { children: ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: "center", backgroundColor: ui.ink }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 480 }}>{children}</View>
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
