import { ClerkProvider } from "@clerk/clerk-expo";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountButton } from "./src/components/AccountButton";
import { DevAuthProvider, useAuthBridge } from "./src/lib/auth";
import { publishableKey, tokenCache } from "./src/lib/clerk";
import { CreateEvent } from "./src/screens/CreateEvent";
import { CreateGroup } from "./src/screens/CreateGroup";
import { Dashboard } from "./src/screens/Dashboard";
import { EventDetail } from "./src/screens/EventDetail";
import { GroupDetail } from "./src/screens/GroupDetail";
import { GroupsList } from "./src/screens/GroupsList";
import { SignIn } from "./src/screens/SignIn";
import { colors } from "./src/theme";

export type MeetupsStackParams = {
  Dashboard: undefined;
  EventDetail: { eventId: string };
  CreateEvent: undefined;
};
export type GroupsStackParams = {
  GroupsList: undefined;
  GroupDetail: { groupId: string };
  CreateGroup: undefined;
};

const stackHeader = {
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTintColor: colors.ink,
  headerTitleStyle: { color: colors.ink },
  contentStyle: { backgroundColor: colors.bg },
  headerRight: () => <AccountButton />,
} as const;

const MeetupsStack = createNativeStackNavigator<MeetupsStackParams>();
function MeetupsStackScreen() {
  return (
    <MeetupsStack.Navigator screenOptions={stackHeader}>
      <MeetupsStack.Screen name="Dashboard" component={Dashboard} options={{ title: "Meetups" }} />
      <MeetupsStack.Screen name="EventDetail" component={EventDetail} options={{ title: "" }} />
      <MeetupsStack.Screen
        name="CreateEvent"
        component={CreateEvent}
        options={{ title: "Suggest a Meet" }}
      />
    </MeetupsStack.Navigator>
  );
}

const GroupsStack = createNativeStackNavigator<GroupsStackParams>();
function GroupsStackScreen() {
  return (
    <GroupsStack.Navigator screenOptions={stackHeader}>
      <GroupsStack.Screen
        name="GroupsList"
        component={GroupsList}
        options={{ title: "Your Groups" }}
      />
      <GroupsStack.Screen name="GroupDetail" component={GroupDetail} options={{ title: "" }} />
      <GroupsStack.Screen
        name="CreateGroup"
        component={CreateGroup}
        options={{ title: "New group" }}
      />
    </GroupsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentInk,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "600" },
        tabBarIconStyle: { display: "none" },
      }}
    >
      <Tab.Screen name="Meetups" component={MeetupsStackScreen} />
      <Tab.Screen name="Groups" component={GroupsStackScreen} />
    </Tab.Navigator>
  );
}

// Auth gate. useAuthBridge keeps the tRPC header holder in sync and tells us whether to
// show the app or the sign-in screen.
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
    <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.line }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 480, backgroundColor: colors.bg }}>
        {children}
      </View>
    </View>
  );
}

export default function App() {
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
