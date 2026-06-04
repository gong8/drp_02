import { ClerkProvider } from "@clerk/clerk-expo";
import { Archivo_800ExtraBold, Archivo_900Black } from "@expo-google-fonts/archivo";
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from "@expo-google-fonts/inter";
import { type BottomTabBarProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { DevAuthProvider, useAuthBridge } from "./src/lib/auth";
import { publishableKey, tokenCache } from "./src/lib/clerk";
import { Account } from "./src/screens/Account";
import { CreateGroup } from "./src/screens/CreateGroup";
import { CreateWizard } from "./src/screens/CreateWizard";
import { Dashboard } from "./src/screens/Dashboard";
import { EventDetail } from "./src/screens/EventDetail";
import { GroupDetail } from "./src/screens/GroupDetail";
import { GroupsList } from "./src/screens/GroupsList";
import { SignIn } from "./src/screens/SignIn";
import { font, ui } from "./src/theme";
import { HardShadow } from "./src/ui";

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
  GroupDetail: { groupId: string };
  CreateGroup: undefined;
  Account: undefined;
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
      <GroupsStack.Screen name="Account" component={Account} />
    </GroupsStack.Navigator>
  );
}

// A neobrutalist tab bar: each tab is a bordered pill, the active one filled brand with a hard shadow
// so the selected tab has a clearly visible boundary (not just a coloured word).
function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomGap = Math.max(Math.round(insets.bottom * 0.75), 12);
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        gap: 10,
        backgroundColor: ui.surface,
        borderTopWidth: ui.border,
        borderTopColor: ui.ink,
        paddingTop: 10,
        paddingBottom: bottomGap,
      }}
    >
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
        const pill = (
          <Pressable
            onPress={onPress}
            style={{
              backgroundColor: focused ? ui.brand : ui.surface,
              borderWidth: ui.border,
              borderColor: ui.ink,
              borderRadius: ui.rPill,
              paddingVertical: 8,
              paddingHorizontal: 24,
            }}
          >
            <Text
              style={{
                fontFamily: font.display,
                fontSize: 13,
                color: focused ? ui.onInk : ui.muted,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
        return (
          <View key={route.key}>
            {focused ? (
              <HardShadow radius={ui.rPill} offset={ui.shadowInput}>
                {pill}
              </HardShadow>
            ) : (
              pill
            )}
          </View>
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
      <Tab.Screen name="Meetups" component={MeetupsStackScreen} options={{ title: "Meetups" }} />
      <Tab.Screen name="Groups" component={GroupsStackScreen} options={{ title: "Groups" }} />
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
