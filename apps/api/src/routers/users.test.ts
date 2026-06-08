// Integration tests for the users router (apps/api/src/routers/users.ts).
//
// Assertions derive from the SPEC (the Zod schemas + M4 onboarding intent), not the implementation:
//   - me returns the caller's own avatar card (id, name, colour).
//   - updateProfile sets the caller's display name (the name rosters show), trimmed.
//   - an empty/whitespace name is rejected and leaves the stored name unchanged.
//   - both procedures require authentication.
//
// Run with (and nothing else):
//   cd /Users/gong/Programming/drp_02/apps/api && \
//     node --import tsx --import ./src/test/env.ts --test src/routers/users.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { caller, dropTestDb, makeUser, resetTables, setupTestDb } from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

const isUnauthorized = (e: unknown): boolean => e instanceof TRPCError && e.code === "UNAUTHORIZED";

test("me returns the caller's avatar card", async () => {
  const u = await makeUser({ name: "Ada", avatarColor: "#123456" });

  const me = await caller(u).users.me();
  assert.equal(me.id, u);
  assert.equal(me.name, "Ada");
  assert.equal(me.color, "#123456");
});

test("updateProfile sets the caller's display name (reflected by me)", async () => {
  // The "Member" default is exactly what an onboarding user wants to replace.
  const u = await makeUser({ name: "Member" });

  await caller(u).users.updateProfile({ name: "Real Name" });

  const me = await caller(u).users.me();
  assert.equal(me.name, "Real Name");
});

test("updateProfile trims surrounding whitespace", async () => {
  const u = await makeUser({ name: "Before" });

  await caller(u).users.updateProfile({ name: "  Spaced  " });

  const me = await caller(u).users.me();
  assert.equal(me.name, "Spaced");
});

test("updateProfile rejects an empty/whitespace name and leaves the stored name unchanged", async () => {
  const u = await makeUser({ name: "Keep me" });

  // DisplayName trims then requires min length 1, so a whitespace-only name is rejected.
  await assert.rejects(() => caller(u).users.updateProfile({ name: "   " }));

  const me = await caller(u).users.me();
  assert.equal(me.name, "Keep me");
});

test("updateProfile requires authentication", async () => {
  await assert.rejects(() => caller(null).users.updateProfile({ name: "x" }), isUnauthorized);
});

test("me requires authentication", async () => {
  await assert.rejects(() => caller(null).users.me(), isUnauthorized);
});
