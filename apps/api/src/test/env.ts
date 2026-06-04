// Test bootstrap, preloaded via `node --import tsx --import ./src/test/env.ts ...` (see the
// api package's "test" script). This MUST run before any application module, because the db
// client (src/db/client.ts) reads DATABASE_URL at import time and builds a singleton Pool from
// it. By rewriting the env here first, the whole app under test binds to a disposable, per-process
// Postgres database - NEVER the shared dev DB (`drp`).
//
// One database per OS process: node:test isolates each test file in its own child process, so
// `bethere_test_<pid>` gives every file (and every parallel test-authoring agent) a private DB
// with zero cross-file interference. The harness (harness.ts) creates + migrates it on first use
// and truncates between tests; `pnpm db:test:clean` drops the leftovers.

const host = process.env.TEST_PG_HOST ?? "localhost";
const port = process.env.TEST_PG_PORT ?? "5433";
const user = process.env.TEST_PG_USER ?? "drp";
const pass = process.env.TEST_PG_PASSWORD ?? "drp";

const dbName = `bethere_test_${process.pid}`;

// Exposed so harness.ts knows which DB to create/drop and which server to connect to for the
// maintenance (CREATE/DROP DATABASE) statements, which cannot run against the DB being created.
process.env.TEST_DB_NAME = dbName;
process.env.TEST_PG_MAINTENANCE_URL = `postgres://${user}:${pass}@${host}:${port}/drp`;

process.env.DATABASE_URL = `postgres://${user}:${pass}@${host}:${port}/${dbName}`;
// Local docker Postgres speaks plaintext; force the client off TLS regardless of inherited env.
process.env.DATABASE_SSL = "disable";
// Procedures run under the dev-bypass identity model; the harness supplies userId per call.
process.env.DEV_AUTH_BYPASS = "1";
// The harness owns schema setup; never let an imported module seed or reset on its own.
process.env.SEED_ON_BOOT = "off";
// Keep the suite output clean unless a run explicitly asks for logs.
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "silent";
