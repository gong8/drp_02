// Integration-test harness: a real (per-process, disposable) Postgres behind the actual tRPC
// router. Tests build state directly via the factory helpers below, then exercise procedures
// through `caller(userId)` and assert on real DB-backed behavior. This is the ONLY way to test
// the events.ts lifecycle (auth, transactions, the compare-and-set, conditional RSVP resolution,
// state transitions) - none of it is reachable as a pure helper.
//
// Requires `env.ts` to have run first (the api "test" script preloads it). Bring the DB up with
// `pnpm db:up`. Usage in a test file:
//
//   import { before, beforeEach, after, test } from "node:test";
//   import assert from "node:assert/strict";
//   import { setupTestDb, resetTables, dropTestDb, caller, makeUser, makeGroup } from "../test/harness.js";
//
//   before(setupTestDb);
//   beforeEach(resetTables);
//   after(dropTestDb);
//
//   test("...", async () => { const u = await makeUser(); ... });

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { db } from "../db/client.js";
import {
  candidateReactions,
  eventCandidates,
  eventOptOuts,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "../db/schema.js";
import { logger } from "../logger.js";
import { appRouter } from "../router.js";

const testDbName = process.env.TEST_DB_NAME ?? `bethere_test_${process.pid}`;
const maintenanceUrl =
  process.env.TEST_PG_MAINTENANCE_URL ?? "postgres://drp:drp@localhost:5433/drp";
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

// 42P04 = duplicate_database; 3D000 = invalid_catalog_name (DB does not exist).
const DUPLICATE_DATABASE = "42P04";

async function withMaintenanceClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: maintenanceUrl, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

let prepared: Promise<void> | null = null;

// Create the per-process DB (idempotent) and apply migrations. Memoized so calling it from many
// test files in the same process is a no-op after the first. Safe to await in a `before` hook.
export function setupTestDb(): Promise<void> {
  if (!prepared) {
    prepared = (async () => {
      await withMaintenanceClient(async (c) => {
        try {
          await c.query(`CREATE DATABASE "${testDbName}"`);
        } catch (err) {
          if ((err as { code?: string }).code !== DUPLICATE_DATABASE) throw err;
        }
      });
      await migrate(db, { migrationsFolder });
    })();
  }
  return prepared;
}

// Wipe every table between tests. CASCADE clears FK-referencing rows; the order does not matter.
export async function resetTables(): Promise<void> {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE "responses","candidate_reactions","event_opt_outs","event_candidates","events","group_members","groups","users" RESTART IDENTITY CASCADE`,
    ),
  );
}

// Drop this process's database. Call in a top-level `after` so local runs do not leak DBs.
// (`pnpm db:test:clean` is the bulk fallback.) Ends the app pool so the DROP is not blocked.
export async function dropTestDb(): Promise<void> {
  await db.$client.end();
  await withMaintenanceClient(async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDbName],
    );
    await c.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
  });
}

// The real router, called as a given user (null = unauthenticated, to test the auth boundary).
// The logger is the app's pino instance, silenced via LOG_LEVEL=silent in env.ts.
export function caller(userId: string | null) {
  return appRouter.createCaller({ userId, log: logger });
}

// ----- data factories (direct inserts; never rely on the procedures under test for setup) -----

export async function makeUser(
  over: { id?: string; name?: string; avatarColor?: string; email?: string | null } = {},
): Promise<string> {
  const id = over.id ?? `u_${randomUUID()}`;
  await db.insert(users).values({
    id,
    name: over.name ?? `User ${id.slice(2, 8)}`,
    avatarColor: over.avatarColor ?? "#4f46e5",
    email: over.email ?? null,
  });
  return id;
}

export async function makeUsers(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await makeUser());
  return ids;
}

// Create a group and add the given users as members (no creator is implied - pass them in).
export async function makeGroup(memberIds: string[] = [], name = "Test Group"): Promise<string> {
  const id = `g_${randomUUID()}`;
  await db.insert(groups).values({ id, name });
  for (const userId of memberIds) await db.insert(groupMembers).values({ groupId: id, userId });
  return id;
}

export async function addMember(groupId: string, userId: string): Promise<void> {
  await db.insert(groupMembers).values({ groupId, userId }).onConflictDoNothing();
}

type EventOverrides = Partial<typeof events.$inferInsert> & {
  groupId: string;
  createdByUserId: string;
};

// Insert a plan in any phase/state. Defaults to a fresh `collecting` plan with no activity set
// (the realistic pre-lock state). Pass `phase`, `lockTimes`, `decidesBy`, etc. to set up a moment,
// a cleared plan, locked axes, and so on.
export async function insertEvent(over: EventOverrides): Promise<string> {
  const id = over.id ?? `e_${randomUUID()}`;
  const now = new Date();
  await db.insert(events).values({
    id,
    activity: "",
    location: "",
    startsAt: now,
    respondByAt: now,
    phase: "collecting",
    ...over,
  });
  return id;
}

export async function insertTimeCandidate(
  eventId: string,
  startsAt: Date,
  over: { id?: string; partOfDay?: "morning" | "afternoon" | "evening" | "late" } = {},
): Promise<string> {
  const id = over.id ?? `c_${randomUUID()}`;
  await db
    .insert(eventCandidates)
    .values({ id, eventId, kind: "time", startsAt, partOfDay: over.partOfDay ?? null });
  return id;
}

export async function insertActivityCandidate(
  eventId: string,
  label: string,
  over: { id?: string } = {},
): Promise<string> {
  const id = over.id ?? `c_${randomUUID()}`;
  await db.insert(eventCandidates).values({ id, eventId, kind: "activity", label });
  return id;
}

export async function insertReaction(
  eventId: string,
  candidateId: string,
  userId: string,
): Promise<void> {
  await db.insert(candidateReactions).values({ eventId, candidateId, userId });
}

export async function insertResponse(
  eventId: string,
  userId: string,
  kind: "yes" | "no" | "conditional",
  cond: { mode: "all" | "any"; targetIds: string[] } | null = null,
): Promise<void> {
  await db.insert(responses).values({ id: randomUUID(), eventId, userId, kind, cond });
}

export async function insertOptOut(eventId: string, userId: string): Promise<void> {
  await db.insert(eventOptOuts).values({ eventId, userId });
}

// Re-export the live db + tables so tests can assert on persisted rows directly.
export { db } from "../db/client.js";
export {
  candidateReactions,
  eventCandidates,
  eventOptOuts,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "../db/schema.js";
