import assert from "node:assert/strict";
import { test } from "node:test";
import { displayTitle, FALLBACK_TITLE, planOpensMoment, resolveTitle } from "./create-plan.js";

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

test("resolveTitle keeps a non-empty title and ignores activities", () => {
  assert.equal(
    resolveTitle("Dinner", [{ id: "a1", label: "Pizza" }], [{ candidateId: "a1", userId: "u1" }]),
    "Dinner",
  );
});

test("resolveTitle picks the most-voted activity when title is empty", () => {
  const acts = [
    { id: "a1", label: "Pizza" },
    { id: "a2", label: "Sushi" },
  ];
  const reactions = [
    { candidateId: "a1", userId: "u1" },
    { candidateId: "a2", userId: "u1" },
    { candidateId: "a2", userId: "u2" },
  ];
  assert.equal(resolveTitle("", acts, reactions), "Sushi");
});

test("resolveTitle falls back to empty when there are no activities", () => {
  assert.equal(resolveTitle("", [], []), "");
});

test("displayTitle shows the leading activity when the title is empty", () => {
  const acts = [
    { id: "a1", label: "Pizza" },
    { id: "a2", label: "Sushi" },
  ];
  const reactions = [
    { candidateId: "a2", userId: "u1" },
    { candidateId: "a2", userId: "u2" },
    { candidateId: "a1", userId: "u1" },
  ];
  assert.equal(displayTitle("", acts, reactions), "Sushi");
});

test("displayTitle falls back to the placeholder with no title and no activities", () => {
  assert.equal(displayTitle("", [], []), FALLBACK_TITLE);
});

test("displayTitle keeps a real title as-is", () => {
  assert.equal(displayTitle("Bowling", [{ id: "a1", label: "Pizza" }], []), "Bowling");
});
