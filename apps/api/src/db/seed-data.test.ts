import assert from "node:assert/strict";
import { test } from "node:test";
import { type Plan, seedIntegrityErrors } from "./seed-data.js";

test("the committed demo seed is referentially sound", () => {
  assert.deepEqual(seedIntegrityErrors(), []);
});

test("flags a reaction by someone not in the group", () => {
  const users = [{ id: "u_a" }, { id: "u_b" }];
  const groups = [{ id: "g1", members: ["u_a"] }];
  const plans: Plan[] = [
    {
      id: "p1",
      groupId: "g1",
      createdBy: "u_a",
      title: "T",
      whenMode: "options",
      contingent: true,
      quorum: 2,
      phase: "collecting",
      candidates: [{ suffix: "c1", startsAt: new Date(), reactedBy: ["u_b"] }],
    },
  ];
  const errs = seedIntegrityErrors(users, groups, plans);
  assert.ok(
    errs.some((e) => e.includes("u_b")),
    `expected a u_b error, got ${JSON.stringify(errs)}`,
  );
});

test("flags a chosenSuffix that matches no candidate", () => {
  const users = [{ id: "u_a" }];
  const groups = [{ id: "g1", members: ["u_a"] }];
  const plans: Plan[] = [
    {
      id: "p1",
      groupId: "g1",
      createdBy: "u_a",
      title: "T",
      whenMode: "exact",
      contingent: false,
      quorum: 1,
      phase: "cleared",
      candidates: [{ suffix: "c1", startsAt: new Date() }],
      chosenSuffix: "c9",
    },
  ];
  const errs = seedIntegrityErrors(users, groups, plans);
  assert.ok(
    errs.some((e) => e.includes("chosenSuffix")),
    `expected a chosenSuffix error, got ${JSON.stringify(errs)}`,
  );
});
