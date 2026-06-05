import assert from "node:assert/strict";
import { test } from "node:test";
import { displayActivity, planOpensMoment, resolveActivity } from "./create-plan.js";

test("both axes pinned (1 locked time, <=1 locked activity) opens the moment", () => {
  assert.equal(planOpensMoment(1, true, 0, true), true);
  assert.equal(planOpensMoment(1, true, 1, true), true);
});

test("times not locked still collects, even with one time", () => {
  assert.equal(planOpensMoment(1, false, 0, true), false);
});

test("activities not locked still collects (the group can add an activity)", () => {
  assert.equal(planOpensMoment(1, true, 0, false), false);
  assert.equal(planOpensMoment(1, true, 1, false), false);
});

test("two-plus activities force a vote even when both axes are locked", () => {
  assert.equal(planOpensMoment(1, true, 2, true), false);
});

test("multiple or zero time candidates never short-cut", () => {
  assert.equal(planOpensMoment(3, true, 0, true), false);
  assert.equal(planOpensMoment(0, true, 0, true), false);
});

test("resolveActivity keeps a non-empty activity and ignores candidates", () => {
  assert.equal(
    resolveActivity(
      "Dinner",
      [{ id: "a1", label: "Pizza" }],
      [{ candidateId: "a1", userId: "u1" }],
    ),
    "Dinner",
  );
});

test("resolveActivity picks the most-voted activity when empty", () => {
  const acts = [
    { id: "a1", label: "Pizza" },
    { id: "a2", label: "Sushi" },
  ];
  const reactions = [
    { candidateId: "a1", userId: "u1" },
    { candidateId: "a2", userId: "u1" },
    { candidateId: "a2", userId: "u2" },
  ];
  assert.equal(resolveActivity("", acts, reactions), "Sushi");
});

test("resolveActivity falls back to empty when there are no activities", () => {
  assert.equal(resolveActivity("", [], []), "");
});

test("displayActivity shows the leading activity when empty", () => {
  const acts = [
    { id: "a1", label: "Pizza" },
    { id: "a2", label: "Sushi" },
  ];
  const reactions = [
    { candidateId: "a2", userId: "u1" },
    { candidateId: "a2", userId: "u2" },
    { candidateId: "a1", userId: "u1" },
  ];
  assert.equal(displayActivity("", acts, reactions), "Sushi");
});

test("displayActivity is empty with no activity and no candidates (client falls back to the group)", () => {
  assert.equal(displayActivity("", [], []), "");
});

test("displayActivity keeps a real activity as-is", () => {
  assert.equal(displayActivity("Bowling", [{ id: "a1", label: "Pizza" }], []), "Bowling");
});
