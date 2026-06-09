import assert from "node:assert/strict";
import { test } from "node:test";
import { activityKey, normalizeCreateCandidates, startMinute } from "./create-candidates.js";

// A fixed "now" so the past/future boundary is deterministic.
const NOW = Date.parse("2026-06-09T12:00:00.000Z");

test("collapses same-minute time candidates, keeping the earliest", () => {
  const { timeCands } = normalizeCreateCandidates(
    "e1",
    [{ startsAt: "2026-06-10T18:00:30.000Z" }, { startsAt: "2026-06-10T18:00:00.000Z" }],
    [],
    NOW,
  );
  assert.equal(timeCands.length, 1);
  assert.equal(timeCands[0].startsAt.toISOString(), "2026-06-10T18:00:00.000Z");
});

test("time-candidate ids index by ORIGINAL input order, not sorted order", () => {
  const { timeCands } = normalizeCreateCandidates(
    "e1",
    [{ startsAt: "2026-06-11T18:00:00.000Z" }, { startsAt: "2026-06-10T18:00:00.000Z" }],
    [],
    NOW,
  );
  // Sorted earliest-first, but each id reflects where the slot sat in the input array.
  assert.deepEqual(
    timeCands.map((c) => c.id),
    ["e1_t2", "e1_t1"],
  );
  assert.equal(timeCands[0].startsAt.toISOString(), "2026-06-10T18:00:00.000Z");
});

test("rejects a time candidate in the past", () => {
  assert.throws(
    () => normalizeCreateCandidates("e1", [{ startsAt: "2026-06-08T18:00:00.000Z" }], [], NOW),
    /a time candidate must be in the future/,
  );
});

test("drops invalid date strings before the past-time check", () => {
  const { timeCands } = normalizeCreateCandidates(
    "e1",
    [{ startsAt: "not-a-date" }, { startsAt: "2026-06-10T18:00:00.000Z" }],
    [],
    NOW,
  );
  assert.equal(timeCands.length, 1);
  assert.equal(timeCands[0].id, "e1_t2");
});

test("trims activities, drops empty, dedupes case-insensitively keeping the first", () => {
  const { activityCands } = normalizeCreateCandidates(
    "e1",
    [],
    ["  Bowling  ", "   ", "bowling", "Pub"],
    NOW,
  );
  assert.deepEqual(
    activityCands.map((c) => ({ id: c.id, label: c.label })),
    [
      { id: "e1_a1", label: "Bowling" },
      { id: "e1_a2", label: "Pub" },
    ],
  );
});

test("startMinute buckets to the minute; activityKey trims and lowercases", () => {
  assert.equal(
    startMinute(new Date("2026-06-10T18:00:59.000Z")),
    startMinute(new Date("2026-06-10T18:00:00.000Z")),
  );
  assert.notEqual(
    startMinute(new Date("2026-06-10T18:01:00.000Z")),
    startMinute(new Date("2026-06-10T18:00:00.000Z")),
  );
  assert.equal(activityKey("  BoWLing  "), "bowling");
});
