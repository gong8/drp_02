// Drop every leftover per-process test database (`bethere_test_*`). The harness drops its own DB
// in an `after` hook, but crashed/killed runs leak them; run `pnpm --filter @bethere/api db:test:clean`
// to sweep. Connects to the maintenance DB (`drp`), so it never touches the dev data itself.

import { Client } from "pg";

const maintenanceUrl =
  process.env.TEST_PG_MAINTENANCE_URL ?? "postgres://drp:drp@localhost:5433/drp";

const client = new Client({ connectionString: maintenanceUrl, ssl: false });
await client.connect();
try {
  const { rows } = await client.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'bethere_test_%'`,
  );
  for (const { datname } of rows) {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [datname],
    );
    await client.query(`DROP DATABASE IF EXISTS "${datname}"`);
    console.log(`dropped ${datname}`);
  }
  console.log(`done: ${rows.length} test database(s) removed`);
} finally {
  await client.end();
}
