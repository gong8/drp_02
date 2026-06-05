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

test("same code-unit length but different byte length returns false without throwing", () => {
  // "é" (U+00E9) is one UTF-16 code unit but two UTF-8 bytes, while "e" is one of each.
  // String.length would treat these as equal length and let timingSafeEqual throw a
  // RangeError on the unequal byte buffers; byte-length comparison must reject instead.
  assert.equal(isAuthorizedReset("é", "e"), false);
  assert.equal(isAuthorizedReset("café", "cafe"), false);
});
