// Regression test for the DateTimeField date-mode bound clamp. The native picker rejects values
// outside its minimumDate/maximumDate, but dismissing it without scrolling commits the SEEDED
// default verbatim (see DateTimeField.tsx BottomSheet onClose -> commit(temp)). Before the fix the
// seed fell back to raw "now" and ignored the bounds, so a minimumDate in the future committed
// "today" - an out-of-range date the server then rejected. clampDate is the pure helper that pulls
// any seed inside [min, max]; these assertions derive from that contract, not from running a picker.

// Stub the native picker boundary so importing DateTimeField (for its pure clampDate export) never
// reaches the real native module under jest - mirrors how the screen tests stub native surfaces.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

import { clampDate, safeMaxDate } from "./DateTimeField";

// Numeric Date constructor -> always local wall-clock in every engine, so these instants are
// zone-independent (same strategy as lib/__tests__/format.test.ts).
const at = (y: number, mo: number, d: number) => new Date(y, mo - 1, d, 12, 0, 0, 0);

describe("clampDate", () => {
  test("returns the value unchanged when within bounds", () => {
    const v = at(2026, 6, 15);
    const out = clampDate(v, at(2026, 6, 1), at(2026, 6, 30));
    expect(out.getTime()).toBe(v.getTime());
  });

  test("pulls a below-minimum value up to the minimum (the dismiss-commit bug)", () => {
    // "now" (today) seeded while minimumDate is in the future: must snap to the minimum, not commit
    // an out-of-range earlier date.
    const now = at(2026, 6, 5);
    const min = at(2026, 6, 10);
    const out = clampDate(now, min, undefined);
    expect(out.getTime()).toBe(min.getTime());
  });

  test("pulls an above-maximum value down to the maximum", () => {
    const v = at(2026, 6, 20);
    const max = at(2026, 6, 10);
    const out = clampDate(v, undefined, max);
    expect(out.getTime()).toBe(max.getTime());
  });

  test("is a no-op when no bounds are given", () => {
    const v = at(2026, 6, 15);
    const out = clampDate(v);
    expect(out.getTime()).toBe(v.getTime());
  });

  test("clamps to the minimum when both bounds are above the value", () => {
    const v = at(2026, 6, 1);
    const out = clampDate(v, at(2026, 6, 5), at(2026, 6, 20));
    expect(out.getTime()).toBe(at(2026, 6, 5).getTime());
  });
});

// Defense in depth behind callers (e.g. AddTime): a max BEFORE the min is inverted bounds, and feeding
// minimumDate > maximumDate to the native date picker throws a native exception that hard-crashes the
// app. safeMaxDate drops such a max so the picker only ever sees a valid (or absent) upper bound.
describe("safeMaxDate", () => {
  test("drops an inverted max so the picker never sees min > max", () => {
    expect(safeMaxDate(at(2026, 6, 10), at(2026, 6, 5))).toBeUndefined();
  });

  test("keeps a valid max that sits after the min", () => {
    const max = at(2026, 6, 20);
    expect(safeMaxDate(at(2026, 6, 5), max)?.getTime()).toBe(max.getTime());
  });

  test("keeps the max when there is no min to compare against", () => {
    const max = at(2026, 6, 20);
    expect(safeMaxDate(undefined, max)?.getTime()).toBe(max.getTime());
  });

  test("is undefined when no max is given", () => {
    expect(safeMaxDate(at(2026, 6, 5), undefined)).toBeUndefined();
  });
});
