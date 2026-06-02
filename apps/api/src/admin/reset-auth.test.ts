import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuthorizedReset } from "./reset-auth.js";

test("disabled when no token is configured", () => {
  assert.equal(isAuthorizedReset("anything", undefined), false);
  assert.equal(isAuthorizedReset("anything", ""), false);
});

test("rejects a missing or wrong token", () => {
  assert.equal(isAuthorizedReset(undefined, "secret"), false);
  assert.equal(isAuthorizedReset("secres", "secret"), false); // same length, wrong value
  assert.equal(isAuthorizedReset("no", "secret"), false); // different length
});

test("accepts the exact token", () => {
  assert.equal(isAuthorizedReset("secret", "secret"), true);
});
