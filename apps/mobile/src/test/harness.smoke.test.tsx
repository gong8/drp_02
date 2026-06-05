// Mobile harness self-test: proves @testing-library/react-native + jest-expo render, the matchers
// are extended, the tRPC manual mock drives a real screen, and jest exits (--forceExit). If this
// fails, no screen test can be trusted - start here.

jest.mock("../lib/trpc");

import { Text } from "react-native";
import { mockQuery, resetTrpcMock } from "../lib/__mocks__/trpc";
import { trpc } from "../lib/trpc";
import { Dashboard } from "../screens/Dashboard";
import { renderScreen, renderWithProviders } from "./render";

beforeEach(resetTrpcMock);

test("renders a leaf element and the matchers are extended", () => {
  const { getByText } = renderWithProviders(<Text>hello harness</Text>);
  expect(getByText("hello harness")).toBeOnTheScreen();
});

test("renders the Dashboard screen off mocked tRPC data (empty -> no groups state)", async () => {
  mockQuery(trpc.events.mine, []);
  mockQuery(trpc.groups.mine, []);

  const { findByText } = renderScreen(Dashboard);

  // With no groups the dashboard shows the onboarding card after its queries resolve.
  expect(await findByText("No groups yet")).toBeOnTheScreen();
});
