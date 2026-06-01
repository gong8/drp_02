import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAuth, type VerifiedClaims } from "./resolve.js";

const okVerify = async (token: string): Promise<VerifiedClaims> => {
  if (token === "good") return { sub: "user_123", name: "Ada", email: "ada@x.com" };
  throw new Error("bad token");
};

test("bearer token resolves to its sub and claims", async () => {
  const r = await resolveAuth(
    { authHeader: "Bearer good", userIdHeader: undefined, devBypass: false },
    okVerify,
  );
  assert.equal(r.userId, "user_123");
  assert.equal(r.claims?.email, "ada@x.com");
});

test("invalid bearer token resolves to null (unauthenticated)", async () => {
  const r = await resolveAuth(
    { authHeader: "Bearer nope", userIdHeader: undefined, devBypass: false },
    okVerify,
  );
  assert.equal(r.userId, null);
  assert.equal(r.claims, null);
});

test("dev bypass with no token uses x-user-id header", async () => {
  const r = await resolveAuth(
    { authHeader: undefined, userIdHeader: "u_lily", devBypass: true },
    okVerify,
  );
  assert.equal(r.userId, "u_lily");
  assert.equal(r.claims, null);
});

test("dev bypass with no header defaults to u_dev", async () => {
  const r = await resolveAuth(
    { authHeader: undefined, userIdHeader: undefined, devBypass: true },
    okVerify,
  );
  assert.equal(r.userId, "u_dev");
});

test("no token and no bypass resolves to null", async () => {
  const r = await resolveAuth(
    { authHeader: undefined, userIdHeader: "u_dev", devBypass: false },
    okVerify,
  );
  assert.equal(r.userId, null);
});

test("a valid bearer token wins even when dev bypass is on", async () => {
  const r = await resolveAuth(
    { authHeader: "Bearer good", userIdHeader: "u_dev", devBypass: true },
    okVerify,
  );
  assert.equal(r.userId, "user_123");
});
