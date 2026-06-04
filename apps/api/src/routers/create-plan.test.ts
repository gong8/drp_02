import assert from "node:assert/strict";
import { test } from "node:test";
import { displayTitle, FALLBACK_TITLE, planOpensMoment, resolveTitle } from "./create-plan.js";

test("one time candidate with lockTimes opens the moment (concrete shortcut)", () => {
  assert.equal(planOpensMoment(1, true), true);
});

test("one time candidate without lockTimes still collects", () => {
  assert.equal(planOpensMoment(1, false), false);
});

test("multiple time candidates never short-cut, even when locked", () => {
  assert.equal(planOpensMoment(3, true), false);
});

test("zero time candidates never short-cut", () => {
  assert.equal(planOpensMoment(0, true), false);
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
