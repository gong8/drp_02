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
      activity: "T",
      contingent: true,
      quorum: 2,
      phase: "collecting",
      candidates: [{ suffix: "c1", kind: "time", startsAt: new Date(), reactedBy: ["u_b"] }],
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
      activity: "T",
      contingent: false,
      quorum: 1,
      phase: "cleared",
      candidates: [{ suffix: "c1", kind: "time", startsAt: new Date() }],
      chosenSuffix: "c9",
    },
  ];
  const errs = seedIntegrityErrors(users, groups, plans);
  assert.ok(
    errs.some((e) => e.includes("chosenSuffix")),
    `expected a chosenSuffix error, got ${JSON.stringify(errs)}`,
  );
});

test("flags a collecting plan with no time candidate", () => {
  const users = [{ id: "u_a" }];
  const groups = [{ id: "g1", members: ["u_a"] }];
  const plans: Plan[] = [
    {
      id: "p1",
      groupId: "g1",
      createdBy: "u_a",
      activity: "",
      contingent: true,
      quorum: 1,
      phase: "collecting",
      candidates: [{ suffix: "a1", kind: "activity", label: "bowling", reactedBy: ["u_a"] }],
    },
  ];
  const errs = seedIntegrityErrors(users, groups, plans);
  assert.ok(
    errs.some((e) => e.includes("at least one time candidate")),
    `expected a time-candidate error, got ${JSON.stringify(errs)}`,
  );
});
