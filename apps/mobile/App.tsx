import { ClerkProvider } from "@clerk/clerk-expo";
import { Archivo_800ExtraBold, Archivo_900Black } from "@expo-google-fonts/archivo";
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from "@expo-google-fonts/inter";
import { SpaceMono_700Bold } from "@expo-google-fonts/space-mono";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { DevAuthProvider, useAuthBridge } from "./src/lib/auth";
import { publishableKey, tokenCache } from "./src/lib/clerk";
import { Account } from "./src/screens/Account";
import { CreateGroup } from "./src/screens/CreateGroup";
import { CreateWizard } from "./src/screens/CreateWizard";
import { Dashboard } from "./src/screens/Dashboard";
import { EventDetail } from "./src/screens/EventDetail";
import { FloatBoard } from "./src/screens/FloatBoard";
import { GroupDetail } from "./src/screens/GroupDetail";
import { GroupsList } from "./src/screens/GroupsList";
import { NewDial } from "./src/screens/NewDial";
import { SignIn } from "./src/screens/SignIn";
import { font, ui } from "./src/theme";

export type MeetupsStackParams = {
  Dashboard: undefined;
  EventDetail: { eventId: string };
  NewDial: undefined;
  CreateWizard: { branch: "float" | "rough" | "set" };
  FloatBoard: { floatId: string };
};
export type GroupsStackParams = {
  GroupsList: undefined;
  GroupDetail: { groupId: string };
  CreateGroup: undefined;
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
      <MeetupsStack.Screen name="NewDial" component={NewDial} />
      <MeetupsStack.Screen name="CreateWizard" component={CreateWizard} />
      <MeetupsStack.Screen name="FloatBoard" component={FloatBoard} />
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
    </GroupsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
function MainTabs() {
  // We render labels only (no icons), so size the bar to a compact label row plus a small
  // bottom gap - otherwise RN centers the label in a tall default content area and stacks
  // the full home-indicator inset below it, leaving a big white "chin" under the tabs. We
  // only keep a fraction of the inset so the labels sit close to the bottom edge.
  const insets = useSafeAreaInsets();
  const bottomGap = Math.max(Math.round(insets.bottom * 0.75), 12);
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        tabBarActiveTintColor: ui.brand,
        tabBarInactiveTintColor: ui.muted,
        tabBarStyle: {
          backgroundColor: ui.surface,
          borderTopWidth: 2,
          borderTopColor: ui.ink,
          height: 40 + bottomGap,
          paddingTop: 8,
          paddingBottom: bottomGap,
        },
        tabBarItemStyle: { justifyContent: "center" },
        tabBarLabelStyle: { fontFamily: font.display, fontSize: 12 },
        tabBarIconStyle: { display: "none", height: 0, width: 0 },
      }}
    >
      <Tab.Screen name="Meetups" component={MeetupsStackScreen} />
      <Tab.Screen name="Groups" component={GroupsStackScreen} />
      <Tab.Screen name="Account" component={Account} />
    </Tab.Navigator>
  );
}

// Auth gate. useAuthBridge keeps the tRPC header holder in sync and tells us whether to show
// the app or the sign-in screen.
function Gate() {
  const authed = useAuthBridge();
  return (
    <NavigationContainer>
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
    SpaceMono_700Bold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: "#FCEFE8" }} />;
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
