// Regression tests for the useDisplayName precedence chain. The bug: using `??` kept an
// empty-string firstName ("") instead of falling through to username/fallback, yielding a blank
// name and a blank avatar initial. The fix trims and uses `||` so empty/whitespace values fall
// through. We override the global Clerk mock per-test to control the user shape, and wrap the
// hook in the real DevAuthProvider so the dev-bypass branch is exercised honestly.

import { useUser } from "@clerk/clerk-expo";
import { act, renderHook } from "@testing-library/react-native";
import { createElement } from "react";
import { DEV_DISPLAY_NAME, DevAuthProvider, useDevAuth, useDisplayName } from "./auth";

jest.mock("@clerk/clerk-expo", () => ({
  useUser: jest.fn(() => ({ user: null })),
}));

const mockedUseUser = useUser as jest.Mock;

function setUser(user: { firstName?: string | null; username?: string | null } | null) {
  mockedUseUser.mockReturnValue({ user });
}

const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(DevAuthProvider, null, children);

beforeEach(() => setUser(null));

test("useDisplayName: prefers firstName when present", () => {
  setUser({ firstName: "Ada", username: "ada99" });
  const { result } = renderHook(() => useDisplayName("Account"), { wrapper });
  expect(result.current).toBe("Ada");
});

test("useDisplayName: empty-string firstName falls through to username", () => {
  setUser({ firstName: "", username: "ada99" });
  const { result } = renderHook(() => useDisplayName("Account"), { wrapper });
  expect(result.current).toBe("ada99");
});

test("useDisplayName: whitespace-only firstName falls through to username", () => {
  setUser({ firstName: "   ", username: "ada99" });
  const { result } = renderHook(() => useDisplayName("Account"), { wrapper });
  expect(result.current).toBe("ada99");
});

test("useDisplayName: empty firstName and empty username fall through to fallback", () => {
  setUser({ firstName: "", username: "" });
  const { result } = renderHook(() => useDisplayName("Account"), { wrapper });
  expect(result.current).toBe("Account");
});

test("useDisplayName: no user falls through to fallback", () => {
  setUser(null);
  const { result } = renderHook(() => useDisplayName("?"), { wrapper });
  expect(result.current).toBe("?");
});

test("useDisplayName: dev-bypass user overrides the Clerk identity", () => {
  setUser({ firstName: "Ada", username: "ada99" });
  const { result } = renderHook(
    () => {
      const { signInDev } = useDevAuth();
      const name = useDisplayName("Account");
      return { signInDev, name };
    },
    { wrapper },
  );
  // Before sign-in the Clerk identity wins.
  expect(result.current.name).toBe("Ada");
  // Once the dev-bypass user is active, the dev display name always wins.
  act(() => result.current.signInDev());
  expect(result.current.name).toBe(DEV_DISPLAY_NAME);
});
