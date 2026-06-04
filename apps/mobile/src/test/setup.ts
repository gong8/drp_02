// Jest setup, loaded via setupFilesAfterEnv (see package.json "jest" config). Runs after the
// jest-expo preset (which already mocks most expo-* native modules). @testing-library/react-native
// v13 auto-extends expect with its matchers (toBeOnTheScreen, toHaveTextContent, ...), so no
// extend-expect import is needed here.
//
// We stub the two third-party native boundaries that the preset does NOT cover and that would
// otherwise crash a screen render: Clerk (auth) and our notifications wrapper. Tests that care
// about auth/notification behavior override these per-file with their own jest.mock.

// Clerk: a minimal signed-out stub. ClerkProvider passes children through; the auth hooks return
// a stable signed-out shape. (Our screens read identity through src/lib/auth's DevAuthProvider,
// so most never touch these directly - this just keeps ClerkProvider from reaching the network.)
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

// Notifications: our wrapper (src/lib/notifications) is best-effort and irrelevant to UI assertions.
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
}));
