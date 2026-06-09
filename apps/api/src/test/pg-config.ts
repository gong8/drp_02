// Single source of truth for the local test-DB connection coordinates. Read the TEST_PG_* parts
// once (with the docker-compose defaults) and derive the maintenance DSN + per-process DB-name
// convention from them. Changing the docker port means editing the TEST_PG_PORT default HERE only.
//
// This module deliberately does NOT read TEST_DB_NAME, so it stands on its own for the clean.ts
// path, which is launched WITHOUT preloading env.ts. env.ts remains the sole owner of TEST_DB_NAME
// / DATABASE_URL for the app under test.

const host = process.env.TEST_PG_HOST ?? "localhost";
const port = process.env.TEST_PG_PORT ?? "5433";
const user = process.env.TEST_PG_USER ?? "drp";
const pass = process.env.TEST_PG_PASSWORD ?? "drp";

// The maintenance DB (`drp`); CREATE/DROP DATABASE statements cannot run against the DB they target.
export const maintenanceUrl = `postgres://${user}:${pass}@${host}:${port}/drp`;

// One database per OS process: `bethere_test_<pid>` gives every test file a private DB.
export const TEST_DB_PREFIX = "bethere_test_";
export const testDbName = (pid: number = process.pid): string => `${TEST_DB_PREFIX}${pid}`;
