import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_TITLE } from "./create-plan.js";
import {
  MAX_CLONE_ACTIVITIES,
  PAST_MEETUPS_LIMIT,
  type PastMeetupInput,
  shapePastMeetups,
} from "./past-meetups.js";

function row(over: Partial<PastMeetupInput> = {}): PastMeetupInput {
  return {
    id: "e1",
    title: "Bowling",
    location: "TenPin",
    description: null,
    startsAt: new Date("2026-05-01T18:00:00.000Z"),
    lockTimes: false,
    lockThings: false,
    activityLabels: [],
    ...over,
  };
}

test("maps a cleared row into a clonable shell", () => {
  const out = shapePastMeetups([
    row({ activityLabels: ["bowling", "the pub"], lockThings: true, description: "come at 6" }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: "e1",
    title: "Bowling",
    location: "TenPin",
    description: "come at 6",
    activityCandidates: ["bowling", "the pub"],
    lockTimes: false,
    lockThings: true,
    lastStartsAt: "2026-05-01T18:00:00.000Z",
  });
});

test("orders most-recent-first by startsAt", () => {
  const out = shapePastMeetups([
    row({ id: "old", startsAt: new Date("2026-01-01T00:00:00.000Z") }),
    row({ id: "new", startsAt: new Date("2026-03-01T00:00:00.000Z") }),
    row({ id: "mid", startsAt: new Date("2026-02-01T00:00:00.000Z") }),
  ]);
  assert.deepEqual(
    out.map((m) => m.id),
    ["new", "mid", "old"],
  );
});

test("caps the list at PAST_MEETUPS_LIMIT, keeping the most recent", () => {
  const many = Array.from({ length: PAST_MEETUPS_LIMIT + 5 }, (_, i) =>
    row({ id: `e${i}`, startsAt: new Date(2026, 0, i + 1) }),
  );
  const out = shapePastMeetups(many);
  assert.equal(out.length, PAST_MEETUPS_LIMIT);
  assert.equal(out[0].id, `e${PAST_MEETUPS_LIMIT + 4}`);
});

test("falls back to the placeholder title when the stored title is empty", () => {
  const out = shapePastMeetups([row({ title: "   " })]);
  assert.equal(out[0].title, FALLBACK_TITLE);
});

test("caps a meetup's cloned activities at MAX_CLONE_ACTIVITIES", () => {
  const labels = Array.from({ length: MAX_CLONE_ACTIVITIES + 3 }, (_, i) => `act${i}`);
  const out = shapePastMeetups([row({ activityLabels: labels })]);
  assert.equal(out[0].activityCandidates.length, MAX_CLONE_ACTIVITIES);
  assert.deepEqual(out[0].activityCandidates, labels.slice(0, MAX_CLONE_ACTIVITIES));
});
