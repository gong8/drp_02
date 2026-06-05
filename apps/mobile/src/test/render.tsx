// Mobile test render harness. Wraps UI in the providers screens depend on (SafeAreaProvider for
// insets, a real NavigationContainer + stack so useNavigation/route work and a screen receives its
// { navigation, route } props), then returns @testing-library/react-native's render result.
//
// Pair with the tRPC manual mock for screen tests:
//
//   jest.mock("../../lib/trpc");
//   import { Dashboard } from "../Dashboard";
//   import { trpc } from "../../lib/trpc";
//   import { mockQuery, resetTrpcMock } from "../../lib/__mocks__/trpc";
//
//   beforeEach(resetTrpcMock);
//   test("shows action-required plans first", async () => {
//     mockQuery(trpc.events.mine, [ ...plans ]);
//     mockQuery(trpc.groups.mine, []);
//     const { findByText } = renderScreen(Dashboard);
//     expect(await findByText("Bowling")).toBeOnTheScreen();
//   });

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { render } from "@testing-library/react-native";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Fixed safe-area metrics so insets resolve synchronously (no async measure in tests).
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <NavigationContainer>{children}</NavigationContainer>
    </SafeAreaProvider>
  );
}

// Render a bare element inside the providers (no navigator). Use for leaf ui/ components, or
// components you pass a mock `navigation` prop to directly.
export function renderWithProviders(ui: ReactElement) {
  return render(<Providers>{ui}</Providers>);
}

const Stack = createNativeStackNavigator();

// Render a screen inside a real one-screen stack navigator, so useNavigation/useRoute resolve and
// the screen receives { navigation, route } props. `params` becomes route.params (e.g. { eventId }).
// Generic over the screen's own props so any typed screen is accepted; the navigator supplies
// navigation/route at runtime, so the param-list typing is erased for the registration.
export function renderScreen<P extends object>(Component: ComponentType<P>, params?: object) {
  const Screen = Component as unknown as ComponentType;
  return renderWithProviders(
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Target" component={Screen} initialParams={params} />
    </Stack.Navigator>,
  );
}

export { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
