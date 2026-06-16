// Regression test for the "add a time" picker-bounds computation (PhaseViews.AddTime). The DATE half
// of the add-a-time pill is bounded to [now-or-decides-by, horizon]. When a collecting plan's whole
// candidate spread has already elapsed (e.g. the live demo's stale seed: June candidates viewed in
// mid-June), the horizon falls BEFORE now, so the naive bounds invert (min > max). Feeding an inverted
// minimumDate/maximumDate to @react-native-community/datetimepicker throws a native exception that JS
// cannot catch - it hard-crashes the app the moment the picker opens. addTimeWindow is the pure helper
// that (a) flags such a closed window so the composer can refuse to open a broken picker, and (b)
// guarantees maxMs >= minMs so the bounds can never invert.

// Stub the native picker so importing PhaseViews (for its pure addTimeWindow export) never reaches the
// real native module under jest - mirrors DateTimeField.clamp.test.ts.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

import { addTimeWindow } from "./PhaseViews";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("addTimeWindow", () => {
  test("an elapsed candidate window is reported closed and never inverts the bounds", () => {
    // The exact live-demo crash: u_dev's seeded `e_pub` plan, candidates June 3-5, viewed June 16.
    const now = Date.UTC(2026, 5, 16, 13, 0, 0);
    const w = addTimeWindow(
      ["2026-06-03T19:00:00.000Z", "2026-06-04T19:00:00.000Z", "2026-06-05T20:00:00.000Z"],
      null,
      now,
    );
    expect(w.closed).toBe(true);
    // The invariant that keeps the native picker alive: max is never below min.
    expect(w.maxMs).toBeGreaterThanOrEqual(w.minMs);
  });

  test("a live future window stays open with max strictly after min", () => {
    const now = Date.UTC(2026, 5, 16, 13, 0, 0);
    const w = addTimeWindow(["2026-06-20T18:00:00.000Z", "2026-06-22T18:00:00.000Z"], null, now);
    expect(w.closed).toBe(false);
    expect(w.maxMs).toBeGreaterThan(w.minMs);
  });

  test("no candidates yet falls back to an open 14-day window from now", () => {
    const now = Date.UTC(2026, 5, 16, 13, 0, 0);
    const w = addTimeWindow([], null, now);
    expect(w.closed).toBe(false);
    expect(w.minMs).toBe(now);
    expect(w.maxMs).toBe(now + 14 * DAY_MS);
  });
});
