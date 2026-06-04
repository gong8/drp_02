import assert from "node:assert/strict";
import { test } from "node:test";
import { planOpensMoment } from "./create-plan.js";

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
