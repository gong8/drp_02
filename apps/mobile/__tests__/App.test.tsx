// App smoke test. Replaces the old `expect(true).toBe(true)` tautology with a REAL startup test:
// render the whole <App/> tree (ClerkProvider -> DevAuthProvider -> SafeAreaProvider -> Shell ->
// Gate -> NavigationContainer) and assert it mounts without throwing and shows the signed-out
// entry UI. This is the cheapest guard against the most likely silent mobile break: a provider /
// import / font-load / navigation startup crash that no per-screen test would catch.
//
// Assertions come from the SPEC + the real SignIn copy (src/screens/SignIn.tsx), not from running
// the code. The app starts SIGNED OUT (Clerk is stubbed signed-out in src/test/setup.ts and no dev
// user is set), so the spec says Gate renders <SignIn/>, whose copy is fixed product text.

jest.mock("../src/lib/trpc");

// useFonts must resolve to [true] or App returns its bare loading View forever and never mounts the
// providers. jest-expo does not guarantee a loaded font in this preset, so we pin it. A mutable flag
// lets the loading-placeholder case flip it without jest.resetModules (which would corrupt React's
// shared module identity for the rest of the suite).
// Named with the `mock` prefix so jest's factory-hoisting allows referencing it (the factory is
// hoisted above the import, but `mock`-prefixed vars are exempt from the out-of-scope guard).
let mockFontsLoaded = true;
jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: () => [mockFontsLoaded, null],
  isLoaded: () => mockFontsLoaded,
}));

// App renders its OWN SafeAreaProvider with no initialMetrics, so under the test renderer the
// async safe-area measure never resolves and inset-reading children (ScreenBackground -> SignIn)
// would never paint. Stub the module to a pass-through provider with fixed insets so the real tree
// renders synchronously. This is a test-only native-boundary stub (like the Clerk/notifications
// stubs in setup.ts); the app code under test is untouched.
jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const insets = { top: 47, left: 0, right: 0, bottom: 34 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaConsumer: ({ children }: { children: (i: typeof insets) => React.ReactNode }) =>
      children(insets),
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
  };
});

// setup.ts stubs Clerk signed-out but does NOT export useSSO, which SignIn calls on mount. Without
// it the SignIn render throws ("useSSO is not a function"), so we extend the stub here. This mirrors
// the signed-out shape; the app must still resolve to the SignIn screen.
jest.mock("@clerk/clerk-expo", () => {
  const React = require("react");
  return {
    ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuth: () => ({ isSignedIn: false, isLoaded: true, getToken: async () => null }),
    useUser: () => ({ isSignedIn: false, isLoaded: true, user: null }),
    useSignIn: () => ({ isLoaded: true, signIn: { create: jest.fn() } }),
    useOAuth: () => ({ startOAuthFlow: jest.fn() }),
    useSSO: () => ({ startSSOFlow: jest.fn() }),
  };
});

import { render } from "@testing-library/react-native";
import App from "../App";
import { resetTrpcMock } from "../src/lib/__mocks__/trpc";
import { fireEvent, renderWithProviders, screen } from "../src/test/render";
import { AppText, Button } from "../src/ui";

beforeEach(() => {
  resetTrpcMock();
  mockFontsLoaded = true;
});

describe("App startup", () => {
  test("renders the full app tree without throwing", () => {
    // App supplies its own providers (Clerk/DevAuth/SafeArea/NavigationContainer), so it renders
    // with the bare RNTL render - NOT renderWithProviders, which would nest a second
    // NavigationContainer. The bare mount itself exercises every top-level provider and import; a
    // startup crash (bad provider nesting, a missing native stub, a broken import) surfaces here.
    expect(() => render(<App />)).not.toThrow();
  });

  test("shows the signed-out entry screen (SignIn) on a cold start", async () => {
    // Spec: signed out -> Gate renders <SignIn/>. SignIn's product copy is the proof we reached it,
    // not the loading View and not the authed tab navigator.
    render(<App />);

    expect(await screen.findByText("BeThere")).toBeOnTheScreen();
    expect(screen.getByText("Plan real meetups with your groups.")).toBeOnTheScreen();
  });

  test("offers the Google sign-in action when signed out", async () => {
    // The primary entry action. Its presence confirms the SignIn button row mounted (not just the
    // headline), and that the app did not skip straight to the authed UI.
    render(<App />);

    expect(await screen.findByText("Continue with Google")).toBeOnTheScreen();
  });

  test("does NOT show the authed tab navigator when signed out", async () => {
    // Spec: the Meetups/Groups tabs only render behind the auth gate. A signed-out start must not
    // leak them; a flipped gate condition (showing MainTabs while unauthenticated) would fail here.
    render(<App />);

    await screen.findByText("BeThere");
    expect(screen.queryByText("Meetups")).not.toBeOnTheScreen();
    expect(screen.queryByText("Groups")).not.toBeOnTheScreen();
  });

  test("stays on the loading placeholder until fonts finish loading", () => {
    // Spec (App.tsx): while fonts are loading the app renders a bare placeholder View and NOT the
    // sign-in UI. Flip the shared font flag (no module reset, which would corrupt React's identity
    // for the rest of the suite) so useFonts reports not-yet-loaded for this case only.
    mockFontsLoaded = false;
    render(<App />);

    // No SignIn copy while fonts are pending.
    expect(screen.queryByText("BeThere")).not.toBeOnTheScreen();
    expect(screen.queryByText("Continue with Google")).not.toBeOnTheScreen();
  });
});

// One leaf ui/ smoke check, so a broken shared primitive (which every screen depends on) fails fast
// here rather than only deep inside a screen test.
describe("ui primitives render", () => {
  test("AppText renders its children", () => {
    renderWithProviders(<AppText>Hello there</AppText>);
    expect(screen.getByText("Hello there")).toBeOnTheScreen();
  });

  test("Button renders its label and fires onPress", () => {
    const onPress = jest.fn();
    renderWithProviders(<Button label="Tap me" onPress={onPress} />);

    const label = screen.getByText("Tap me");
    expect(label).toBeOnTheScreen();
    fireEvent.press(label);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a disabled Button does not fire onPress", () => {
    const onPress = jest.fn();
    renderWithProviders(<Button label="Locked" onPress={onPress} disabled />);

    fireEvent.press(screen.getByText("Locked"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
